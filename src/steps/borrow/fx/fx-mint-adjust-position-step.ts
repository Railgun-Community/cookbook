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
  fxCollateralWithdrawOutput,
  fxDebtBorrowOutput,
  fxDebtRepaySpend,
  type ResolvedFxPool,
} from './fx-mint-util';

export type FxMintAdjustPositionStepData = {
  /**
   * The resolved pool — address (also the position-NFT contract), both tokens
   * with their decimals, and the manager to call. Long and short pools use
   * different managers, so this cannot be a module constant. From
   * `resolvePool()`.
   */
  pool: ResolvedFxPool;
  /** Existing position to adjust. */
  positionId: bigint;
  /**
   * Signed collateral delta, in `pool.collateralToken` native units — wstETH
   * (18dp) or WBTC (8dp) for a long, fxUSD (18dp) for a short:
   *   > 0: deposit additional collateral (executing account (ephemeral EOA)
   *        must hold the amount)
   *   < 0: withdraw collateral to the executing account, net of the withdraw
   *        fee — requires `withdrawFeeRatio`
   *   = 0: no-op on the collateral axis
   */
  collDelta: bigint;
  /**
   * Signed debt delta, in `pool.debtToken` native units — fxUSD (18dp) for a
   * long, wstETH (18dp) or **WBTC (8dp)** for a short:
   *   > 0: borrow more (PoolManager pays the executing account (ephemeral EOA),
   *        net of borrow fee).
   *   < 0: repay debt (PoolManager pulls the debt token from the executing
   *        account (ephemeral EOA), including the f(x) repay fee uplift; the
   *        recipe's preceding ApproveERC20SpenderStep authorizes the pull).
   *   = 0: no-op on the debt axis
   */
  debtDelta: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Required iff debtDelta > 0; ignored otherwise. Caller fetches via
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[2].
   * Zero on short pools today.
   */
  borrowFeeRatio?: bigint;
  /**
   * f(x)'s repay fee for this (pool, operator), 1e9-denominated.
   * Required iff debtDelta < 0; ignored otherwise.
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[3].
   * Zero on short pools today.
   */
  repayFeeRatio?: bigint;
  /**
   * f(x)'s withdraw fee for this (pool, operator), 1e9-denominated.
   * Required iff collDelta < 0; ignored otherwise.
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[1].
   *
   * Zero on long pools, **0.1% on shorts** — so the withdraw path could not be
   * declared correctly for a short without it. There is deliberately no
   * `supplyFeeRatio`: the manager pulls the full collateral amount and keeps the
   * supply fee out of what it credits to the position, so that fee never
   * changes the caller's outlay (see `fxCollateralSupplySpend`).
   */
  withdrawFeeRatio?: bigint;
};

/**
 * Encodes `PoolManager.operate(pool, positionId, collDelta, debtDelta)` for
 * an existing position. Signed deltas express any combination of (deposit,
 * withdraw, mint, burn) on the collateral and debt axes in a single tx.
 *
 * The position NFT is provided in RecipeInput.nfts at the recipe layer and
 * re-declared in this step's `outputNFTs` with the same tokenSubID, so the
 * recipe-engine epilogue shields the same NFT back to the user — adjusting
 * a position never changes its identifier. We do NOT use `spentNFTs` (the
 * step-validator combines spent+output NFTs into a single map and rejects
 * duplicates); this matches FxMintClosePositionStep's partial-close branch.
 * Full close, which burns the NFT, is handled by FxMintClosePositionStep,
 * not here.
 *
 * Side-agnostic: it never names fxUSD or a volatile asset, reading both tokens
 * and the manager off `pool`. A long deposits wstETH/WBTC against fxUSD debt; a
 * short deposits fxUSD against wstETH/WBTC debt; the four branches below are
 * identical in either direction.
 *
 * Step output shape is conditional:
 *   - collDelta > 0: declares spentERC20Amounts for the collateral pulled
 *     (clamped to the guaranteed input balance; the remainder is declared as a
 *     surplus output). The **supply fee is not subtracted** — the manager pulls
 *     the full amount and keeps the fee out of what it credits to the position.
 *   - collDelta < 0: declares outputERC20Amounts for the withdrawn collateral,
 *     **net of withdrawFeeRatio** — this fee does reduce the caller's proceeds.
 *   - debtDelta > 0: declares outputERC20Amounts for the post-borrow-fee debt
 *     token (`fxDebtBorrowOutput`).
 *   - debtDelta < 0: declares spentERC20Amounts for the debt token consumed
 *     (`fxDebtRepaySpend` — principal PLUS fee; PoolManager pulls both via the
 *     recipe's preceding approve step).
 */
export class FxMintAdjustPositionStep extends Step {
  readonly config: StepConfig = {
    name: 'f(x) Adjust Position',
    description:
      'Calls PoolManager.operate(pool, positionId, collDelta, debtDelta). Signed deltas; same NFT in/out.',
    hasNonDeterministicOutput: false,
  };

  private readonly data: FxMintAdjustPositionStepData;

  constructor(data: FxMintAdjustPositionStepData) {
    super();

    if (data.collDelta === 0n && data.debtDelta === 0n) {
      throw new Error(
        'FxMintAdjustPositionStep: at least one of collDelta and debtDelta must be non-zero (operate(0,0) would revert)',
      );
    }
    if (data.debtDelta > 0n && data.borrowFeeRatio === undefined) {
      throw new Error(
        'FxMintAdjustPositionStep: borrowFeeRatio required when debtDelta > 0',
      );
    }
    if (data.debtDelta < 0n && data.repayFeeRatio === undefined) {
      throw new Error(
        'FxMintAdjustPositionStep: repayFeeRatio required when debtDelta < 0',
      );
    }
    if (data.collDelta < 0n && data.withdrawFeeRatio === undefined) {
      // Long pools charge nothing here, so omitting it would appear to work
      // until the same code ran against a short pool and over-declared the
      // withdrawn output by 0.1%.
      throw new Error(
        'FxMintAdjustPositionStep: withdrawFeeRatio required when collDelta < 0',
      );
    }

    this.data = data;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      pool,
      positionId,
      collDelta,
      debtDelta,
      borrowFeeRatio,
      repayFeeRatio,
      withdrawFeeRatio,
    } = this.data;
    const {
      address: poolAddress,
      collateralToken,
      collateralDecimals,
      debtToken,
      debtDecimals,
      poolManager,
    } = pool;

    // On the deposit axis, clamp the encoded collateral to what the executing
    // account is GUARANTEED to hold.
    //
    // operate() pulls this exact amount via transferFrom, so encoding more than
    // the guaranteed minimum reverts the batch whenever a non-deterministic
    // upstream (a 0x swap) underfills within slippage. Clamping deposits
    // slightly less collateral instead — a marginally higher debt ratio,
    // bounded by the caller's slippage, and strictly better than a revert.
    //
    // No-op whenever min == expected, which is every path where the input comes
    // straight from an unshield or a combo seam.
    let effectiveCollDelta = collDelta;
    let collateralSurplus = 0n;

    if (collDelta > 0n) {
      const inputColl = input.erc20Amounts.find(
        a => a.tokenAddress.toLowerCase() === collateralToken.toLowerCase(),
      );
      if (!inputColl) {
        throw new Error(
          `FxMintAdjustPositionStep: no input balance for collateralToken ${collateralToken} (collDelta > 0 requires it)`,
        );
      }
      effectiveCollDelta =
        collDelta < inputColl.minBalance ? collDelta : inputColl.minBalance;
      collateralSurplus = inputColl.expectedBalance - effectiveCollDelta;
    }

    // Encoded operate() — passes signed deltas straight through. The Pool
    // contract handles the rawColls/rawDebts internal conversion. Using
    // ethers' Interface (matches cookbook house style; we don't ship a
    // typechain binding for the f(x) PoolManager).
    const iface = new Interface(FX_POOL_MANAGER_ABI);
    const callData = iface.encodeFunctionData('operate', [
      poolAddress,
      positionId,
      effectiveCollDelta,
      debtDelta,
    ]);

    // ---- spentERC20Amounts ----
    const spentERC20Amounts: NonNullable<
      UnvalidatedStepOutput['spentERC20Amounts']
    > = [];

    if (collDelta > 0n) {
      // Spend exactly what operate() pulls; any remainder is declared as a
      // surplus output below.
      spentERC20Amounts.push({
        tokenAddress: collateralToken,
        decimals: collateralDecimals,
        amount: effectiveCollDelta,
        recipient: poolManager,
      });
    }

    if (debtDelta < 0n) {
      // PoolManager.operate(... , -X) pulls X × (1e9 + repayFeeRatio)/1e9 of the
      // debt token from the executing account (ephemeral EOA) via transferFrom
      // (allowed by the recipe's preceding approve step) — the fee is charged on
      // TOP of the principal, in two separate transferFrom calls. Declared here
      // so cookbook's amount accounting reflects the actual outflow.
      if (repayFeeRatio === undefined) {
        throw new Error(
          'FxMintAdjustPositionStep: repayFeeRatio required when debtDelta < 0',
        );
      }
      spentERC20Amounts.push({
        tokenAddress: debtToken,
        decimals: debtDecimals,
        amount: fxDebtRepaySpend(-debtDelta, repayFeeRatio),
        recipient: poolManager,
      });
    }

    // ---- outputERC20Amounts ----
    const outputERC20Amounts: NonNullable<
      UnvalidatedStepOutput['outputERC20Amounts']
    > = [];

    if (collateralSurplus > 0n) {
      // Collateral the caller supplied beyond what operate() pulls — either an
      // explicit collDelta below the input balance, or the clamp above biting
      // on a better-than-worst-case upstream fill. Declared so the step's
      // amount accounting closes; it reshields to the user.
      outputERC20Amounts.push({
        tokenAddress: collateralToken,
        decimals: collateralDecimals,
        expectedBalance: collateralSurplus,
        minBalance: 0n,
        isBaseToken: false,
        approvedSpender: undefined,
      });
    }

    if (collDelta < 0n) {
      // Withdrawn collateral, net of the withdraw fee — unlike supply, this fee
      // DOES come out of the caller's proceeds (_handleWithdraw transfers
      // newColl - fee), so declaring the gross would over-state the reshielded
      // balance. Zero on longs, 0.1% on shorts.
      if (withdrawFeeRatio === undefined) {
        throw new Error(
          'FxMintAdjustPositionStep: withdrawFeeRatio required when collDelta < 0',
        );
      }
      const withdrawn = fxCollateralWithdrawOutput(-collDelta, withdrawFeeRatio);
      outputERC20Amounts.push({
        tokenAddress: collateralToken,
        decimals: collateralDecimals,
        expectedBalance: withdrawn,
        minBalance: withdrawn,
        isBaseToken: false,
        approvedSpender: undefined,
      });
    }

    if (debtDelta > 0n) {
      // Post-borrow-fee net debt token lands in the executing account
      // (ephemeral EOA) and shields back to the user.
      if (borrowFeeRatio === undefined) {
        throw new Error(
          'FxMintAdjustPositionStep: borrowFeeRatio required when debtDelta > 0',
        );
      }
      const debtNet = fxDebtBorrowOutput(debtDelta, borrowFeeRatio);
      outputERC20Amounts.push({
        tokenAddress: debtToken,
        decimals: debtDecimals,
        expectedBalance: debtNet,
        // Deterministic: debtDelta and borrowFeeRatio are both known at
        // construction time. minBalance = expectedBalance keeps the
        // output spendable by future fixed-amount steps without hitting
        // step.ts:71-83's non-deterministic-input gate.
        minBalance: debtNet,
        isBaseToken: false,
        approvedSpender: undefined,
      });
    }

    if (debtDelta < 0n) {
      // Orphan debt-token pass-through — mirrors FxMintClosePositionStep's
      // pattern. The repay path receives the user's full shielded debt-token
      // balance (so the wallet doesn't have to know approveAmount when
      // unshielding); ApproveERC20SpenderStep marks only `approveAmount` as
      // approvedSpender=PoolManager, leaving the rest as orphan change.
      // Cookbook's step-validator (validators/step-validator.ts) demands
      // input == spent + outputs + fees per token at THIS step (recipe-
      // engine epilogue shield-back happens AFTER all steps and isn't
      // accounted for inside the step-level check). Pass the orphan
      // through as an output so the balance closes to the wei.
      const orphanDebt = input.erc20Amounts
        .filter(
          a =>
            a.tokenAddress.toLowerCase() === debtToken.toLowerCase() &&
            a.approvedSpender?.toLowerCase() !== poolManager.toLowerCase(),
        )
        .map(a => ({
          tokenAddress: debtToken,
          decimals: a.decimals,
          expectedBalance: a.expectedBalance,
          minBalance: a.minBalance,
          isBaseToken: false,
          approvedSpender: a.approvedSpender,
        }));
      outputERC20Amounts.push(...orphanDebt);
    }

    // ---- outputNFTs ----
    // Position NFT survives every adjust op (only full close burns), so
    // it's re-declared in `outputNFTs` with the same tokenSubID — the
    // recipe-engine epilogue shields it back to the user. Matches
    // FxMintClosePositionStep's PARTIAL-close branch (NFT survives →
    // only outputNFTs); `spentNFTs` is reserved for the burn case.
    // The step-validator (validators/step-validator.ts) accepts an
    // inputNFT iff it appears in (spentNFTs ∪ outputNFTs), and rejects
    // duplicates across that union — so we must not put the NFT in both.
    const outputNFTs: NonNullable<UnvalidatedStepOutput['outputNFTs']> = [
      {
        nftAddress: poolAddress,
        tokenSubID: '0x' + positionId.toString(16),
        nftTokenType: NFTTokenType.ERC721,
        amount: 1n,
      },
    ];

    const tx: ContractTransaction = {
      to: poolManager,
      data: callData,
      value: 0n,
    };

    return {
      crossContractCalls: [tx],
      spentERC20Amounts,
      outputERC20Amounts,
      outputNFTs,
    };
  }
}
