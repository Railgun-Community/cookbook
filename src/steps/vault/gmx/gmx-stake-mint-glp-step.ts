import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import {
  compareERC20Info,
  compareTokenAddresses,
  isApprovedForSpender,
} from '../../../utils/token';
import { Step } from '../../step';
import { GmxRewardRouterV2Contract } from '../../../contract/vault/gmx/gmx-reward-router-v2-contract';
import { GLP_DECIMALS, GMX } from '../../../api/gmx/gmx';
import { minBalanceAfterSlippage } from '../../../utils/number';

import { AccessCardOwnerAccountContract } from '../../../contract/access-card/access-card-owner-account-contract';
import { Provider } from 'ethers';

export class GMXMintStakeGLPStep extends Step {
  readonly config: StepConfig = {
    name: 'GMX Mint and Stake GLP',
    description: 'Mints GLP token into a receiver address and stakes into GMX.',
    hasNonDeterministicOutput: true,
  };

  private readonly stakeERC20Info: RecipeERC20Info;

  private readonly slippagePercentage: number;

  private readonly nftOwnedAccountAddress: string;

  private readonly provider: Provider;

  constructor(
    stakeERC20Info: RecipeERC20Info,
    slippagePercentage: number,
    nftOwnedAccountAddress: string,
    provider: Provider,
  ) {
    super();
    this.stakeERC20Info = stakeERC20Info;
    this.slippagePercentage = slippagePercentage;
    this.nftOwnedAccountAddress = nftOwnedAccountAddress;
    this.provider = provider;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts, networkName } = input;

    const { glpAddress, rewardRouterContractAddress, stakeableERC20Addresses } =
      GMX.getGMXInfoForNetwork(networkName);

    if (
      !compareTokenAddresses(
        stakeableERC20Addresses,
        this.stakeERC20Info.tokenAddress,
      )
    ) {
      throw new Error(
        `ERC20 token ${this.stakeERC20Info.tokenAddress} is not stakeable in GMX.`,
      );
    }

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, this.stakeERC20Info) &&
          isApprovedForSpender(erc20Amount, rewardRouterContractAddress),
        undefined, // amount
      );

    const expectedGlpAmount = await GMX.getExpectedGLPMintAmountForToken(
      networkName,
      this.stakeERC20Info,
      erc20AmountForStep.expectedBalance,
      this.provider,
    );
    const minGlpAmount: bigint = minBalanceAfterSlippage(
      expectedGlpAmount,
      this.slippagePercentage,
    );

    const gmxRewardRouter = new GmxRewardRouterV2Contract(
      rewardRouterContractAddress,
    );
    const mintStakeTransaction = await gmxRewardRouter.createMintAndStakeGlp(
      erc20AmountForStep.tokenAddress,
      erc20AmountForStep.expectedBalance,
      0n, // TODO: Min USDG
      minGlpAmount,
    );
    if (
      mintStakeTransaction.to == null ||
      mintStakeTransaction.data == null ||
      mintStakeTransaction.value == null
    ) {
      throw new Error('Unexpected null values for mint-stake tx');
    }

    const nftOwnedAccount = new AccessCardOwnerAccountContract(
      this.nftOwnedAccountAddress,
    );
    const crossContractCall = await nftOwnedAccount.createCall(
      mintStakeTransaction.to,
      mintStakeTransaction.data,
      mintStakeTransaction.value,
    );

    const spentERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...this.stakeERC20Info,
      amount: erc20AmountForStep.expectedBalance,
      recipient: 'GLP Vault',
    };
    const outputERC20Amount: StepOutputERC20Amount = {
      tokenAddress: glpAddress,
      decimals: GLP_DECIMALS,
      expectedBalance: expectedGlpAmount,
      minBalance: minGlpAmount,
      approvedSpender: undefined,
    };
    const feeERC20AmountRecipient: RecipeERC20AmountRecipient = {
      tokenAddress: glpAddress,
      decimals: GLP_DECIMALS,
      amount: 0n,
      recipient: 'GLP Staking Fee',
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentERC20AmountRecipient],
      outputERC20Amounts: [outputERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [feeERC20AmountRecipient],
    };
  }
}
