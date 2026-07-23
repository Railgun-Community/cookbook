import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../../models/export-models';
import {
  MetaMorphoDepositQuote,
  MetaMorphoRedeemQuote,
  MetaMorphoWithdrawQuote,
} from '../../../../api/vault/morpho';
import { MetaMorphoDepositStep } from '../metamorpho-deposit-step';
import { MetaMorphoWithdrawStep } from '../metamorpho-withdraw-step';
import { MetaMorphoWithdrawByAssetsStep } from '../metamorpho-withdraw-by-assets-step';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const vaultAddress = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
const assetAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC

const depositAssets = 1_000_000n; // 1 USDC
const expectedShares = 1_000_000_000_000_000_000n; // 1e18
const minShares = 995_000_000_000_000_000n; // 0.5% slippage

const redeemShares = 500_000_000_000_000_000n;
const expectedAssets = 500_000n;
const minAssets = 497_500n;

const depositQuote: MetaMorphoDepositQuote = {
  vaultAddress,
  assetAddress,
  assetDecimals: 6n,
  shareDecimals: 18n,
  depositAssets,
  expectedShares,
  minShares,
  slippageBasisPoints: 50n,
  receiver: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
};

const redeemQuote: MetaMorphoRedeemQuote = {
  vaultAddress,
  assetAddress,
  assetDecimals: 6n,
  shareDecimals: 18n,
  redeemShares,
  expectedAssets,
  minAssets,
  slippageBasisPoints: 50n,
  receiver: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  owner: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
};

describe('metamorpho-deposit-step', () => {
  it('Should build deposit call, spend asset, output shares with min tolerance', async () => {
    const step = new MetaMorphoDepositStep(depositQuote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: assetAddress,
          decimals: 6n,
          expectedBalance: depositAssets,
          minBalance: depositAssets,
          approvedSpender: vaultAddress,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.crossContractCalls.length).to.equal(1);
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        tokenAddress: assetAddress,
        decimals: 6n,
        amount: depositAssets,
        recipient: vaultAddress,
      },
    ]);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: vaultAddress,
        decimals: 18n,
        expectedBalance: expectedShares,
        minBalance: minShares,
        approvedSpender: undefined,
      },
    ]);
  });

  it('Should reject when the asset is not approved for the vault', async () => {
    const step = new MetaMorphoDepositStep(depositQuote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: assetAddress,
          decimals: 6n,
          expectedBalance: depositAssets,
          minBalance: depositAssets,
          approvedSpender: undefined, // not approved for the vault
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInput)).to.be.rejected;
  });
});

const withdrawByAssetsQuote: MetaMorphoWithdrawQuote = {
  vaultAddress,
  assetAddress,
  assetDecimals: 6n,
  shareDecimals: 18n,
  withdrawAssets: 500_000n,
  expectedShares: 1_000_000_000_000_000_000n,
  maxShares: 1_010_000_000_000_000_000n, // +1% conservative bound
  slippageBasisPoints: 100n,
  receiver: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  owner: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
};

describe('metamorpho-withdraw-by-assets-step', () => {
  it('Should build withdraw(assets), declare deterministic asset out + conservative share spend, reshield remainder', async () => {
    const step = new MetaMorphoWithdrawByAssetsStep(withdrawByAssetsQuote);
    const inputShares = 2_000_000_000_000_000_000n; // 2 shares
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vaultAddress,
          decimals: 18n,
          expectedBalance: inputShares,
          minBalance: inputShares,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.crossContractCalls.length).to.equal(1);
    // Conservative share spend == maxShares.
    const spent = output.spentERC20Amounts ?? [];
    expect(spent[0]?.tokenAddress).to.equal(vaultAddress);
    expect(spent[0]?.amount).to.equal(withdrawByAssetsQuote.maxShares);
    // Deterministic asset output + reshielded leftover shares.
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: assetAddress,
        decimals: 6n,
        expectedBalance: withdrawByAssetsQuote.withdrawAssets,
        minBalance: withdrawByAssetsQuote.withdrawAssets,
        approvedSpender: undefined,
      },
      {
        tokenAddress: vaultAddress,
        decimals: 18n,
        expectedBalance: inputShares - withdrawByAssetsQuote.maxShares,
        minBalance: inputShares - withdrawByAssetsQuote.maxShares,
        approvedSpender: undefined,
      },
    ]);
  });

  it('Should reject when input shares are below the conservative maxShares', async () => {
    const step = new MetaMorphoWithdrawByAssetsStep(withdrawByAssetsQuote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vaultAddress,
          decimals: 18n,
          expectedBalance: 1_000_000_000_000_000_000n, // < maxShares
          minBalance: 1_000_000_000_000_000_000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInput)).to.be.rejected;
  });
});

describe('metamorpho-withdraw-step', () => {
  it('Should build redeem call, spend shares, output asset with min tolerance', async () => {
    const step = new MetaMorphoWithdrawStep(redeemQuote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vaultAddress, // ERC-4626 share token == vault
          decimals: 18n,
          expectedBalance: redeemShares,
          minBalance: redeemShares,
          approvedSpender: undefined, // no approval needed (owner == self)
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.crossContractCalls.length).to.equal(1);
    const spent = output.spentERC20Amounts ?? [];
    expect(spent[0]?.tokenAddress).to.equal(vaultAddress);
    expect(spent[0]?.amount).to.equal(redeemShares);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: assetAddress,
        decimals: 6n,
        expectedBalance: expectedAssets,
        minBalance: minAssets,
        approvedSpender: undefined,
      },
    ]);
  });
});
