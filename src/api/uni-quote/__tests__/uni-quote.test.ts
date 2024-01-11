import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  UniswapQuote

} from '../uni-quote';
import {
  mockUniswapQuoteParams,
  mockUniswapQuoteResponse
} from './mocks';
import { UniswapQuoteParams } from '../../../models/uni-quote';


const testWallet = '0x4025ee6512dbbda97049bcf5aa5d38c54af6be8a'


describe('uni-quote', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should return the mock quote data', async () => {
    const quoteParams = mockUniswapQuoteParams as UniswapQuoteParams;
    const responseData = mockUniswapQuoteResponse;

    const axiosPostStub = sinon.stub(axios, 'post')
      .resolves({ data: responseData });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await UniswapQuote.getSwapQuote(quoteParams);

    expect(
      axiosPostStub.calledOnceWithExactly(
        UniswapQuote.getUniswapQuoteURL(),
        quoteParams,
        UniswapQuote.getUniswapHeaders()
      )
    ).to.be.true;
    expect(result).to.deep.equal(responseData);
  });

  it('should return live quote data', async () => {
    const quoteParams = mockUniswapQuoteParams as UniswapQuoteParams;
    // const responseData = mockUniswapQuoteResponse;

    // const axiosPostStub = sinon.stub(axios, 'post')
    //   .resolves({ data: responseData });

    quoteParams.configs[0].recipient = testWallet;
    // console.log(quoteParams)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await UniswapQuote.getSwapQuote(quoteParams);
    // console.log(result)

    expect(result).to.not.be.undefined;
    // expect(result).to.deep.equal(responseData);
  });

  it('should handle errors', async () => {
    const quoteParams = mockUniswapQuoteParams as UniswapQuoteParams;
    const errorMessage = 'Some mock error message from api';

    const axiosPostStub = sinon.stub(axios, 'post').rejects(new Error(errorMessage));

    const result = UniswapQuote.getSwapQuote(quoteParams);

    // // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await expect(
      result
    ).to.be.rejectedWith(errorMessage);

    expect(
      axiosPostStub.calledOnceWithExactly(
        UniswapQuote.getUniswapQuoteURL(),
        quoteParams,
        UniswapQuote.getUniswapHeaders()
      )
    ).to.be.true;

  });
});