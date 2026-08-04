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
  fxPositionInfo,
  fxPositionTokenSubID,
  type ResolvedFxPool,
} from './fx-mint-util';

export type FxMintClosePositionStepData = {
  /**
   * The resolved pool — address (also the position-NFT contract), both tokens
   * with their decimals, and the manager to call. From `resolvePool()`.
   */
  pool: ResolvedFxPool;
  positionId: bigint;
  /**
   * Debt to repay, in `pool.debtToken` native units. PoolManager pulls
   * `repayAmount × (1 + repayFeeRatio)` from msg.sender.
   */
  repayAmount: bigint;
  /**
   * Collateral to withdraw, in `pool.collateralToken` native units, **gross of
   * the withdraw fee** — this is the value encoded into `operate()`. What the
   * caller actually receives is net of `withdrawFeeRatio`; the step derives that
   * for its declared output.
   */
  withdrawColl: bigint;
  /**
   * f(x)'s withdraw fee for this (pool, operator), 1e9-denominated, from
   * `PoolConfiguration.getPoolFeeRatio(pool, operator)[1]` —
   * `getFxPool(...).withdrawFeeRatio`.
   *
   * **Required.** It is `0n` on the long pools and `1_000_000n` (0.1%) on the
   * shorts; pass `0n` explicitly for a long rather than omitting. It used to
   * default to `0n`, which is correct for one side and silently wrong for the
   * other — and the over-declaration it produced on a short is not caught by
   * the step validator, because that only reconciles tokens present in the
   * step's *input* and the collateral is an output.
   *
   * Unlike {@link FxMintAdjustPositionStep}, where the fee applies only when
   * `collDelta < 0` and so can only be enforced at runtime, a close always
   * withdraws collateral — so the requirement is carried by the type here.
   */
  withdrawFeeRatio: bigint;
  /**
   * True when `repayAmount` is less than the position's full debt.
   *
   * Informational only — it no longer gates NFT handling, and it never should
   * have. It used to select between "NFT shields back" and "NFT burns", but
   * f(x) does not burn on close (see `spentNFTs` below), so the NFT shields
   * back either way. Retained because "is this a full close" is still a real
   * fact about the operation and `computeFxClose` already derives it.
   */
  partialClose: boolean;
};

/**
 * Encodes `PoolManager.operate(pool, positionId, -withdrawColl, -repayAmount)`.
 *
 * Consumes `pool.debtToken` (the executing account (ephemeral EOA) must have
 * approved PoolManager for `repayAmount × (1 + repayFeeRatio/1e9)`) and the
 * position NFT; produces `pool.collateralToken` for the swap-back leg.
 *
 * Side-agnostic: a long repays fxUSD to release wstETH/WBTC, a short repays
 * wstETH/WBTC to release fxUSD. Both tokens come off the descriptor.
 *
 * The NFT survives every close and is always shielded back. f(x) does not burn
 * a position on close — a closed position is a live NFT holding nothing.
 *
 * **Failure semantics (7702): benign, on both branches.** The executor owns the
 * NFT going in and still owns it whatever `operate()` does, so the epilogue's
 * shield request always resolves and a failed `operate()` reshields the position
 * alongside the debt token — the batch degrades to a no-op.
 *
 * This was not true before. The full-close branch declared `outputNFTs: []` and
 * put the NFT in `spentNFTs`, assuming `operate()` burned it. It does not, so
 * the epilogue carried no request for a token that still existed and every
 * successful full close left the position NFT public at the ephemeral EOA. See
 * `steps/failure-modes.ts`.
 */
export class FxMintClosePositionStep extends Step {
  readonly config: StepConfig = {
    name: 'f(x) Close Position',
    description:
      'Calls PoolManager.operate(pool, positionId, -coll, -debt). Repays the debt token; releases collateral and (for full close) the position NFT.',
    hasNonDeterministicOutput: false,
  };

  constructor(private readonly data: FxMintClosePositionStepData) {
    super();
    // Legibility backstop for plain-JS callers, who get no compile signal from
    // the type above. Without it the failure is a `TypeError: Cannot convert
    // undefined to a BigInt` raised inside fxCollateralWithdrawOutput, which
    // names the wrong module.
    if (data.withdrawFeeRatio === undefined) {
      throw new Error(
        'FxMintClosePositionStep: withdrawFeeRatio is required — read it from ' +
          'getFxPool(...).withdrawFeeRatio. Pass 0n only for the long pools.',
      );
    }
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      pool,
      positionId,
      repayAmount,
      withdrawColl,
      withdrawFeeRatio,
      partialClose,
    } = this.data;
    const {
      address: poolAddress,
      collateralToken,
      collateralDecimals,
      debtToken,
      debtDecimals,
      poolManager,
    } = pool;

    // The prior ApproveERC20SpenderStep declared `approveAmount` of the debt token
    // as approved-for-PoolManager. Cookbook's accounting requires every
    // input wei to be classified as spent / fee / output. PoolManager
    // pulls the full approveAmount from msg.sender; `repayAmount` of that
    // is burned against the position, the rest is the f(x) repay fee
    // (treasury). Read the actual approved input amount so we can
    // declare the fee correctly.
    const approvedDebtInput = input.erc20Amounts.find(
      a =>
        a.tokenAddress.toLowerCase() === debtToken.toLowerCase() &&
        a.approvedSpender?.toLowerCase() === poolManager.toLowerCase(),
    );
    if (!approvedDebtInput) {
      throw new Error(
        `FxMintClosePositionStep: no PoolManager-approved ${debtToken} input found`,
      );
    }
    const approveAmount = approvedDebtInput.expectedBalance;
    const feeAmount = approveAmount - repayAmount;

    // `withdrawColl` is the gross amount encoded into operate(); the caller
    // receives it net of the withdraw fee.
    const withdrawnNet = fxCollateralWithdrawOutput(
      withdrawColl,
      withdrawFeeRatio,
    );

    // Cookbook's accounting validator sums ALL debt-token inputs, including any
    // non-approved orphans left by upstream steps' integer rounding (we
    // observed a recurring 2-wei orphan from UnshieldDefaultStep + Approve
    // step's change accounting). Pass those through as outputs so input ==
    // spent + fees + outputs balances to the wei.
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

    // Ethers' Interface for ABI encoding (cookbook house style: other
    // steps use Contract.populateTransaction via typechain bindings; we
    // use Interface directly since we don't ship a typechain binding for
    // the f(x) PoolManager — just the ABI fragment in fx-mint-util).
    const iface = new Interface(FX_POOL_MANAGER_ABI);
    const callData = iface.encodeFunctionData('operate', [
      poolAddress,
      positionId,
      -withdrawColl,
      -repayAmount,
    ]);

    const tx: ContractTransaction = {
      to: poolManager,
      data: callData,
      value: 0n,
    };

    return {
      crossContractCalls: [tx],
      spentERC20Amounts: [
        {
          tokenAddress: debtToken,
          decimals: debtDecimals,
          amount: repayAmount, // burned by PoolManager against position debt
          recipient: poolManager,
        },
      ],
      ...(feeAmount > 0n && {
        feeERC20AmountRecipients: [
          {
            tokenAddress: debtToken,
            decimals: debtDecimals,
            amount: feeAmount, // f(x) repay fee → protocol treasury
            recipient: poolManager,
          },
        ],
      }),
      // Never spent. f(x) does NOT burn a position NFT on close — measured
      // across all four pools over 200,000 blocks: 1,097 transfers, 33 mints,
      // ZERO burns, and 19 of 51 sampled positions read `(0, 0)` while
      // `ownerOf` still returns a live holder. A closed f(x) position is a live
      // NFT holding nothing.
      //
      // This branch used to declare the NFT spent on a full close and emit no
      // output for it, on the assumption that `operate()` burned it. Since it
      // does not, a SUCCESSFUL full close left the position NFT owned by the
      // ephemeral EOA with no shield request covering it — public, on every
      // full close, not merely on failure.
      spentNFTs: [],
      outputERC20Amounts: [
        {
          tokenAddress: collateralToken,
          // Plumbed from the pool registry. Was hardcoded 18n, which broke
          // WBTC-Long (8-decimal) bookkeeping by 10^10.
          decimals: collateralDecimals,
          // What the caller actually receives: `_handleWithdraw` sends
          // `withdrawColl - withdrawFee`. Zero-fee on longs, so this is
          // identity there and the long behaviour is unchanged.
          //
          // Deterministic (min == expected) — operate() withdraws exactly this
          // or reverts — which lets a downstream Approve(0x, ...) pass
          // cookbook's "non-deterministic input" gate.
          expectedBalance: withdrawnNet,
          minBalance: withdrawnNet,
          isBaseToken: false,
          approvedSpender: undefined,
        },
        ...orphanDebt,
      ],
      // Declared unconditionally, which also removes the stranding case: the
      // token always exists, so the epilogue's `approve(railgun, id)` cannot
      // revert on it and take the whole shield down. Both outcomes now reshield
      // the handle — a successful close returns an emptied position, a failed
      // one returns the position untouched.
      outputNFTs: [
        {
          nftAddress: poolAddress,
          tokenSubID: fxPositionTokenSubID(positionId),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
      // Both legs shrink, and both use the GROSS `operate()` argument rather
      // than the caller-facing figure:
      //
      //   debt       — falls by `repayAmount`, the principal burned against the
      //                position. The caller parts with `approveAmount`, which
      //                is that plus the f(x) repay fee (declared above as spend
      //                + fee); charging the fee to the position would report
      //                more debt cleared than actually was.
      //   collateral — the position gives up the full `withdrawColl`. The
      //                caller receives `withdrawnNet`, which is that minus the
      //                withdraw fee (0 on longs, 0.1% on shorts).
      //
      // On a FULL close these two records are the position's epitaph — the only
      // description of what the batch retired. The NFT itself is not evidence
      // of closure: it outlives the position and reads `(0, 0)`, so a reader
      // that treats "still owned" as "still open" is wrong. That is why these
      // records matter more here than on a partial close, and why
      // `rediscoverFxPositions` classifies rather than filters.
      outputPositions: [
        fxPositionInfo({
          pool,
          positionId,
          kind: 'debt',
          direction: 'decrease',
          amount: repayAmount,
        }),
        fxPositionInfo({
          pool,
          positionId,
          kind: 'collateral',
          direction: 'decrease',
          amount: withdrawColl,
        }),
      ],
    };
  }
}
