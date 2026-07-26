import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import { FxMintTopupAndBorrowRecipe } from '../fx-mint-topup-and-borrow-recipe';
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
const ADDITIONAL_DEBT = 1_000_000_000_000_000_000n;

const recipeInputFor = (
  poolAddress: string,
  collateralToken: string,
  decimals: bigint,
  amount = 1_000_000n,
): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [{ tokenAddress: collateralToken, decimals, amount }],
  nfts: [
    {
      nftAddress: poolAddress,
      tokenSubID: '0x' + POSITION_ID.toString(16),
      nftTokenType: NFTTokenType.ERC721,
      amount: 1n,
    },
  ],
});

describe('FxMintTopupAndBorrowRecipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should throw when additionalDebt is not positive', () => {
    expect(
      () =>
        new FxMintTopupAndBorrowRecipe({
          pool: 'wstETH-Long',
          positionId: POSITION_ID,
          additionalDebt: 0n,
          borrowFeeRatio: 5_000_000n,
        }),
    ).to.throw(/additionalDebt must be > 0/);
  });

  it('Should build the direct step graph and output NFT + fxUSD', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintTopupAndBorrowRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      additionalDebt: ADDITIONAL_DEBT,
      borrowFeeRatio: 5_000_000n, // 0.5% of 1e9
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(
        pool.address,
        pool.collateralToken,
        pool.collateralDecimals,
      ),
    );

    expect(output.stepOutputs.map(s => s.name)).to.deep.equal([
      'Unshield (Default)',
      'Approve ERC20 Spender',
      'f(x) Adjust Position',
      'Shield (Default)',
    ]);

    // Position NFT survives the lever-up (same id).
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);

    // Post-borrow-fee net fxUSD shields back.
    const fxUSDOut = output.erc20AmountRecipients.find(
      r => r.tokenAddress.toLowerCase() === FX_ADDRESSES.fxUSD.toLowerCase(),
    );
    if (!fxUSDOut) {
      throw new Error('expected fxUSD in erc20AmountRecipients');
    }
    expect(fxUSDOut.amount > 0n).to.equal(true);
    expect(fxUSDOut.amount < ADDITIONAL_DEBT).to.equal(true);
  });

  it('Should reject an input that is not the pool collateral', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintTopupAndBorrowRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      additionalDebt: ADDITIONAL_DEBT,
      borrowFeeRatio: 5_000_000n,
    });

    await expect(
      recipe.getRecipeOutput(
        recipeInputFor(pool.address, FX_ADDRESSES.WETH, 18n),
      ),
    ).to.be.rejectedWith(/fxmint: no .* in input\.erc20Amounts/);
  });
});
