import { Addressable, Contract, ContractRunner, Provider, ZeroAddress } from "ethers";
import { LidoWSTETH } from "typechain";
import lidoWSTETHAbi from "../../abi/lido/LidoWSTETH.json"

export class LidoWSTETHContract {

    private readonly contract: LidoWSTETH;
    constructor(contractAddress: string, provider?: ContractRunner) {
        this.contract = new Contract(contractAddress, lidoWSTETHAbi, provider) as unknown as LidoWSTETH;
    }

    async wrap(amount: bigint) {
        return this.contract.wrap.populateTransaction(amount);
    }

    async getWstETHByStETH(amount: bigint): Promise<bigint> {
        return this.contract.getWstETHByStETH(amount);
    }

    async balanceOf(address: Addressable | string): Promise<bigint> {
        return this.contract.balanceOf(address);
    }
}