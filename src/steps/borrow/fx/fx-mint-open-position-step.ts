import { Interface, type ContractTransaction } from 'ethers';
import { NFTTokenType } from '@railgun-community/shared-models';
import { Step } from '../../step';
import type {
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import {
  FX_POOL_MANAGER_ABI,
  fxCollateralCreditWithCaveat,
  fxDebtBorrowOutput,
  fxPositionInfo,
  fxPositionTokenSubID,
  type ResolvedFxPool,
} from './fx-mint-util';

export type FxMintOpenPositionStepData = {
  /**
   * The resolved pool. Carries the pool address (which is also the position-NFT
   * contract), both token addresses and their decimals, and the manager to call
   * — long and short pools are registered on **different** managers, so this
   * cannot be a module constant. Get it from `resolvePool()`.
   */
  pool: ResolvedFxPool;
  /**
   * Absolute debt to borrow, in `pool.debtToken` native units. `operate()`
   * borrows exactly this amount.
   *
   * Long pools mint fxUSD (18dp). Short pools borrow the volatile asset from
   * the counterparty long pool — wstETH (18dp) or **WBTC (8dp)**, so this is
   * not always an 18-decimal value.
   */
  targetDebt: bigint;
  /**
   * Predicted positionId from Pool.getNextPositionId() — use
   * `getNextFxPositionId()` in api/borrow/fx rather than hand-rolling the
   * read. Used *only* to declare the NFT in `outputNFTs` so the recipe
   * engine's shield-back epilogue picks it up; the `operate()` calldata below
   * passes positionId 0 (mint-new), so this value never reaches f(x).
   *
   * Consequence, if another opener takes the id first: `operate()` still
   * succeeds and mints the next id, but the epilogue then tries to shield an
   * NFT the executor does not own and the batch reverts there. The position
   * stays with the ephemeral EOA — recoverable, not shielded. Read the id as
   * late as possible and treat that revert as "re-read and rebuild".
   * (An earlier version of this comment claimed the race surfaces as a
   * gas-estimate revert; it does not — passing 0 cannot revert on a taken id.)
   */
  predictedPositionId: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator) pair, 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2].
   *
   * Long pools charge 0.5% here; **short pools currently charge zero** and put
   * their fees on the collateral side instead. The supply fee never changes the
   * caller's outlay — see `fxCollateralSupplySpend` and `supplyFeeRatio` below.
   */
  borrowFeeRatio: bigint;
  /**
   * f(x)'s supply fee for this (pool, operator) pair, 1e9-denominated, from
   * `PoolConfiguration.getPoolFeeRatio(pool, operator)[0]` —
   * `getFxPool(...).supplyFeeRatio`.
   *
   * Optional, and it does NOT affect any ERC-20 amount: the manager pulls the
   * full collateral either way. It affects only how much collateral the
   * *position* is credited with, which is why it appeared here at all — the
   * `outputPositions` record cannot be exact without it.
   *
   * Omit it on a long pool (fee 0) with no loss. Omit it on a short and the
   * position record is emitted as an upper bound with an `estimateReason`
   * saying so, rather than silently over-stating the position by 0.3%.
   */
  supplyFeeRatio?: bigint;
};

/**
 * Encodes `PoolManager.operate(pool, 0, +collateralAmount, +targetDebt)`.
 *
 * Goes through PoolManager (not Pool directly) — Pool.operate reverts with
 * `ErrorCallerNotPoolManager` for any caller other than PoolManager. Which
 * manager is per-pool: `pool.poolManager`, because long and short pools are
 * registered on different ones.
 *
 * Consumes `pool.collateralToken` from the executing account; produces
 * `pool.debtToken` + an ERC-721 position NFT (owner = msg.sender = the
 * executing account, i.e. the ephemeral EOA under EIP-7702).
 *
 * Works for both sides unchanged — a long deposits wstETH/WBTC and receives
 * fxUSD, a short deposits fxUSD and receives wstETH/WBTC. The step never names
 * either token; it reads both off the descriptor.
 */
export class FxMintOpenPositionStep extends Step {
  readonly config: StepConfig = {
    name: 'f(x) Open Position',
    description:
      'Calls PoolManager.operate(pool, 0, +collateral, +debt). Borrows the debt token and mints a position NFT to msg.sender.',
    hasNonDeterministicOutput: false, // predictedPositionId is provided
  };

  constructor(private readonly data: FxMintOpenPositionStepData) {
    super();
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      pool,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio,
      supplyFeeRatio,
    } = this.data;
    const {
      address: poolAddress,
      collateralToken,
      collateralDecimals,
      debtToken,
      debtDecimals,
      poolManager,
    } = pool;

    // Read the collateral amount from the step input rather than the
    // constructor: through ZeroXSwap_FxMintOpen_ComboMeal the upstream is a 0x
    // swap whose output is non-deterministic, so the amount isn't knowable at
    // construction time.
    const inputColl = input.erc20Amounts.find(
      a => a.tokenAddress.toLowerCase() === collateralToken.toLowerCase(),
    );
    if (!inputColl) {
      throw new Error(
        `FxMintOpenPositionStep: no input balance for collateralToken ${collateralToken}`,
      );
    }
    // Encode the GUARANTEED amount, never the optimistic expectation.
    //
    // operate() pulls this exact amount via transferFrom. If an upstream step
    // is non-deterministic (a 0x swap fills anywhere in [minBalance,
    // expectedBalance]) then encoding expectedBalance reverts the whole batch
    // on any underfill within slippage. minBalance is the amount the executing
    // account is guaranteed to hold.
    //
    // Trade-off on a shortfall: slightly less collateral is deposited at an
    // unchanged targetDebt, so the position opens at a marginally higher debt
    // ratio — bounded by the caller's slippage, and strictly better than a
    // guaranteed revert. Any surplus is declared below and reshields.
    const collateralAmount = inputColl.minBalance;
    const collateralSurplus = inputColl.expectedBalance - collateralAmount;

    // Encode operate(...) via ethers' Interface — matches the cookbook
    // house style (other steps use ethers' Contract.populateTransaction;
    // we use Interface directly because we're not maintaining a typechain
    // binding for the f(x) PoolManager, just the ABI fragment in
    // fx-mint-util).
    const iface = new Interface(FX_POOL_MANAGER_ABI);
    const callData = iface.encodeFunctionData('operate', [
      poolAddress,
      0n,
      collateralAmount,
      targetDebt,
    ]);

    // Borrow fee deduction: the manager emits (targetDebt - fee) of the debt
    // token to msg.sender (the executing account; the ephemeral EOA under
    // EIP-7702). Cookbook's StepOutputERC20Amount expects the post-fee net; the
    // recipe layer doesn't fold this in.
    const debtNet = fxDebtBorrowOutput(targetDebt, borrowFeeRatio);

    const tx: ContractTransaction = {
      to: poolManager,
      data: callData,
      value: 0n,
    };

    return {
      crossContractCalls: [tx],
      spentERC20Amounts: [
        {
          tokenAddress: collateralToken,
          decimals: collateralDecimals,
          amount: collateralAmount,
          recipient: poolManager,
        },
      ],
      outputERC20Amounts: [
        // Unspent collateral from a better-than-worst-case upstream fill. Kept
        // so the step's amount accounting still closes
        // (input.expected == spent + outputs); it reshields to the user.
        ...(collateralSurplus > 0n
          ? [
              {
                tokenAddress: collateralToken,
                decimals: collateralDecimals,
                expectedBalance: collateralSurplus,
                minBalance: 0n,
                isBaseToken: false,
                approvedSpender: undefined,
              },
            ]
          : []),
        {
          tokenAddress: debtToken,
          decimals: debtDecimals,
          expectedBalance: debtNet,
          // Deterministic: targetDebt and borrowFeeRatio are both known at
          // construction time. Setting minBalance = expectedBalance lets
          // future steps consume this with a fixed amount without tripping
          // step.ts:71-83's non-deterministic-input gate.
          minBalance: debtNet,
          isBaseToken: false,
          approvedSpender: undefined,
        },
      ],
      outputNFTs: [
        {
          nftAddress: poolAddress,
          tokenSubID: fxPositionTokenSubID(predictedPositionId),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
      // The position the NFT above is a receipt FOR. Both records describe what
      // the POSITION gets, which is not what the caller pays or receives:
      //
      //   collateral — the caller parts with the full `collateralAmount`
      //                (declared as spent), the position is credited that minus
      //                the supply fee.
      //   debt       — the position owes the full `targetDebt`, the caller is
      //                paid `debtNet` (declared as an output).
      //
      // Reusing either caller-facing figure here would misreport the position
      // by a fee, in opposite directions on the two axes.
      outputPositions: [
        fxPositionInfo({
          pool,
          positionId: predictedPositionId,
          kind: 'collateral',
          direction: 'increase',
          ...fxCollateralCreditWithCaveat(collateralAmount, supplyFeeRatio),
        }),
        fxPositionInfo({
          pool,
          positionId: predictedPositionId,
          kind: 'debt',
          direction: 'increase',
          amount: targetDebt,
        }),
      ],
    };
  }
}
