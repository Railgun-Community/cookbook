import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import { FxMintTopupRecipe } from '../fx-mint-topup-recipe';
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

describe('FxMintTopupRecipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should build the direct step graph and return the position NFT', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintTopupRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
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

    const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
    expect(targets).to.include(FX_ADDRESSES.fxPoolManager.toLowerCase());

    // Adjust ops never reissue the position — same NFT in and out.
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
    expect(output.nftRecipients[0].nftAddress).to.equal(pool.address);
    expect(output.nftRecipients[0].recipient).to.equal(
      MOCK_RAILGUN_WALLET_ADDRESS,
    );

    // Debt unchanged: no fxUSD output.
    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.not.include(FX_ADDRESSES.fxUSD.toLowerCase());
  });

  it('Should work on WBTC-Long (8-decimal collateral)', async () => {
    const pool = resolvePool('WBTC-Long');
    const recipe = new FxMintTopupRecipe({
      pool: 'WBTC-Long',
      positionId: POSITION_ID,
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(
        pool.address,
        pool.collateralToken,
        pool.collateralDecimals,
        100_000n,
      ),
    );
    expect(output.nftRecipients).to.have.length(1);
  });

  it('Should reject an input that is not the pool collateral', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintTopupRecipe({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
    });

    await expect(
      recipe.getRecipeOutput(
        recipeInputFor(pool.address, FX_ADDRESSES.WETH, 18n),
      ),
    ).to.be.rejectedWith(/fxmint: no .* in input\.erc20Amounts/);
  });
});
