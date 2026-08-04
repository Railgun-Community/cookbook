import { ContractTransaction } from 'ethers';
import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../utils/token';
import { Step } from '../step';
import { MorphoBundle } from '../../api/morpho';

/**
 * Compiles a normalized {@link MorphoBundle} (raw Morpho-SDK calls + token
 * requirements) into Cookbook cross-contract calls and accounting. This keeps
 * complex Morpho routing inside Morpho's maintained SDK while the ephemeral EOA
 * (EIP-7702) remains the direct caller / fund owner.
 *
 * Pure step: pulled tokens are consumed (approvals are added by the recipe),
 * delivered tokens become `[min, expected]` outputs, and any change reshields.
 *
 * **Failure semantics (7702). THE BUNDLE IS NOT ATOMIC.** It contributes N entries
 * to the multicall array, and relay-adapt runs that array with
 * `requireSuccess = false`, which CONTINUES past a failing call. So calls after a
 * failing one still execute — against state the bundle compiler assumed would
 * exist. A Morpho SDK bundle is authored on the assumption that it reverts as a
 * unit; on this path it does not. Pulled tokens that were never pulled are at the
 * executor and are swept back, but a half-applied bundle can leave protocol state
 * the bundle's own accounting does not model. Treat every `CallError` index inside
 * a bundle as unexplained until read back on chain. See `steps/failure-modes.ts`.
 */
export class MorphoTransactStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Transact (compiled bundle)',
    description: 'Executes a compiled Morpho SDK bundle.',
    hasNonDeterministicOutput: true,
  };

  private readonly bundle: MorphoBundle;

  constructor(bundle: MorphoBundle) {
    super();
    this.bundle = bundle;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { calls, pulls, outputs } = this.bundle;

    const pullByToken = new Map(
      pulls.map(pull => [pull.tokenAddress.toLowerCase(), pull]),
    );

    const crossContractCalls: ContractTransaction[] = calls.map(call => {
      return {
        to: call.to,
        data: call.data,
        value: call.value ?? 0n,
      } as ContractTransaction;
    });

    const spentERC20Amounts: RecipeERC20AmountRecipient[] = [];
    // Delivered tokens shield back with a [min, expected] tolerance.
    const outputERC20Amounts: StepOutputERC20Amount[] = outputs.map(out => ({
      tokenAddress: out.tokenAddress,
      decimals: out.decimals,
      expectedBalance: out.expectedAmount,
      minBalance: out.minAmount,
      approvedSpender: undefined,
    }));

    // Account each input: a pulled token is spent at its exact amount (any
    // change reshields); every other input passes through unchanged. Manual
    // accounting avoids getValidInputERC20Amounts' in-place input mutation,
    // which double-counts when a pull leaves change.
    const seenPull = new Set<string>();
    input.erc20Amounts.forEach(erc20Amount => {
      const pull = pullByToken.get(erc20Amount.tokenAddress.toLowerCase());
      if (
        pull &&
        !seenPull.has(pull.tokenAddress.toLowerCase()) &&
        compareERC20Info(erc20Amount, {
          tokenAddress: pull.tokenAddress,
          decimals: pull.decimals,
        })
      ) {
        if (!isApprovedForSpender(erc20Amount, pull.spender)) {
          throw new Error(
            `morpho-transact: pull token ${pull.tokenAddress} not approved for ${pull.spender}`,
          );
        }
        if (erc20Amount.expectedBalance < pull.amount) {
          throw new Error(
            `morpho-transact: insufficient ${pull.tokenAddress} (${erc20Amount.expectedBalance} < ${pull.amount})`,
          );
        }
        seenPull.add(pull.tokenAddress.toLowerCase());
        spentERC20Amounts.push({
          tokenAddress: pull.tokenAddress,
          decimals: pull.decimals,
          amount: pull.amount,
          recipient: pull.spender,
        });
        const change = erc20Amount.expectedBalance - pull.amount;
        if (change > 0n) {
          outputERC20Amounts.push({
            ...erc20Amount,
            expectedBalance: change,
            minBalance: change,
          });
        }
      } else {
        // Not a pull — pass through unchanged.
        outputERC20Amounts.push(erc20Amount);
      }
    });

    // Every declared pull must have been matched by an input.
    if (seenPull.size !== pullByToken.size) {
      throw new Error(
        'morpho-transact: bundle pulls not fully covered by recipe inputs',
      );
    }

    return {
      crossContractCalls,
      spentERC20Amounts,
      outputERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
