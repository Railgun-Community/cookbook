import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi/abi';
import { Contract, Provider } from 'ethers';
import { Vault } from '../../../typechain';

export class GmxVaultContract {
  private readonly contract: Vault;

  constructor(address: string, provider: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX Vault contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.vault,
      provider,
    ) as unknown as Vault;
  }

  getTokenPriceInUSD(
    tokenAddress: string,
    isMintingGLP: boolean,
  ): Promise<bigint> {
    // Use max token price when token is minted (ie when GLP is burned)
    const maximize = !isMintingGLP;
    return maximize
      ? this.contract.getMaxPrice(tokenAddress)
      : this.contract.getMinPrice(tokenAddress);
  }
}
