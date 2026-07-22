import { abi } from '../../abi/abi';
import { ZERO_ADDRESS } from '../../models/constants';
import { validateContractAddress } from '../../utils/address';
import { RelayAdapt } from '../../typechain';
import { TokenDataStruct } from '../../typechain/adapt/RelayAdapt';
import { Contract, ContractTransaction } from 'ethers';

export class RelayAdaptContract {
  private readonly contract: RelayAdapt;

  /**
   * @param relayAdaptAddress Address hosting the RelayAdapt logic. Under
   * EIP-7702 this is the executing ephemeral EOA (the account the batch runs
   * as), so its wrap/unwrap/transfer self-calls operate on that account's own
   * balance. The shared canonical relay-adapt contract is no longer used.
   */
  constructor(relayAdaptAddress: string) {
    if (!validateContractAddress(relayAdaptAddress)) {
      throw new Error('Invalid address for Relay Adapt contract.');
    }
    this.contract = new Contract(
      relayAdaptAddress,
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
}
