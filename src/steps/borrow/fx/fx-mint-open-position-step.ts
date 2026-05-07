import { encodeFunctionData, type Address } from "viem";
import { NFTTokenType } from "@railgun-community/shared-models";
import { Step } from '../../step';
import type { StepConfig, StepInput, UnvalidatedStepOutput } from '../../../models/export-models';
import { FX_ADDRESSES, FX_POOL_MANAGER_ABI } from './fx-mint-util';

export type FxMintOpenPositionStepData = {
  /** f(x) Pool address. The position NFT is minted by this contract. */
  pool: Address;
  /** Collateral token address (wstETH for wstETH-Long, WBTC for WBTC-Long). */
  collateralToken: Address;
  /** Absolute fxUSD debt to mint. operate() mints exactly this amount. */
  targetDebt: bigint;
  /**
   * Predicted positionId from Pool.getNextPositionId() (caller queries
   * before constructing the recipe). The Pool assigns this to the new
   * position; we use it to declare the NFT in `outputNFTs` so the recipe
   * engine's shield-back epilogue picks it up.
   *
   * If a different tx grabs the id first, the gas-estimate revert
   * surfaces the race cleanly before any real ETH is spent.
   */
  predictedPositionId: bigint;
};

/**
 * Encodes `PoolManager.operate(pool, 0, +collateralAmount, +targetDebt)`.
 *
 * Goes through PoolManager (not Pool directly) — Pool.operate reverts with
 * `ErrorCallerNotPoolManager` for any caller other than PoolManager.
 *
 * Consumes collateralToken from the relay adapter; produces fxUSD + an
 * ERC-721 position NFT (owner = msg.sender = relay adapter).
 */
export class FxMintOpenPositionStep extends Step {
  readonly config: StepConfig = {
    name: "f(x) Open Position",
    description:
      "Calls PoolManager.operate(pool, 0, +collateral, +debt). Mints fxUSD and a position NFT to msg.sender.",
    hasNonDeterministicOutput: false, // predictedPositionId is provided
  };

  constructor(private readonly data: FxMintOpenPositionStepData) {
    super();
  }

  protected async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
    const { pool, collateralToken, targetDebt, predictedPositionId } = this.data;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;
    const fxUSD = FX_ADDRESSES.fxUSD as Address;

    // Read the actual collateral amount from the input — the upstream
    // ZeroXV2SwapStep produces a non-deterministic amount (slippage), so
    // we can't hardcode it at construction time. Use the swap output's
    // `expectedBalance` (the quote's promised buy amount) as the value
    // we encode into operate(), and consume that exact amount from the
    // step input.
    const inputColl = input.erc20Amounts.find(
      (a) => a.tokenAddress.toLowerCase() === collateralToken.toLowerCase(),
    );
    if (!inputColl) {
      throw new Error(
        `FxMintOpenPositionStep: no input balance for collateralToken ${collateralToken}`,
      );
    }
    const collateralAmount = inputColl.expectedBalance;

    const callData = encodeFunctionData({
      abi: FX_POOL_MANAGER_ABI,
      functionName: "operate",
      args: [pool, 0n, collateralAmount, targetDebt],
    });

    return {
      crossContractCalls: [
        { to: poolManager, data: callData, value: 0n } as never,
      ],
      spentERC20Amounts: [
        {
          tokenAddress: collateralToken,
          decimals: 18n,
          amount: collateralAmount,
          recipient: poolManager,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: fxUSD,
          decimals: 18n,
          // Cookbook 2.x StepOutputERC20Amount: amount accounted at *exactly*
          // the value emitted; f(x)'s 0.5% borrow fee is already deducted
          // by the time it lands in the relay-adapter, so caller passes the
          // post-fee net here. We delegate that calc to the recipe.
          expectedBalance: targetDebt - (targetDebt * 5n) / 1000n, // 0.5% borrow fee
          minBalance: 0n,
          isBaseToken: false,
          approvedSpender: undefined,
        },
      ],
      outputNFTs: [
        {
          nftAddress: pool,
          tokenSubID: "0x" + predictedPositionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };
  }
}
