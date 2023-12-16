import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  getUniswapHeaders,
  fetchUniswapQuote,
  getUniswapQuoteURL
} from '../uni-quote';
import {
  mockUniswapQuoteParams,
  mockUniswapQuoteResponse
} from './mocks';


const testWallet = '0x4025ee6512dbbda97049bcf5aa5d38c54af6be8a'

describe('uni-quote', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should return the mock quote data', async () => {
    const quoteParams = mockUniswapQuoteParams;
    const responseData = mockUniswapQuoteResponse;

    const axiosPostStub = sinon.stub(axios, 'post')
      .resolves({ data: responseData });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await fetchUniswapQuote(quoteParams);

    expect(
      axiosPostStub.calledOnceWithExactly(
        getUniswapQuoteURL(),
        quoteParams,
        getUniswapHeaders()
      )
    ).to.be.true;
    expect(result).to.deep.equal(responseData);
  });

  it('should return live quote data', async () => {
    const quoteParams = mockUniswapQuoteParams;
    const responseData = mockUniswapQuoteResponse;

    // const axiosPostStub = sinon.stub(axios, 'post')
    //   .resolves({ data: responseData });

    quoteParams.configs[0].recipient = testWallet;
    // console.log(quoteParams)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await fetchUniswapQuote(quoteParams);
    // console.log(result)

    expect(result).to.not.be.undefined;
    // expect(result).to.deep.equal(responseData);
  });

  it('should handle errors', async () => {
    const quoteParams = mockUniswapQuoteParams;
    const errorMessage = 'Some mock error message from api';

    const axiosPostStub = sinon.stub(axios, 'post').rejects(new Error(errorMessage));



    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    expect(
      async () => {
        await fetchUniswapQuote(quoteParams)
      }
    ).to.be.rejectedWith('Error: There was an error getting a quote from Uniswap.');

    expect(
      axiosPostStub.calledOnceWithExactly(
        getUniswapQuoteURL(),
        quoteParams,
        getUniswapHeaders()
      )
    ).to.be.true;

  });
});