import { Contract, PopulatedTransaction } from '@ethersproject/contracts';
import { abi } from '../../../abi-typechain/abi';
import { validateAddress } from '../../../utils/address';
import { BaseProvider } from '@ethersproject/providers';
import { BeefyVaultMergedV6V7 } from '../../../abi-typechain/vault/beefy/BeefyVaultMergedV6V7';

export class BeefyVaultContract {
  private readonly contract: BeefyVaultMergedV6V7;

  constructor(vaultAddress: string, provider?: BaseProvider) {
    if (!vaultAddress) {
      throw new Error('Vault address is required for Beefy Vault Contract');
    }
    if (!validateAddress(vaultAddress)) {
      throw new Error('Invalid Vault address for Beefy contract');
    }
    this.contract = new Contract(
      vaultAddress,
      abi.vault.beefy,
      provider,
    ) as BeefyVaultMergedV6V7;
  }

  createDepositAll(): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.depositAll();
  }

  createWithdrawAll(): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.withdrawAll();
  }
}
