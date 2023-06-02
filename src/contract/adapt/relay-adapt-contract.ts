import { abi } from '../../abi/abi';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';

import { ZERO_ADDRESS } from '../../models/constants';
import { validateAddress } from '../../utils/address';
import { RelayAdapt } from '../../typechain';
import { TokenDataStruct } from '../../typechain/adapt/RelayAdapt';
import { Contract, ContractTransaction } from 'ethers';

export class RelayAdaptContract {
  private readonly contract: RelayAdapt;

  constructor(networkName: NetworkName) {
    const network = NETWORK_CONFIG[networkName];
    if (!network) {
      throw new Error(`Network not found: ${networkName}`);
    }
    if (!validateAddress(network.relayAdaptContract)) {
      throw new Error('Invalid address for Relay Adapt contract.');
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

  createBaseTokenWrap(amount?: bigint): Promise<ContractTransaction> {
    return this.contract.wrapBase.populateTransaction(
      // 0 will automatically wrap full balance.
      amount ?? 0n,
    );
  }

  createBaseTokenUnwrap(amount?: bigint): Promise<ContractTransaction> {
    return this.contract.unwrapBase.populateTransaction(
      // 0 will automatically unwrap full balance.
      amount ?? 0n,
    );
  }

  createBaseTokenTransfer(
    toAddress: string,
    amount?: bigint,
  ): Promise<ContractTransaction> {
    const baseTokenData = this.createERC20TokenData(ZERO_ADDRESS);

    const baseTokenTransfer: RelayAdapt.TokenTransferStruct = {
      token: baseTokenData,
      to: toAddress,
      // 0 will automatically transfer full balance.
      value: amount ?? 0n,
    };
    return this.contract.transfer.populateTransaction([baseTokenTransfer]);
  }
}
