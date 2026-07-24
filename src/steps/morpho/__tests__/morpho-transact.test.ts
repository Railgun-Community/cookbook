import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../models/export-models';
import {
  MorphoBundle,
  MorphoCompilerAPI,
  BUNDLER3_ADDRESS,
  GENERAL_ADAPTER1_ADDRESS,
} from '../../../api/morpho';
import { MorphoTransactStep } from '../morpho-transact-step';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const initiator = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const VAULT = '0xbeef088055857739C12CD3765F20b7679Def0f51'; // pragma: allowlist secret

const baseBundle = (): MorphoBundle => ({
  initiator,
  calls: [{ to: BUNDLER3_ADDRESS, data: '0xabcdef', value: 0n }],
  pulls: [
    {
      tokenAddress: USDC,
      decimals: 6n,
      amount: 1_000_000_000n,
      spender: GENERAL_ADAPTER1_ADDRESS,
    },
  ],
  outputs: [
    {
      tokenAddress: VAULT,
      decimals: 18n,
      expectedAmount: 970_000_000_000_000_000n,
      minAmount: 965_000_000_000_000_000n,
    },
  ],
});

describe('morpho-compiler assertBundleSafe', () => {
  it('Should accept a well-formed bundle', () => {
    expect(() => MorphoCompilerAPI.assertBundleSafe(baseBundle())).to.not.throw();
  });

  it('Should reject an approval targeting Bundler3', () => {
    const bundle = baseBundle();
    bundle.pulls[0].spender = BUNDLER3_ADDRESS;
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw(
      /approves Bundler3/i,
    );
  });

  it('Should reject an empty call list', () => {
    const bundle = baseBundle();
    bundle.calls = [];
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw(
      /no calls/i,
    );
  });

  it('Should reject minAmount > expectedAmount', () => {
    const bundle = baseBundle();
    bundle.outputs[0].minAmount = bundle.outputs[0].expectedAmount + 1n;
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw(
      /minAmount > expectedAmount/i,
    );
  });

  it('Should reject an invalid initiator', () => {
    const bundle = baseBundle();
    bundle.initiator = '0x0000000000000000000000000000000000000000';
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw();
  });

  it('Should reject a call carrying native value', () => {
    const bundle = baseBundle();
    bundle.calls[0].value = 1n;
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw(
      /native value/i,
    );
  });

  it('Should reject duplicate-token pulls', () => {
    const bundle = baseBundle();
    bundle.pulls.push({
      tokenAddress: USDC,
      decimals: 6n,
      amount: 500_000_000n,
      spender: GENERAL_ADAPTER1_ADDRESS,
    });
    expect(() => MorphoCompilerAPI.assertBundleSafe(bundle)).to.throw(
      /duplicates token/i,
    );
  });

  it('Should bind the initiator to the expected executor when provided', () => {
    const bundle = baseBundle();
    expect(() =>
      MorphoCompilerAPI.assertBundleSafe(bundle, initiator),
    ).to.not.throw();
    expect(() =>
      MorphoCompilerAPI.assertBundleSafe(
        bundle,
        '0x1111111111111111111111111111111111111111',
      ),
    ).to.throw(/does not match the expected executor/i);
  });
});

describe('morpho-transact-step', () => {
  it('Should compile calls, spend the pull, output delivered token + change', async () => {
    const step = new MorphoTransactStep(baseBundle());
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          expectedBalance: 1_500_000_000n, // 1500 USDC, 500 change after 1000 pull
          minBalance: 1_500_000_000n,
          approvedSpender: GENERAL_ADAPTER1_ADDRESS,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.crossContractCalls.length).to.equal(1);
    expect(output.crossContractCalls[0].to).to.equal(BUNDLER3_ADDRESS);
    expect(output.crossContractCalls[0].data).to.equal('0xabcdef');

    expect(output.spentERC20Amounts).to.deep.equal([
      {
        tokenAddress: USDC,
        decimals: 6n,
        amount: 1_000_000_000n,
        recipient: GENERAL_ADAPTER1_ADDRESS,
      },
    ]);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: VAULT,
        decimals: 18n,
        expectedBalance: 970_000_000_000_000_000n,
        minBalance: 965_000_000_000_000_000n,
        approvedSpender: undefined,
      },
      {
        tokenAddress: USDC,
        decimals: 6n,
        expectedBalance: 500_000_000n,
        minBalance: 500_000_000n,
        approvedSpender: GENERAL_ADAPTER1_ADDRESS,
      },
    ]);
  });

  it('Should reject when the pulled token is not approved for the spender', async () => {
    const step = new MorphoTransactStep(baseBundle());
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          expectedBalance: 1_000_000_000n,
          minBalance: 1_000_000_000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInput)).to.be.rejected;
  });
});
