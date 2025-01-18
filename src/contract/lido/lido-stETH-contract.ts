import { Contract, ContractRunner } from 'ethers';

import { LidoSTETH } from 'typechain';
import lidoSTETHAbi from '../../abi/lido/LidoSTETH.json';

// NOTE: This contract is not used. Gas consumption is high with this usecase. POC
// USE WSTETH SHORTCUT INSTEAD
export class LidoSTETHContract {
  private readonly contract: LidoSTETH;
  constructor(contractAddress: string, provider?: ContractRunner) {
    this.contract = new Contract(
      contractAddress,
      lidoSTETHAbi,
      provider,
    ) as unknown as LidoSTETH;
  }

  async submit(amount: bigint, referralAddress: string) {
    const tx = await this.contract.submit.populateTransaction(referralAddress);
    tx.value = amount;
    return tx;
  }

  balanceOf(address: string): Promise<bigint> {
    return this.contract.balanceOf(address);
  }

  sharesOf(address: string): Promise<bigint> {
    return this.contract.sharesOf(address);
  }
}
