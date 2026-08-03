import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import { FxMintCloseRecipe } from '../fx-mint-close-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import {
  FX_ADDRESSES,
  resolvePool,
} from '../../../../steps/borrow/fx/fx-mint-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const POSITION_ID = 1903n;

const REPAY_AMOUNT = 1_000_000_000_000_000_000n;
const APPROVE_AMOUNT = 1_005_000_000_000_000_000n;
const WITHDRAW_COLL = 500_000n;

const recipeInputFor = (
  poolAddress: string,
  fxUSDAmount = 2_000_000_000_000_000_000n,
): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [
    {
      tokenAddress: FX_ADDRESSES.fxUSD,
      decimals: 18n,
      amount: fxUSDAmount,
    },
  ],
  nfts: [
    {
      nftAddress: poolAddress,
      tokenSubID: '0x' + POSITION_ID.toString(16),
      nftTokenType: NFTTokenType.ERC721,
      amount: 1n,
    },
  ],
});

describe('FxMintCloseRecipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should build the direct step graph and shield the pool collateral', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintCloseRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: REPAY_AMOUNT,
      withdrawColl: WITHDRAW_COLL,
      approveAmount: APPROVE_AMOUNT,
      withdrawFeeRatio: 0n, // long pools charge nothing on the collateral axis
      partialClose: true,
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(pool.address),
    );

    // No swap leg on any pool — the collateral shields back as-is.
    expect(output.stepOutputs.map(s => s.name)).to.deep.equal([
      'Unshield (Default)',
      'Approve ERC20 Spender',
      'f(x) Close Position',
      'Shield (Default)',
    ]);

    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.include(pool.collateralToken.toLowerCase());

    // WETH is no longer forced as the output token.
    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.not.include(FX_ADDRESSES.WETH.toLowerCase());
  });

  it('Should keep the position NFT on a partial close', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintCloseRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: REPAY_AMOUNT,
      withdrawColl: WITHDRAW_COLL,
      approveAmount: APPROVE_AMOUNT,
      withdrawFeeRatio: 0n, // long pools charge nothing on the collateral axis
      partialClose: true,
    });

    const output = await recipe.getRecipeOutput(recipeInputFor(pool.address));
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
  });

  it('Should burn the position NFT on a full close', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintCloseRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: REPAY_AMOUNT,
      withdrawColl: WITHDRAW_COLL,
      approveAmount: APPROVE_AMOUNT,
      withdrawFeeRatio: 0n, // long pools charge nothing on the collateral axis
      partialClose: false,
    });

    const output = await recipe.getRecipeOutput(recipeInputFor(pool.address));
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(0n);
  });

  it('Should shield the pool collateral on WBTC-Long too', async () => {
    const pool = resolvePool('WBTC-Long');
    const recipe = new FxMintCloseRecipe({
      pool: 'WBTC-Long',
      positionId: POSITION_ID,
      repayAmount: REPAY_AMOUNT,
      withdrawColl: WITHDRAW_COLL,
      approveAmount: APPROVE_AMOUNT,
      withdrawFeeRatio: 0n, // long pools charge nothing on the collateral axis
      partialClose: true,
    });

    const output = await recipe.getRecipeOutput(recipeInputFor(pool.address));
    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.include(pool.collateralToken.toLowerCase());
  });

  describe('short pools (f(x) v2.1)', () => {
    const pool = resolvePool('stETH-Short');

    // A short closes by repaying wstETH to release fxUSD. Shorts charge zero
    // repay fee today, so approveAmount == repayAmount.
    const SHORT_REPAY = 1_000_000_000_000_000_000n; // 1 wstETH
    const SHORT_WITHDRAW_GROSS = 5_000_000_000_000_000_000_000n; // 5000 fxUSD

    // The unshielded input is the DEBT token for a short, not fxUSD.
    const shortInput = (): RecipeInput => ({
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress: pool.debtToken,
          decimals: pool.debtDecimals,
          amount: 2_000_000_000_000_000_000n,
        },
      ],
      nfts: [
        {
          nftAddress: pool.address,
          tokenSubID: '0x' + POSITION_ID.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    });

    it('approves the short manager to pull the debt token, and shields fxUSD back', async () => {
      const recipe = new FxMintCloseRecipe({
        pool: 'stETH-Short',
        positionId: POSITION_ID,
        repayAmount: SHORT_REPAY,
        withdrawColl: SHORT_WITHDRAW_GROSS,
        approveAmount: SHORT_REPAY,
        withdrawFeeRatio: 1_000_000n, // 0.1%, measured mainnet short value
        partialClose: true,
      });

      const output = await recipe.getRecipeOutput(shortInput());

      const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
      // The approve targets the debt token contract; the operate targets the
      // SHORT manager. The long manager must not appear anywhere.
      expect(targets).to.include(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );
      expect(targets).to.not.include(FX_ADDRESSES.fxPoolManager.toLowerCase());

      // fxUSD (the short's collateral) shields back — the mirror of a long,
      // which returns wstETH/WBTC here.
      const shielded = output.erc20AmountRecipients.map(r =>
        r.tokenAddress.toLowerCase(),
      );
      expect(shielded).to.include(FX_ADDRESSES.fxUSD.toLowerCase());

      // And it is net of the 0.1% withdraw fee, not the gross withdrawColl.
      const fxUSDBack = output.erc20AmountRecipients.find(
        r => r.tokenAddress.toLowerCase() === FX_ADDRESSES.fxUSD.toLowerCase(),
      );
      if (!fxUSDBack) {
        throw new Error('expected fxUSD to shield back');
      }
      // chai 4.x's .below typings reject bigint, so compare directly.
      expect(fxUSDBack.amount < SHORT_WITHDRAW_GROSS).to.equal(
        true,
        `expected fxUSD back (${fxUSDBack.amount}) to be net of the withdraw fee, below the gross ${SHORT_WITHDRAW_GROSS}`,
      );
    });

    it('burns the NFT on a full short close', async () => {
      const recipe = new FxMintCloseRecipe({
        pool: 'stETH-Short',
        positionId: POSITION_ID,
        repayAmount: SHORT_REPAY,
        withdrawColl: SHORT_WITHDRAW_GROSS,
        approveAmount: SHORT_REPAY,
        withdrawFeeRatio: 1_000_000n,
        partialClose: false,
      });

      const output = await recipe.getRecipeOutput(shortInput());
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(0n);
    });
  });
});
