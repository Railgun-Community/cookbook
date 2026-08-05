import chai from 'chai';
import { NetworkName } from '@railgun-community/shared-models';
import Sinon, { SinonStub } from 'sinon';
import {
  ZERO_X_V2_EXCHANGE_LABEL,
  ZERO_X_V2_SWAP_PROVIDER,
  ZERO_X_V2_SWAP_STEP_NAME,
} from '../zero-x-v2-swap-provider';
import type { SwapProvider } from '../swap-provider';
import { ZeroXV2Quote } from '../../zero-x-v2/zero-x-v2-quote';
import { ZeroXV2SwapStep } from '../../../steps/swap/zero-x/zero-x-v2-swap-step';
import type {
  StepInput,
  SwapQuoteData,
} from '../../../models/export-models';

const { expect } = chai;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret
const SPENDER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // pragma: allowlist secret
const EXECUTOR = '0x1111111111111111111111111111111111111111';

const quoteFor = (): SwapQuoteData =>
  ({
    sellTokenValue: '1000000',
    sellTokenAddress: USDC,
    spender: SPENDER,
    crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
    buyERC20Amount: { tokenAddress: WETH, decimals: 18n, amount: 500n },
    minimumBuyAmount: 495n,
    price: 0n,
    guaranteedPrice: 0n,
    slippageBasisPoints: 100n,
  }) as unknown as SwapQuoteData;

describe('SwapProvider', () => {
  let stub: SinonStub;

  afterEach(() => {
    stub?.restore();
  });

  it('Should name the 0x provider consistently with its step', () => {
    // Load-bearing, not cosmetic: `SwapRecipe.getBuySellAmountsFromRecipeOutput`
    // locates the swap step by matching the provider's name against
    // `stepOutputs[2].name`. If the two drift, quote read-back breaks silently.
    const step = new ZeroXV2SwapStep(quoteFor(), {
      tokenAddress: USDC,
      decimals: 6n,
    });
    expect(step.config.name).to.equal(ZERO_X_V2_SWAP_PROVIDER.name);
    expect(step.config.name).to.equal(ZERO_X_V2_SWAP_STEP_NAME);
    expect(step.config.description).to.equal(
      ZERO_X_V2_SWAP_PROVIDER.description,
    );
  });

  it('Should label the counterparty from the provider', async () => {
    const input: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          expectedBalance: 1_000_000n,
          minBalance: 1_000_000n,
          approvedSpender: SPENDER,
          isBaseToken: false,
        },
      ],
      nfts: [],
    };
    const output = await new ZeroXV2SwapStep(quoteFor(), {
      tokenAddress: USDC,
      decimals: 6n,
    }).getValidStepOutput(input);

    // A label, never an address — the `recipient` field is polymorphic and
    // carries human labels on spent/fee arrays.
    expect(output.spentERC20Amounts?.[0].recipient).to.equal(
      ZERO_X_V2_EXCHANGE_LABEL,
    );
  });

  it('Should delegate quoting to ZeroXV2Quote without reshaping the result', async () => {
    const quote = quoteFor();
    stub = Sinon.stub(ZeroXV2Quote, 'getSwapQuote').resolves(
      quote as never,
    );

    const result = await ZERO_X_V2_SWAP_PROVIDER.getQuote({
      networkName: NetworkName.Ethereum,
      sellERC20Amount: { tokenAddress: USDC, decimals: 6n, amount: 1_000_000n },
      buyERC20Info: { tokenAddress: WETH, decimals: 18n },
      slippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    // The adapter is thin on purpose: `SwapQuoteData` was already provider-
    // agnostic, so there is nothing to translate and translating would be a
    // place for the two to disagree.
    expect(result).to.equal(quote);
    expect(stub.firstCall.args[0].recipient).to.equal(EXECUTOR);
    expect(stub.firstCall.args[0].isRailgun).to.equal(false);
  });

  it('Should report network support without throwing', () => {
    expect(ZERO_X_V2_SWAP_PROVIDER.supportsNetwork(NetworkName.Ethereum)).to.equal(
      true,
    );
    // An unsupported chain answers false rather than raising, so a caller can
    // route around it instead of discovering it by exception.
    expect(
      ZERO_X_V2_SWAP_PROVIDER.supportsNetwork(
        NetworkName.EthereumSepolia,
      ),
    ).to.be.a('boolean');
  });

  it('Should accept a second provider with no 0x dependency', async () => {
    // The actual claim of this seam. If a second aggregator required anything
    // beyond these four members, this would not compile — which is the point of
    // asserting it here rather than in prose.
    const fakeQuote = quoteFor();
    const secondProvider: SwapProvider = {
      name: 'Example Aggregator Swap',
      exchangeLabel: 'Example Aggregator',
      description: 'Swaps two ERC20 tokens using a hypothetical aggregator.',
      supportsNetwork: networkName => networkName === NetworkName.Ethereum,
      getQuote: async () => fakeQuote,
    };

    const result = await secondProvider.getQuote({
      networkName: NetworkName.Ethereum,
      sellERC20Amount: { tokenAddress: USDC, decimals: 6n, amount: 1_000_000n },
      buyERC20Info: { tokenAddress: WETH, decimals: 18n },
      slippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    expect(result.spender).to.equal(SPENDER);
    expect(secondProvider.supportsNetwork(NetworkName.Ethereum)).to.equal(true);
    expect(secondProvider.supportsNetwork(NetworkName.Polygon)).to.equal(false);
  });

  it('Should drive the shipped swap step from a second provider quote', async () => {
    // Stronger than the previous test: the STEP — not just the interface — runs
    // on a quote that never touched 0x. This is what makes "the step is already
    // provider-agnostic" a checked claim rather than an observation.
    const secondProvider: SwapProvider = {
      name: 'Example Aggregator Swap',
      exchangeLabel: 'Example Aggregator',
      description: 'Hypothetical.',
      supportsNetwork: () => true,
      getQuote: async () => quoteFor(),
    };
    const quote = await secondProvider.getQuote({
      networkName: NetworkName.Ethereum,
      sellERC20Amount: { tokenAddress: USDC, decimals: 6n, amount: 1_000_000n },
      buyERC20Info: { tokenAddress: WETH, decimals: 18n },
      slippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    const output = await new ZeroXV2SwapStep(quote, {
      tokenAddress: USDC,
      decimals: 6n,
    }).getValidStepOutput({
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          expectedBalance: 1_000_000n,
          minBalance: 1_000_000n,
          approvedSpender: SPENDER,
          isBaseToken: false,
        },
      ],
      nfts: [],
    });

    expect(output.crossContractCalls).to.have.length(1);
    expect(output.outputERC20Amounts[0].tokenAddress).to.equal(WETH);
    expect(output.outputERC20Amounts[0].minBalance).to.equal(495n);
  });
});
