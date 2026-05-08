import { encodeFunctionData, type Address } from "viem";
import { NFTTokenType } from "@railgun-community/shared-models";
import { Step } from '../../step';
import type { StepConfig, StepInput, UnvalidatedStepOutput } from '../../../models/export-models';
import { FX_ADDRESSES, FX_POOL_MANAGER_ABI, FEE_DENOM } from './fx-mint-util';

export type FxMintOpenPositionStepData = {
  /** f(x) Pool address. The position NFT is minted by this contract. */
  pool: Address;
  /** Collateral token address (wstETH for wstETH-Long, WBTC for WBTC-Long). */
  collateralToken: Address;
  /**
   * Native-units decimals for the collateral token (wstETH = 18, WBTC = 8).
   * Cookbook's amount accounting must match the on-chain token's decimals;
   * this field is plumbed from the pool registry by the recipe (see
   * `resolvePool().collateralDecimals` in fx-mint-util.ts).
   */
  collateralDecimals: bigint;
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
  /**
   * f(x)'s borrow fee for this (pool, operator) pair, 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (tuple confirmed in discovery-notes.md). Previously hardcoded to
   * `5n / 1000n` (= 0.5% in /1000 denom — wrong denom AND wrong value if
   * f(x) governance moves the rate). Now dynamic and using FEE_DENOM (1e9).
   */
  borrowFeeRatio: bigint;
};

/**
 * Encodes `PoolManager.operate(pool, 0, +collateralAmount, +targetDebt)`.
 *
 * Goes through PoolManager (not Pool directly) — Pool.operate reverts with
 * `ErrorCallerNotPoolManager` for any caller other than PoolManager.
 *
 * Consumes collateralToken from the relay adapter; produces fxUSD + an
 * ERC-721 position NFT (owner = msg.sender = relay adapter).
 *
 * The post-fee fxUSD output `expectedBalance` accounts for f(x)'s borrow
 * fee (now driven by `borrowFeeRatio` from opts; was previously a
 * hardcoded 0.5%).
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
    const {
      pool,
      collateralToken,
      collateralDecimals,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio,
    } = this.data;
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

    // Borrow fee deduction: f(x) emits (targetDebt - fee) of fxUSD to
    // msg.sender (the relay-adapter). Cookbook's StepOutputERC20Amount
    // expects the post-fee net; the recipe layer doesn't fold this in.
    // Using FEE_DENOM (1e9) — matches PoolConfiguration.getPoolFeeRatio's
    // denominator and the existing computeFxClose convention.
    const fxUSDNet = targetDebt - (targetDebt * borrowFeeRatio) / FEE_DENOM;

    return {
      crossContractCalls: [
        { to: poolManager, data: callData, value: 0n } as never,
      ],
      spentERC20Amounts: [
        {
          tokenAddress: collateralToken,
          decimals: collateralDecimals,
          amount: collateralAmount,
          recipient: poolManager,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: fxUSD,
          decimals: 18n,
          expectedBalance: fxUSDNet,
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
