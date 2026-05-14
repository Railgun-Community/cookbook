import { Interface, type ContractTransaction } from 'ethers';
import { NFTTokenType } from '@railgun-community/shared-models';
import { Step } from '../../step';
import type {
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import {
  FX_ADDRESSES,
  FX_POOL_MANAGER_ABI,
  type Address,
} from './fx-mint-util';

export type FxMintClosePositionStepData = {
  pool: Address;
  collateralToken: Address;
  /**
   * Native-units decimals for the collateral token (wstETH = 18, WBTC = 8).
   * Cookbook's amount accounting must match the on-chain token's decimals;
   * pre-Task-5 this was hardcoded to 18n on the close-side output, which
   * mis-accounted WBTC-Long by a factor of 10^10. Plumbed from the pool
   * registry by the recipe (see `resolvePool().collateralDecimals` in
   * fx-mint-util.ts).
   *
   * Note: f(x) has NO withdraw fee, so this value affects bookkeeping only —
   * it does not change the on-chain math (the operate() args use raw
   * collateral wei regardless).
   */
  collateralDecimals: bigint;
  positionId: bigint;
  /** fxUSD debt to repay. PoolManager pulls `repayAmount × (1 + fee)` from msg.sender. */
  repayAmount: bigint;
  /** Actual collateral wei to withdraw. */
  withdrawColl: bigint;
  /** True if position survives (NFT shields back); false if full close (NFT burns). */
  partialClose: boolean;
};

/**
 * Encodes `PoolManager.operate(pool, positionId, -withdrawColl, -repayAmount)`.
 *
 * Consumes fxUSD (relay-adapter must have approved PoolManager for
 * `repayAmount × (1 + repayFeeRatio/1e9)`) and the position NFT;
 * produces collateralToken (wstETH or WBTC) for the swap-back leg.
 *
 * For partial close the NFT survives and is shielded back. For full close
 * (repayAmount == position's full debt) f(x) burns the NFT inside operate
 * and `outputNFTs` stays empty.
 */
export class FxMintClosePositionStep extends Step {
  readonly config: StepConfig = {
    name: 'f(x) Close Position',
    description:
      'Calls PoolManager.operate(pool, positionId, -coll, -debt). Burns fxUSD; releases collateral and (for full close) the position NFT.',
    hasNonDeterministicOutput: false,
  };

  constructor(private readonly data: FxMintClosePositionStepData) {
    super();
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      pool,
      collateralToken,
      collateralDecimals,
      positionId,
      repayAmount,
      withdrawColl,
      partialClose,
    } = this.data;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;
    const fxUSD = FX_ADDRESSES.fxUSD as Address;

    // The prior ApproveERC20SpenderStep declared `approveAmount` of fxUSD
    // as approved-for-PoolManager. Cookbook's accounting requires every
    // input wei to be classified as spent / fee / output. PoolManager
    // pulls the full approveAmount from msg.sender; `repayAmount` of that
    // is burned against the position, the rest is the f(x) repay fee
    // (treasury). Read the actual approved input amount so we can
    // declare the fee correctly.
    const approvedFxUSDInput = input.erc20Amounts.find(
      a =>
        a.tokenAddress.toLowerCase() === fxUSD.toLowerCase() &&
        a.approvedSpender?.toLowerCase() === poolManager.toLowerCase(),
    );
    if (!approvedFxUSDInput) {
      throw new Error(
        `FxMintClosePositionStep: no PoolManager-approved fxUSD input found`,
      );
    }
    const approveAmount = approvedFxUSDInput.expectedBalance;
    const feeAmount = approveAmount - repayAmount;

    // Cookbook's accounting validator sums ALL fxUSD inputs, including any
    // non-approved orphans left by upstream steps' integer rounding (we
    // observed a recurring 2-wei orphan from UnshieldDefaultStep + Approve
    // step's change accounting). Pass those through as outputs so input ==
    // spent + fees + outputs balances to the wei.
    const orphanFxUSD = input.erc20Amounts
      .filter(
        a =>
          a.tokenAddress.toLowerCase() === fxUSD.toLowerCase() &&
          a.approvedSpender?.toLowerCase() !== poolManager.toLowerCase(),
      )
      .map(a => ({
        tokenAddress: fxUSD,
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
      pool,
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
          tokenAddress: fxUSD,
          decimals: 18n,
          amount: repayAmount, // burned by PoolManager against position debt
          recipient: poolManager,
        },
      ],
      ...(feeAmount > 0n && {
        feeERC20AmountRecipients: [
          {
            tokenAddress: fxUSD,
            decimals: 18n,
            amount: feeAmount, // f(x) repay fee → protocol treasury
            recipient: poolManager,
          },
        ],
      }),
      spentNFTs: partialClose
        ? [] // partial: NFT stays with relay-adapter for shield-back
        : [
            {
              nftAddress: pool,
              tokenSubID: '0x' + positionId.toString(16),
              nftTokenType: NFTTokenType.ERC721,
              amount: 1n,
            },
          ],
      outputERC20Amounts: [
        {
          tokenAddress: collateralToken,
          // Plumbed from the pool registry via constructor arg. Was hardcoded
          // 18n, which broke WBTC-Long (8-decimal) bookkeeping by 10^10.
          decimals: collateralDecimals,
          // PoolManager.operate withdraws exactly `withdrawColl` wstETH or
          // reverts. Treating it as deterministic (min == expected) lets
          // the downstream Approve(0x, withdrawColl) pass cookbook's
          // "non-deterministic input" gate.
          expectedBalance: withdrawColl,
          minBalance: withdrawColl,
          isBaseToken: false,
          approvedSpender: undefined,
        },
        ...orphanFxUSD,
      ],
      outputNFTs: partialClose
        ? [
            {
              nftAddress: pool,
              tokenSubID: '0x' + positionId.toString(16),
              nftTokenType: NFTTokenType.ERC721,
              amount: 1n,
            },
          ]
        : [],
    };
  }
}
