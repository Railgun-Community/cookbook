import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { getBaseToken } from '../../utils/wrap-util';
import { ContractTransaction } from 'ethers';
import { LidoWSTETHContract } from '../../contract/lido';
import { Provider } from 'ethers';

// TODO: remove shortcut from name
export class LidoUnstakeShortcutStep extends Step {
  readonly config: StepConfig = {
    name: 'Lido Unstaking [wstETH]',
    description: 'Unstake wstETH to get WETH',
  };

  private provider: Provider;

  constructor(private wstETHTokenInfo: RecipeERC20Info, provider: Provider) {
    super();
    this.provider = provider;
  }

  private getWrappedAmount(stakeAmount: bigint): Promise<bigint> {
    const wstETHContract = new LidoWSTETHContract(
      this.wstETHTokenInfo.tokenAddress,
      this.provider,
    );
    return wstETHContract.getWstETHByStETH(stakeAmount);
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {

    // get input of wsteth token.
    // call unwrap wsth. 


    const { networkName, erc20Amounts } = input;

    const baseToken = getBaseToken(networkName);
    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, this.wstETHTokenInfo),
        undefined,
      );

    // confirm that input erc20 is the expected wsteth

    const wstethContract = new LidoWSTETHContract(this.wstETHTokenInfo.tokenAddress); 
    const unwrapCall = await wstethContract.unwrap(erc20AmountForStep.minBalance);


    const amount = erc20AmountForStep.expectedBalance;
    const contract = new RelayAdaptContract(input.networkName);
    const crossContractCalls = [unwrapCall];
    // ContractTransaction[] = [
    //   await contract.multicall(false, [
    //     {
    //       to: this.wstETHTokenInfo.tokenAddress,
    //       data: '0x',
    //       value: amount,
    //     },
    //   ]),
    // ];

    const transferredBaseToken: RecipeERC20AmountRecipient = {
      ...this.wstETHTokenInfo,
      amount,
      recipient: this.wstETHTokenInfo.tokenAddress,
    };

    const wrappedAmount = await this.getWrappedAmount(amount);
    const outputWSTETHToken: StepOutputERC20Amount = {
      ...baseToken,
      isBaseToken: true,
      expectedBalance: wrappedAmount,
      minBalance: wrappedAmount,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls,
      spentERC20Amounts: [transferredBaseToken],
      outputERC20Amounts: [outputWSTETHToken, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
