import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi-typechain/abi';
import { Contract } from '@ethersproject/contracts';
import { Vault } from '../../../abi-typechain/vault/gmx/Vault';
import { BigNumber } from 'ethers';

export class GmxVaultContract {
  private readonly contract: Vault;

  constructor(address: string, provider: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX Vault contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.vault,
      provider,
    ) as Vault;
  }

  getTokenPriceInUSD(
    tokenAddress: string,
    isMintingGLP: boolean,
  ): Promise<BigNumber> {
    // Use max token price when token is minted (ie when GLP is burned)
    const maximize = !isMintingGLP;
    return maximize
      ? this.contract.getMaxPrice(tokenAddress)
      : this.contract.getMinPrice(tokenAddress);
  }
}
