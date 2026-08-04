import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { NetworkName } from '@railgun-community/shared-models';
import { getShieldFee, getShieldedAmountAfterFee } from '../../utils/fee';

/**
 * **Failure semantics (7702).** This step emits no call of its own; the wallet
 * SDK appends the single trailing `shield(...)` self-call it models, and that
 * call sweeps the executor's ENTIRE balance per requested token
 * (`preimage.value = 0`). Because relay-adapt builds every 7702 batch with
 * `requireSuccess = false` — which CONTINUES past a failing call rather than
 * breaking — the shield still runs after an earlier step fails, which is what
 * makes a mid-batch failure recoverable and still private.
 *
 * The converse is the catastrophic case. The shield reverts as a unit, so if IT
 * fails, NOTHING is shielded: gas starvation (empty revert data, the §4.1
 * mainnet loss) or a single ERC-721 request the executor does not own strands
 * every token in the batch at the ephemeral EOA in the clear — with the
 * transaction still mining `status 1`. Full model: `steps/failure-modes.ts`.
 */
export class ShieldDefaultStep extends Step {
  readonly config: StepConfig = {
    name: 'Shield (Default)',
    description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
  };

  readonly canAddStep = false;

  async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
    const { outputERC20Amounts, feeERC20AmountRecipients } =
      ShieldDefaultStep.getOutputERC20AmountsAndFees(
        input.networkName,
        input.erc20Amounts,
      );
    if (
      !outputERC20Amounts.every(
        erc20Amount => !(erc20Amount.isBaseToken ?? false),
      )
    ) {
      throw new Error('Cannot shield base token.');
    }

    return {
      crossContractCalls: [],
      outputERC20Amounts,
      outputNFTs: input.nfts,
      feeERC20AmountRecipients,
    };
  }

  static getOutputERC20AmountsAndFees(
    networkName: NetworkName,
    inputERC20Amounts: StepOutputERC20Amount[],
  ) {
    const outputERC20Amounts: StepOutputERC20Amount[] = [];
    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = [];

    inputERC20Amounts.forEach(erc20Amount => {
      const shieldFeeAmount = getShieldFee(
        networkName,
        erc20Amount.expectedBalance,
      );
      const shieldedAmount = getShieldedAmountAfterFee(
        networkName,
        erc20Amount.expectedBalance,
      );
      const shieldedAmountMinimum = getShieldedAmountAfterFee(
        networkName,
        erc20Amount.minBalance,
      );

      outputERC20Amounts.push({
        tokenAddress: erc20Amount.tokenAddress,
        decimals: erc20Amount.decimals,
        isBaseToken: erc20Amount.isBaseToken,
        approvedSpender: erc20Amount.approvedSpender,
        expectedBalance: shieldedAmount,
        minBalance: shieldedAmountMinimum,
        recipient: erc20Amount.recipient,
      });

      feeERC20AmountRecipients.push({
        tokenAddress: erc20Amount.tokenAddress,
        decimals: erc20Amount.decimals,
        amount: shieldFeeAmount,
        recipient: 'RAILGUN Shield Fee',
      });
    });

    if (
      !outputERC20Amounts.every(
        erc20Amount => !(erc20Amount.isBaseToken ?? false),
      )
    ) {
      throw new Error('Cannot shield base token.');
    }

    return { outputERC20Amounts, feeERC20AmountRecipients };
  }
}
