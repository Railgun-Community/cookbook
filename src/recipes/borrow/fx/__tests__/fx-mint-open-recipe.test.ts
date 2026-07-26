import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { FxMintOpenRecipe } from '../fx-mint-open-recipe';
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
  type Address,
} from '../../../../steps/borrow/fx/fx-mint-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const recipeInputFor = (
  collateralToken: string,
  decimals: bigint,
  amount = 1_000_000n,
): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [{ tokenAddress: collateralToken, decimals, amount }],
  nfts: [],
});

describe('FxMintOpenRecipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should build the direct step graph for wstETH-Long', async () => {
    const pool = resolvePool('wstETH-Long');
    const recipe = new FxMintOpenRecipe({
      pool: 'wstETH-Long',
      targetDebt: 5_000_000_000_000_000_000n,
      predictedPositionId: 1903n,
      borrowFeeRatio: 5_000_000n,
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(pool.collateralToken, pool.collateralDecimals),
    );

    // unshield + approve + operate + shield. No swap leg, on any pool.
    expect(output.stepOutputs.map(s => s.name)).to.deep.equal([
      'Unshield (Default)',
      'Approve ERC20 Spender',
      'f(x) Open Position',
      'Shield (Default)',
    ]);

    const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
    expect(targets).to.include(FX_ADDRESSES.fxPoolManager.toLowerCase());

    // fxUSD and the position NFT shield back to the user.
    expect(
      output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
    ).to.include(FX_ADDRESSES.fxUSD.toLowerCase());
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].nftAddress).to.equal(pool.address);
    expect(output.nftRecipients[0].tokenSubID).to.equal('0x76f');
  });

  it('Should build the same graph for WBTC-Long (8-decimal collateral)', async () => {
    const pool = resolvePool('WBTC-Long');
    const recipe = new FxMintOpenRecipe({
      pool: 'WBTC-Long',
      targetDebt: 1_000_000_000_000_000_000n,
      predictedPositionId: 42n,
      borrowFeeRatio: 5_000_000n,
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(pool.collateralToken, pool.collateralDecimals, 100_000n),
    );

    expect(output.stepOutputs.length).to.equal(4);
    expect(output.nftRecipients[0].nftAddress).to.equal(pool.address);
  });

  it('Should accept a custom pool ref', async () => {
    const customPool = {
      address: '0x1111111111111111111111111111111111111111' as Address,
      collateralToken: FX_ADDRESSES.wstETH,
      collateralDecimals: 18n,
    };
    const recipe = new FxMintOpenRecipe({
      pool: customPool,
      targetDebt: 1_000_000_000_000_000_000n,
      predictedPositionId: 1n,
      borrowFeeRatio: 0n,
    });

    const output = await recipe.getRecipeOutput(
      recipeInputFor(customPool.collateralToken, 18n),
    );
    expect(output.nftRecipients[0].nftAddress).to.equal(customPool.address);
  });

  it('Should reject an input that is not the pool collateral', async () => {
    const recipe = new FxMintOpenRecipe({
      pool: 'wstETH-Long',
      targetDebt: 1_000_000_000_000_000_000n,
      predictedPositionId: 1n,
      borrowFeeRatio: 0n,
    });

    // WETH used to be the *required* input on the old swap path. It is now just
    // another token, and entering from it is a ComboMeal's job.
    await expect(
      recipe.getRecipeOutput(recipeInputFor(FX_ADDRESSES.WETH, 18n)),
    ).to.be.rejectedWith(/fxmint: no .* in input\.erc20Amounts/);
  });
});
