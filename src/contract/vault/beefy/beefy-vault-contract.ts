import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../../abi/abi';
import { BeefyVaultMergedV6V7 } from '../../../typechain';
import { validateAddress } from '../../../utils/address';

export class BeefyVaultContract {
  private readonly contract: BeefyVaultMergedV6V7;

  constructor(address: string, provider?: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid Vault address for Beefy contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.beefy,
      provider,
    ) as unknown as BeefyVaultMergedV6V7;
  }

  createDepositAll(): Promise<ContractTransaction> {
    return this.contract.depositAll.populateTransaction();
  }

  createWithdrawAll(): Promise<ContractTransaction> {
    return this.contract.withdrawAll.populateTransaction();
  }
}
