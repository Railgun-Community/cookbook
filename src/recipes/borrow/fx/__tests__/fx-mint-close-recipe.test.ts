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
      partialClose: true,
    });

    const output = await recipe.getRecipeOutput(recipeInputFor(pool.address));
    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.include(pool.collateralToken.toLowerCase());
  });
});
