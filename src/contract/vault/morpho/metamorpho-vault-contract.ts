import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../../abi/abi';
import { MetaMorpho } from '../../../typechain';
import { validateContractAddress } from '../../../utils/address';

/**
 * Thin wrapper over a MetaMorpho ERC-4626 vault.
 *
 * Unlike the Beefy vault (which mints/burns to `msg.sender` implicitly via
 * depositAll/withdrawAll), ERC-4626 takes an explicit `receiver`/`owner`. Under
 * EIP-7702 these must be the executing ephemeral EOA so the shares/assets land
 * on the account the batch runs as — never the shared relay-adapt contract.
 */
export class MetaMorphoVaultContract {
  private readonly contract: MetaMorpho;

  constructor(address: string, provider?: Provider) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid vault address for MetaMorpho contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.metaMorpho,
      provider,
    ) as unknown as MetaMorpho;
  }

  createDeposit(
    assets: bigint,
    receiver: string,
  ): Promise<ContractTransaction> {
    return this.contract.deposit.populateTransaction(assets, receiver);
  }

  createRedeem(
    shares: bigint,
    receiver: string,
    owner: string,
  ): Promise<ContractTransaction> {
    return this.contract.redeem.populateTransaction(shares, receiver, owner);
  }

  asset(): Promise<string> {
    return this.contract.asset();
  }

  decimals(): Promise<bigint> {
    return this.contract.decimals();
  }

  previewDeposit(assets: bigint): Promise<bigint> {
    return this.contract.previewDeposit(assets);
  }

  previewRedeem(shares: bigint): Promise<bigint> {
    return this.contract.previewRedeem(shares);
  }

  balanceOf(account: string): Promise<bigint> {
    return this.contract.balanceOf(account);
  }
}
