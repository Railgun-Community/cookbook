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

export type FxMintAdjustPositionStepData = {
  /** f(x) Pool address (also the position-NFT contract). */
  pool: Address;
  /** Collateral token address for this pool. */
  collateralToken: Address;
  /**
   * Native-units decimals for the collateral token. Plumbed from the
   * pool registry by the recipe (resolvePool().collateralDecimals).
   * Cookbook's amount accounting must match the on-chain token's
   * decimals; off by 10^(18-decimals) for non-18-decimal collateral
   * if mis-set.
   */
  collateralDecimals: bigint;
  /** Existing position to adjust. */
  positionId: bigint;
  /**
   * Signed collateral delta, in native collateral units:
   *   > 0: deposit additional collateral (relay-adapter must hold the amount)
   *   < 0: withdraw collateral (out of v0.1 scope; reserved for v0.2's
   *        FxMintWithdrawCollateralRecipe — the step accepts the value
   *        but no v0.1 recipe wires it through).
   *   = 0: no-op on the collateral axis
   */
  collDelta: bigint;
  /**
   * Signed debt delta, in fxUSD wei:
   *   > 0: mint additional fxUSD (PoolManager pays the relay-adapter,
   *        net of borrow fee).
   *   < 0: burn fxUSD to repay debt (PoolManager pulls fxUSD from the
   *        relay-adapter, including the f(x) repay fee uplift; recipe's
   *        preceding ApproveERC20SpenderStep authorizes the pull).
   *   = 0: no-op on the debt axis
   */
  debtDelta: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Required iff debtDelta > 0; ignored otherwise. Caller fetches via
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[2] (tuple index
   * confirmed in discovery-notes.md).
   */
  borrowFeeRatio?: bigint;
  /**
   * f(x)'s repay fee for this (pool, operator), 1e9-denominated.
   * Required iff debtDelta < 0; ignored otherwise.
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[3].
   */
  repayFeeRatio?: bigint;
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
 * Step output shape is conditional:
 *   - collDelta > 0: declares spentERC20Amounts for the input collateral
 *     (looked up from input.erc20Amounts matching collateralToken;
 *     amount = inputColl.expectedBalance, mirroring FxMintOpenPositionStep).
 *   - debtDelta > 0: declares outputERC20Amounts for the post-borrow-fee
 *     fxUSD net (= debtDelta × (FEE_DENOM - borrowFeeRatio) / FEE_DENOM).
 *   - debtDelta < 0: declares spentERC20Amounts for the fxUSD consumed
 *     (= |debtDelta| × (FEE_DENOM + repayFeeRatio) / FEE_DENOM; PoolManager
 *     pulls this amount from the relay-adapter via the recipe's preceding
 *     approve step). Matches the close-side accounting pattern.
 *
 * v0.1 recipes only use non-negative collDelta. Negative-collDelta is
 * accommodated structurally for v0.2's withdraw-collateral recipe, but
 * no v0.1 recipe constructs the step with collDelta < 0.
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

    this.data = data;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      pool,
      collateralToken,
      collateralDecimals,
      positionId,
      collDelta,
      debtDelta,
      borrowFeeRatio,
      repayFeeRatio,
    } = this.data;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;
    const fxUSD = FX_ADDRESSES.fxUSD as Address;

    // Encoded operate() — passes signed deltas straight through. The Pool
    // contract handles the rawColls/rawDebts internal conversion. Using
    // ethers' Interface (matches cookbook house style; we don't ship a
    // typechain binding for the f(x) PoolManager).
    const iface = new Interface(FX_POOL_MANAGER_ABI);
    const callData = iface.encodeFunctionData('operate', [
      pool,
      positionId,
      collDelta,
      debtDelta,
    ]);

    // ---- spentERC20Amounts ----
    const spentERC20Amounts: NonNullable<
      UnvalidatedStepOutput['spentERC20Amounts']
    > = [];

    if (collDelta > 0n) {
      // Caller (recipe) ensures the input collateral matches collDelta.
      // Look up the input balance — the upstream may be a 0x swap with
      // non-deterministic output, in which case the recipe encoded
      // collDelta from the swap quote's promised buy amount but the
      // step still consumes inputColl.expectedBalance for accounting.
      const inputColl = input.erc20Amounts.find(
        a => a.tokenAddress.toLowerCase() === collateralToken.toLowerCase(),
      );
      if (!inputColl) {
        throw new Error(
          `FxMintAdjustPositionStep: no input balance for collateralToken ${collateralToken} (collDelta > 0 requires it)`,
        );
      }
      spentERC20Amounts.push({
        tokenAddress: collateralToken,
        decimals: collateralDecimals,
        amount: inputColl.expectedBalance,
        recipient: poolManager,
      });
    }

    if (debtDelta < 0n) {
      // PoolManager.operate(... , -X) pulls X × (1e9 + repayFeeRatio)/1e9
      // of fxUSD from the relay-adapter via transferFrom (allowed by the
      // recipe's preceding approve step). Declared here so cookbook's
      // amount accounting reflects the actual outflow.
      const debtBurn = -debtDelta;
      const fxUSDPulled = (debtBurn * (FEE_DENOM + repayFeeRatio!)) / FEE_DENOM;
      spentERC20Amounts.push({
        tokenAddress: fxUSD,
        decimals: 18n,
        amount: fxUSDPulled,
        recipient: poolManager,
      });
    }

    // ---- outputERC20Amounts ----
    const outputERC20Amounts: NonNullable<
      UnvalidatedStepOutput['outputERC20Amounts']
    > = [];

    if (debtDelta > 0n) {
      // Post-borrow-fee net fxUSD lands in the relay-adapter and shields
      // back to the user.
      const fxUSDNet = debtDelta - (debtDelta * borrowFeeRatio!) / FEE_DENOM;
      outputERC20Amounts.push({
        tokenAddress: fxUSD,
        decimals: 18n,
        expectedBalance: fxUSDNet,
        // Deterministic: debtDelta and borrowFeeRatio are both known at
        // construction time. minBalance = expectedBalance keeps the
        // output spendable by future fixed-amount steps without hitting
        // step.ts:71-83's non-deterministic-input gate.
        minBalance: fxUSDNet,
        isBaseToken: false,
        approvedSpender: undefined,
      });
    }

    if (debtDelta < 0n) {
      // Orphan fxUSD pass-through — mirrors FxMintClosePositionStep's
      // pattern. The repay path receives the user's full shielded fxUSD
      // (so the wallet doesn't have to know approveAmount when unshielding);
      // ApproveERC20SpenderStep marks only `approveAmount` as
      // approvedSpender=PoolManager, leaving the rest as orphan change.
      // Cookbook's step-validator (validators/step-validator.ts) demands
      // input == spent + outputs + fees per token at THIS step (recipe-
      // engine epilogue shield-back happens AFTER all steps and isn't
      // accounted for inside the step-level check). Pass the orphan
      // through as an output so the balance closes to the wei.
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
      outputERC20Amounts.push(...orphanFxUSD);
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
        nftAddress: pool,
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
