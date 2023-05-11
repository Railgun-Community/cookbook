import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeInput,
  UniswapV2Fork,
} from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { BeefyAPI, BeefyVaultData } from '../../../api/beefy/beefy-api';
import { UniV2LikeAddLiquidity_BeefyDeposit_ComboMeal } from '../uni-v2-like-add-liquidity-beefy-deposit-combo-meal';
import { UniV2LikePairContract } from '../../../contract/liquidity/uni-v2-like-pair-contract';
import { JsonRpcProvider } from '@ethersproject/providers';
import {
  getUnshieldFee,
  getUnshieldedAmountAfterFee,
} from '../../../utils/fee';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = BigNumber.from(10).pow(6);
const oneInDecimals18 = BigNumber.from(10).pow(18);
const slippagePercentage = 0.01;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18,
};
const LP_TOKEN: RecipeERC20Info = {
  tokenAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  decimals: 18,
};

const vaultID = 'sushi-mainnet-usdc-weth';
const vault: BeefyVaultData = {
  vaultID: 'sushi-mainnet-usdc-weth',
  vaultName: 'ETH-USDC LP',
  apy: 0.07759618455427408,
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Address: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  depositERC20Decimals: 18,
  vaultTokenAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
  vaultContractAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
  vaultRate: '1010912951971336619',
  depositFee: 0,
  withdrawFee: 0.001,
};

let dateStub: SinonStub;
let uniswapV2PairGetReserves: SinonStub;
let uniswapV2PairTotalSupply: SinonStub;
let beefyVaultForIDStub: SinonStub;

const provider = new JsonRpcProvider(
  'https://eth-mainnet.g.alchemy.com/v2/demo',
);

describe('sushiswap-v2-add-liquidity-beefy-deposit-combo-meal', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      vault,
    );
    dateStub = Sinon.stub(Date, 'now').returns(100_000_000);
    uniswapV2PairGetReserves = Sinon.stub(
      UniV2LikePairContract.prototype,
      'getReserves',
    ).resolves({
      reserveA: oneInDecimals6.mul(2_000_000_000), // USDC
      reserveB: oneInDecimals18.mul(1_000_000), // WETH
    });
    uniswapV2PairTotalSupply = Sinon.stub(
      UniV2LikePairContract.prototype,
      'totalSupply',
    ).resolves(oneInDecimals18.mul(2_000_000));
  });

  after(() => {
    dateStub.restore();
    uniswapV2PairGetReserves.restore();
    uniswapV2PairTotalSupply.restore();
    beefyVaultForIDStub.restore();
  });

  it('Should create sushiswap-v2-add-liquidity-beefy-deposit-combo-meal', async () => {
    const comboMeal = new UniV2LikeAddLiquidity_BeefyDeposit_ComboMeal(
      UniswapV2Fork.Sushiswap,
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      vaultID,
      provider,
    );

    const usdcAmount: RecipeERC20Amount = {
      tokenAddress: USDC_TOKEN.tokenAddress,
      decimals: USDC_TOKEN.decimals,
      amount: oneInDecimals6.mul(2000),
    };
    const { erc20UnshieldAmountB: wethAmount } =
      await comboMeal.getAddLiquidityAmountBForUnshield(
        networkName,
        usdcAmount,
      );

    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [usdcAmount, wethAmount],
      nfts: [],
    };
    const output = await comboMeal.getComboMealOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(7);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: getUnshieldFee(networkName, usdcAmount.amount),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          amount: getUnshieldFee(networkName, wethAmount.amount),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputERC20Amounts: [
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          approvedSpender: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x095ea7b3000000000000000000000000d9e1ce17f2641f24ae83637ab66a2cca9c378b9f0000000000000000000000000000000000000000000000000000000076e948c0',
          to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            wethAmount.amount,
          ),
          approvedSpender: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
        {
          expectedBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          minBalance: getUnshieldedAmountAfterFee(
            networkName,
            usdcAmount.amount,
          ),
          approvedSpender: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x095ea7b3000000000000000000000000d9e1ce17f2641f24ae83637ab66a2cca9c378b9f0000000000000000000000000000000000000000000000000dd7d4f70b73bfff',
          to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Sushiswap V2 Add Liquidity',
      description: 'Adds liquidity to a Sushiswap V2 Pool.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: BigNumber.from('0x1bb3d96af7775df9'),
          minBalance: BigNumber.from('0x1b6cee489df39d09'),
          approvedSpender: undefined,
          isBaseToken: false,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0xe8e33700000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000dd7d4f70b73bfff0000000000000000000000000000000000000000000000000000000076e948c00000000000000000000000000000000000000000000000000db464c15fd150000000000000000000000000000000000000000000000000000000000075b8df100000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a0000000000000000000000000000000000000000000000000000000005fa74e0',
          to: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        },
      ],
      spentERC20Amounts: [
        {
          amount: getUnshieldedAmountAfterFee(networkName, wethAmount.amount),
          tokenAddress: WETH_TOKEN.tokenAddress,
          recipient: 'Sushiswap V2 Pool',
          decimals: 18,
        },
        {
          amount: getUnshieldedAmountAfterFee(networkName, usdcAmount.amount),
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          recipient: 'Sushiswap V2 Pool',
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[4]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          approvedSpender: vault.vaultContractAddress,
          expectedBalance: BigNumber.from('0x1bb3d96af7775df9'),
          minBalance: BigNumber.from('0x1bb3d96af7775df9'), // TODO: 0x1b6cee489df39d09 minimum is lost from recipe output into combo.
          isBaseToken: false,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x095ea7b300000000000000000000000061f96ca5c79c9753c93244c73f1d4b4a90c1ac8c0000000000000000000000000000000000000000000000001bb3d96af7775df9',
          to: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0',
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[5]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          amount: BigNumber.from('0x00'),
          recipient: 'ETH-USDC LP Vault Deposit Fee',
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('0x1b674aafe6aabe86'),
          minBalance: BigNumber.from('0x1b674aafe6aabe86'),
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0xde5f6268',
          to: '0x61F96CA5c79c9753C93244c73f1d4b4a90c1aC8c',
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigNumber.from('0x1bb3d96af7775df9'),
          tokenAddress: LP_TOKEN.tokenAddress,
          recipient: 'ETH-USDC LP Vault',
          decimals: 18,
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[6]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('0x1189c966562fd6'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('0x1b55c0e680548eb0'),
          minBalance: BigNumber.from('0x1b55c0e680548eb0'),
          tokenAddress: vault.vaultTokenAddress,
          isBaseToken: undefined,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [
        USDC_TOKEN.tokenAddress,
        WETH_TOKEN.tokenAddress,
        LP_TOKEN.tokenAddress,
        vault.vaultTokenAddress,
      ].map(tokenAddress => tokenAddress.toLowerCase()),
    );

    expect(output.nfts).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amount: getUnshieldFee(networkName, usdcAmount.amount),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: USDC_TOKEN.tokenAddress,
        decimals: USDC_TOKEN.decimals,
      },
      {
        amount: getUnshieldFee(networkName, wethAmount.amount),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: WETH_TOKEN.tokenAddress,
        decimals: WETH_TOKEN.decimals,
      },
      {
        amount: BigNumber.from('0x00'),
        recipient: 'ETH-USDC LP Vault Deposit Fee',
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: LP_TOKEN.decimals,
      },
      {
        amount: BigNumber.from('0x1189c966562fd6'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: vault.vaultTokenAddress,
        decimals: vault.depositERC20Decimals,
      },
    ]);
  });
});
