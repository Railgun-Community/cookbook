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
  /** True if position survives (NFT shields back); false if full close (NFT burns). */
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
 * For partial close the NFT survives and is shielded back. For full close
 * (repayAmount == position's full debt) f(x) burns the NFT inside operate
 * and `outputNFTs` stays empty.
 *
 * **Failure semantics (7702) — depends on `partialClose`, and the FULL-close
 * branch is the dangerous one.** Partial close re-declares the NFT in
 * `outputNFTs`, the executor owns it, and a failed `operate()` reshields it along
 * with the debt token: benign. Full close declares `outputNFTs: []` and puts the
 * NFT in `spentNFTs` on the assumption that f(x) burns it, so the epilogue carries
 * NO shield request for it. If `operate()` then fails, the NFT is neither burned
 * nor reshielded — the bearer token for the whole position is left at a public
 * ephemeral EOA while the debt token is swept back around it. Whoever holds the
 * ephemeral key holds the position; if that key is genuinely single-use, the
 * position is unrecoverable. See `steps/failure-modes.ts`.
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
      spentNFTs: partialClose
        ? [] // partial: NFT stays with executing account (ephemeral EOA) for shield-back
        : [
            {
              nftAddress: poolAddress,
              tokenSubID: fxPositionTokenSubID(positionId),
              nftTokenType: NFTTokenType.ERC721,
              amount: 1n,
            },
          ],
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
      outputNFTs: partialClose
        ? [
            {
              nftAddress: poolAddress,
              tokenSubID: fxPositionTokenSubID(positionId),
              nftTokenType: NFTTokenType.ERC721,
              amount: 1n,
            },
          ]
        : [],
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
      // On a FULL close the NFT is burned (`spentNFTs` above) and these two
      // records are the position's epitaph — the only description of what the
      // batch retired. The validator accepts the bearer handle from either NFT
      // channel for exactly this case.
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
