import { Contract, ContractRunner } from "ethers";

import { LidoSTETH } from "typechain";
import lidoSTETHAbi from "../../abi/lido/LidoSTETH.json"

export class LidoSTETHContract {

    private readonly contract: LidoSTETH;
    constructor(contractAddress: string, provider?: ContractRunner) {
        this.contract = new Contract(contractAddress, lidoSTETHAbi, provider) as unknown as LidoSTETH;
    }

    async submit(amount: bigint, referralAddress: string) {
        const tx = await this.contract.submit.populateTransaction(referralAddress);
        tx.value = amount;
        return tx;
    }

    async balanceOf(address: string): Promise<bigint> {
        const result = await this.contract.balanceOf(address);
        return result;
    }

    async sharesOf(address: string): Promise<bigint> {
        const result = await this.contract.sharesOf(address);
        return result;
    }
}