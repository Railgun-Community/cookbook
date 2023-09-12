import {
  ApproveERC20SpenderStep,
  Step,
  TransferERC20Step,
} from '../../../steps';
import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../../models/export-models';
import { Recipe } from '../../recipe';
import { GMX } from '../../../api/gmx/gmx';
import { GMXMintStakeGLPStep } from '../../../steps/vault/gmx/gmx-stake-mint-glp-step';
import { AccessCardNFTMintStep } from '../../../steps/access-card/access-card-nft-mint-step';
import { AccessCardNFT } from '../../../api/access-card/access-card-nft';

import { getRandomNFTID } from '../../../utils';
import { AccessCardCreateNFTOwnerStep } from '../../../steps/access-card/access-card-create-nft-owner-step';
import { Provider } from 'ethers';
import { MIN_GAS_LIMIT_ANY_RECIPE } from '../../../models/min-gas-limits';

export class GMXMintStakeGLPRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'GMX Mint and Stake GLP Recipe',
    description:
      'Stakes into GMX and mints GLP token into an account owned by an Access Card NFT.',
    minGasLimit: MIN_GAS_LIMIT_ANY_RECIPE, // TODO: UPDATE GAS LIMIT
  };

  protected readonly stakeERC20Info: RecipeERC20Info;

  private readonly slippageBasisPoints: bigint;

  private readonly provider: Provider;

  private readonly nftTokenSubID: bigint;

  constructor(
    stakeERC20Info: RecipeERC20Info,
    slippageBasisPoints: bigint,
    provider: Provider,
  ) {
    super();
    this.stakeERC20Info = stakeERC20Info;
    this.slippageBasisPoints = slippageBasisPoints;
    this.provider = provider;
    this.nftTokenSubID = getRandomNFTID();
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return GMX.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName } = firstInternalStepInput;

    const { erc721: accessCardNFTAddress } =
      AccessCardNFT.getAddressesForNetwork(networkName);

    const { rewardRouterContractAddress } =
      GMX.getGMXInfoForNetwork(networkName);

    const ownableContractAddress =
      await AccessCardNFT.getOwnableContractAddress(
        networkName,
        accessCardNFTAddress,
        this.nftTokenSubID,
        this.provider,
      );

    return [
      new AccessCardNFTMintStep(accessCardNFTAddress, this.nftTokenSubID),
      new AccessCardCreateNFTOwnerStep(
        accessCardNFTAddress,
        this.nftTokenSubID,
        ownableContractAddress,
        this.provider,
      ),
      new TransferERC20Step(ownableContractAddress, this.stakeERC20Info),
      // TODO: Add owner address to recipe inputs / NFTs
      // TODO: Approve from ownable contract
      new ApproveERC20SpenderStep(
        rewardRouterContractAddress,
        this.stakeERC20Info,
      ),
      new GMXMintStakeGLPStep(
        this.stakeERC20Info,
        this.slippageBasisPoints,
        ownableContractAddress,
        this.provider,
      ),
    ];
  }
}
