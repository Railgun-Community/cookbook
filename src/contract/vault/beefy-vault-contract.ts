import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { validateAddress } from '../../utils/address';
import { BaseProvider } from '@ethersproject/providers';

export class BeefyVaultContract {
  // private readonly contract: BeefyVault;
  // constructor(vaultAddress: string, provider?: BaseProvider) {
  //   if (!vaultAddress) {
  //     throw new Error('Vault address is required for Beefy Vault Contract');
  //   }
  //   if (!validateAddress(vaultAddress)) {
  //     throw new Error('Invalid Vault address for Beefy contract');
  //   }
  //   this.contract = new Contract(
  //     vaultAddress,
  //     abi.token.erc20,
  //     provider,
  //   ) as unknown as BeefyVault;
  // }
}
