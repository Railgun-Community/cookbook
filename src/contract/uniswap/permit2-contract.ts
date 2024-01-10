import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { Permit2 } from '../../typechain';
import { validateContractAddress } from '../../utils/address';
import { NetworkName } from '@railgun-community/shared-models';

export const getUniswapPermit2ContractAddressForNetwork = (networkName: NetworkName) => {
  switch (networkName) {
    case NetworkName.Ethereum:
    case NetworkName.BNBChain:
    case NetworkName.Polygon:
    case NetworkName.Arbitrum:
      {
        return '0x000000000022d473030f116ddee9f6b43ac78ba3';
      }
    default: {
      throw new Error("Unsupported network for Uniswap Permit2 contract.");
    }
  }
}

export class UniswapPermit2Contract {
  private readonly contract: Permit2;

  constructor(address: string, provider?: Provider) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid Vault address for Beefy contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.beefy,
      provider,
    ) as unknown as Permit2;
  }

  createApproval(
    approvalTo: string,
    approvalToken: string,
    approvalTimeout: bigint,
    approvalAmount: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.approve.populateTransaction(
      approvalToken,
      approvalTo,
      approvalAmount,
      approvalTimeout,
    );
  }

}
