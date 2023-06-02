import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
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
import {
  getUnshieldFee,
  getUnshieldedAmountAfterFee,
} from '../../../utils/fee';
import { UniV2LikeFactoryContract } from '../../../contract/liquidity/uni-v2-like-factory-contract';
import { ZERO_ADDRESS } from '../../../models/constants';
import { JsonRpcProvider } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = 10n ** 6n;
const oneInDecimals18 = 10n ** 18n;
const slippagePercentage = 0.01;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6n,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18n,
};
const LP_TOKEN: RecipeERC20Info = {
  tokenAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  decimals: 18n,
};

const vaultID = 'sushi-mainnet-usdc-weth';
const vault: BeefyVaultData = {
  vaultID: 'sushi-mainnet-usdc-weth',
  vaultName: 'ETH-USDC LP',
  apy: 0.07759618455427408,
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Address: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  depositERC20Decimals: 18n,
  vaultTokenAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
  vaultContractAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
  vaultRate: 1010912951971336619n,
  depositFeeBasisPoints: 0n,
  withdrawFeeBasisPoints: 10n,
};

let dateStub: SinonStub;
let uniswapV2PairGetReserves: SinonStub;
let uniswapV2PairTotalSupply: SinonStub;
let beefyVaultForIDStub: SinonStub;
let uniswapV2FactoryFeeToStub: SinonStub;

const provider = new JsonRpcProvider('https://rpc.ankr.com/eth');

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
      reserveA: oneInDecimals6 * 2_000_000_000n, // USDC
      reserveB: oneInDecimals18 * 1_000_000n, // WETH
    });
    uniswapV2PairTotalSupply = Sinon.stub(
      UniV2LikePairContract.prototype,
      'totalSupply',
    ).resolves(oneInDecimals18 * 2_000_000n);
    uniswapV2FactoryFeeToStub = Sinon.stub(
      UniV2LikeFactoryContract.prototype,
      'feeTo',
    ).resolves(ZERO_ADDRESS);
  });

  after(() => {
    dateStub.restore();
    uniswapV2PairGetReserves.restore();
    uniswapV2PairTotalSupply.restore();
    beefyVaultForIDStub.restore();
    uniswapV2FactoryFeeToStub.restore();
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
      amount: oneInDecimals6 * 2000n,
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
      crossContractCalls: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
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
      crossContractCalls: [
        {
          data: '0x095ea7b3000000000000000000000000d9e1ce17f2641f24ae83637ab66a2cca9c378b9fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
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
      crossContractCalls: [
        {
          data: '0x095ea7b3000000000000000000000000d9e1ce17f2641f24ae83637ab66a2cca9c378b9fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Sushiswap V2 Add Liquidity',
      description: 'Adds liquidity to a Sushiswap V2 Pool.',
      outputERC20Amounts: [
        {
          expectedBalance: BigInt('0x1bafa9ee16e78000'),
          minBalance: BigInt('0x1b68c982bfa2a000'),
          approvedSpender: undefined,
          isBaseToken: false,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xe8e33700000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000dd7d4f70b73c0000000000000000000000000000000000000000000000000000000000076e948c00000000000000000000000000000000000000000000000000db464c15fd150000000000000000000000000000000000000000000000000000000000075b8df100000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a0000000000000000000000000000000000000000000000000000000005fa74e0',
          to: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        },
      ],
      spentERC20Amounts: [
        {
          amount: getUnshieldedAmountAfterFee(networkName, wethAmount.amount),
          tokenAddress: WETH_TOKEN.tokenAddress,
          recipient: 'Sushiswap V2 Pool',
          decimals: 18n,
        },
        {
          amount: getUnshieldedAmountAfterFee(networkName, usdcAmount.amount),
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          recipient: 'Sushiswap V2 Pool',
        },
      ],
    });

    expect(output.stepOutputs[4]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      outputERC20Amounts: [
        {
          approvedSpender: vault.vaultContractAddress,
          expectedBalance: BigInt('0x1bafa9ee16e78000'),
          minBalance: BigInt('0x1bafa9ee16e78000'), // TODO: Fix this: Actual minimum is lost from recipe output into combo.
          isBaseToken: false,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b300000000000000000000000061f96ca5c79c9753c93244c73f1d4b4a90c1ac8cffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
        },
      ],
    });

    expect(output.stepOutputs[5]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          amount: BigInt('0x00'),
          recipient: 'ETH-USDC LP Vault Deposit Fee',
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('0x1b6326c42440912b'),
          minBalance: BigInt('0x1b6326c42440912b'),
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xde5f6268',
          to: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('0x1bafa9ee16e78000'),
          tokenAddress: LP_TOKEN.tokenAddress,
          recipient: 'ETH-USDC LP Vault',
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[6]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('0x1187230ce4005c'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('0x1b519fa1175c90cf'),
          minBalance: BigInt('0x1b519fa1175c90cf'),
          tokenAddress: vault.vaultTokenAddress,
          isBaseToken: undefined,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
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

    const crossContractCallsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.crossContractCalls,
    );
    expect(output.crossContractCalls).to.deep.equal(
      crossContractCallsFlattened,
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
        amount: BigInt('0x00'),
        recipient: 'ETH-USDC LP Vault Deposit Fee',
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: LP_TOKEN.decimals,
      },
      {
        amount: BigInt('0x1187230ce4005c'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: vault.vaultTokenAddress,
        decimals: vault.depositERC20Decimals,
      },
    ]);
  });
});
