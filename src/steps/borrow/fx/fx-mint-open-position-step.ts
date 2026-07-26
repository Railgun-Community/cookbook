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
  FEE_DENOM,
  type Address,
} from './fx-mint-util';

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
 * Consumes collateralToken from the executing account; produces fxUSD + an
 * ERC-721 position NFT (owner = msg.sender = the executing account, i.e. the
 * ephemeral EOA under EIP-7702).
 *
 * The post-fee fxUSD output `expectedBalance` accounts for f(x)'s borrow
 * fee (now driven by `borrowFeeRatio` from opts; was previously a
 * hardcoded 0.5%).
 */
export class FxMintOpenPositionStep extends Step {
  readonly config: StepConfig = {
    name: 'f(x) Open Position',
    description:
      'Calls PoolManager.operate(pool, 0, +collateral, +debt). Mints fxUSD and a position NFT to msg.sender.',
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
      collateralToken,
      collateralDecimals,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio,
    } = this.data;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;
    const fxUSD = FX_ADDRESSES.fxUSD as Address;

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
      pool,
      0n,
      collateralAmount,
      targetDebt,
    ]);

    // Borrow fee deduction: f(x) emits (targetDebt - fee) of fxUSD to
    // msg.sender (the executing account; the ephemeral EOA under EIP-7702).
    // Cookbook's StepOutputERC20Amount
    // expects the post-fee net; the recipe layer doesn't fold this in.
    // Using FEE_DENOM (1e9) — matches PoolConfiguration.getPoolFeeRatio's
    // denominator and the existing computeFxClose convention.
    const fxUSDNet = targetDebt - (targetDebt * borrowFeeRatio) / FEE_DENOM;

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
          tokenAddress: fxUSD,
          decimals: 18n,
          expectedBalance: fxUSDNet,
          // Deterministic: targetDebt and borrowFeeRatio are both known at
          // construction time. Setting minBalance = expectedBalance lets
          // future steps consume this fxUSD with a fixed amount without
          // tripping step.ts:71-83's non-deterministic-input gate.
          minBalance: fxUSDNet,
          isBaseToken: false,
          approvedSpender: undefined,
        },
      ],
      outputNFTs: [
        {
          nftAddress: pool,
          tokenSubID: '0x' + predictedPositionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };
  }
}
