import { abi } from '../../abi/abi';
import {
  NETWORK_CONFIG,
  NetworkName,
  RailgunERC20AmountRecipient,
  RailgunNFTAmountRecipient,
  isDefined,
} from '@railgun-community/shared-models';
import { ZERO_ADDRESS } from '../../models/constants';
import { validateContractAddress } from '../../utils/address';
import { RelayAdapt } from '../../typechain';
import { TokenDataStruct } from '../../typechain/adapt/RelayAdapt';
import { Contract, ContractTransaction } from 'ethers';
import {
  generateShieldTransaction,
  getRandomBytes,
} from '@railgun-community/wallet';
import { getRandomShieldPrivateKey } from '../../utils/random';

export class RelayAdaptContract {
  private readonly contract: RelayAdapt;

  private readonly networkName: NetworkName;

  constructor(networkName: NetworkName) {
    const network = NETWORK_CONFIG[networkName];
    if (!isDefined(network)) {
      throw new Error(`Network not found: ${networkName}`);
    }
    if (!validateContractAddress(network.relayAdaptContract)) {
      throw new Error('Invalid address for Relay Adapt contract.');
    }
    this.networkName = networkName;
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
    const baseTokenTransfer: RelayAdapt.TokenTransferStruct = {
      token: this.createERC20TokenData(ZERO_ADDRESS),
      to: toAddress,
      // 0 will automatically transfer full balance.
      value: amount ?? 0n,
    };
    return this.contract.transfer.populateTransaction([baseTokenTransfer]);
  }

  createERC20Transfer(
    toAddress: string,
    tokenAddress: string,
    amount?: bigint,
  ) {
    const erc20Transfer: RelayAdapt.TokenTransferStruct = {
      token: this.createERC20TokenData(tokenAddress),
      to: toAddress,
      // 0 will automatically transfer full balance.
      value: amount ?? 0n,
    };
    return this.contract.transfer.populateTransaction([erc20Transfer]);
  }

  async createShield(toAddress: string, tokenAddresses: string[]) {
    const shieldPrivateKey = getRandomShieldPrivateKey();
    const erc20AmountRecipients: RailgunERC20AmountRecipient[] =
      tokenAddresses.map(tokenAddress => {
        return {
          tokenAddress,
          amount: 0n, // 0n to shield entire balance.
          recipientAddress: toAddress,
        };
      });
    const nftAmountRecipients: RailgunNFTAmountRecipient[] = [];

    return generateShieldTransaction(
      this.networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
    );
  }
}
