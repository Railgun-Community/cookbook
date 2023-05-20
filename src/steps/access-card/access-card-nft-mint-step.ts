import { BigNumber } from 'ethers';
import {
  RecipeNFTInfo,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { AccessCardERC721Contract } from '../../contract/access-card/access-card-erc721-contract';
import { NETWORK_CONFIG, NFTTokenType } from '@railgun-community/shared-models';
import { nftAmountOne } from '../../utils/token';

export class AccessCardNFTMintStep extends Step {
  readonly config: StepConfig = {
    name: 'Access Card NFT Mint',
    description:
      'Mints an Access Card NFT, which can be assigned as owner to a Mech or Safe.',
  };

  private readonly accessCardNFTAddress: string;

  private readonly nftTokenSubID: BigNumber;

  constructor(accessCardNFTAddress: string, nftTokenSubID: BigNumber) {
    super();
    this.accessCardNFTAddress = accessCardNFTAddress;
    this.nftTokenSubID = nftTokenSubID;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { networkName } = input;

    const relayAdaptContractAddress =
      NETWORK_CONFIG[networkName].relayAdaptContract;

    const contract = new AccessCardERC721Contract(this.accessCardNFTAddress);
    const populatedTransaction = await contract.mint(
      relayAdaptContractAddress,
      this.nftTokenSubID,
    );

    const accessCardNFT: RecipeNFTInfo = {
      nftAddress: this.accessCardNFTAddress,
      nftTokenType: NFTTokenType.ERC721,
      tokenSubID: this.nftTokenSubID.toHexString(),
      amountString: nftAmountOne(),
      owns: undefined,
    };

    return {
      populatedTransactions: [populatedTransaction],
      outputERC20Amounts: input.erc20Amounts,
      outputNFTs: [accessCardNFT, ...input.nfts],
    };
  }
}
