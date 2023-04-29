import { Contract, PopulatedTransaction } from '@ethersproject/contracts';
import { abi } from '../../abi/abi';
import { RelayAdapt, TokenDataStruct } from '../../abi/adapt/RelayAdapt';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { BigNumber } from '@ethersproject/bignumber';
import { ZERO_ADDRESS } from '../../models/constants';

export class RelayAdaptContract {
  private readonly contract: RelayAdapt;

  constructor(networkName: NetworkName) {
    const network = NETWORK_CONFIG[networkName];
    if (!network) {
      throw new Error(`Network not found: ${networkName}`);
    }
    if (!network.relayAdaptContract) {
      throw new Error('Address is required for Relay Adapt contract.');
    }
    this.contract = new Contract(
      network.relayAdaptContract,
      abi.adapt.relay,
    ) as unknown as RelayAdapt;
  }

  private createERC20TokenData(tokenAddress: string): TokenDataStruct {
    return {
      tokenAddress,
      tokenType: 0, // ERC20
      tokenSubID: ZERO_ADDRESS,
    };
  }

  createBaseTokenUnwrap(amount: BigNumber): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.unwrapBase(amount);
  }

  createBaseTokenTransfer(toAddress: string): Promise<PopulatedTransaction> {
    const baseTokenData = this.createERC20TokenData(ZERO_ADDRESS);

    // Automatically transfers full balance.
    const value = BigNumber.from(0);

    const baseTokenTransfer: RelayAdapt.TokenTransferStruct = {
      token: baseTokenData,
      to: toAddress,
      value,
    };
    return this.contract.populateTransaction.transfer([baseTokenTransfer]);
  }
}
