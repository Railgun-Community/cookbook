import { NetworkName } from "@railgun-community/shared-models";
import { RecipeConfig, RecipeERC20Info, StepInput } from "models";
import { Recipe } from '../recipe'
import { Step, UnwrapBaseTokenStep } from "../../steps";
import { LidoStakeShortcutStep } from "../../steps/lido";
import { LidoWSTETHContract } from "../../contract/lido";
import { getTestProvider } from "../../test/shared.test";

const MIN_GAS_LIMIT_LIDO_STAKING: bigint = 2_400_000n; // @TODO

export class LidoStakeShortcutRecipe extends Recipe {

    readonly config: RecipeConfig = {
        name: "Lido Staking Shortcut Recipe",
        description: "Stake Eth to Get wstETH",
        minGasLimit: MIN_GAS_LIMIT_LIDO_STAKING
    };

    private wstETHTokenInfo: RecipeERC20Info;
    private stakeAmount: bigint;

    constructor(wstETHTokenInfo: RecipeERC20Info, stakeAmount: bigint) {
        super();
        this.wstETHTokenInfo = wstETHTokenInfo;
        this.stakeAmount = stakeAmount;
    }

    private async getWrappedAmount(): Promise<bigint> {
        const provider = getTestProvider();
        const wstETHContract = new LidoWSTETHContract(this.wstETHTokenInfo.tokenAddress, provider);
        const wrappedAmount = await wstETHContract.getWstETHByStETH(this.stakeAmount);
        return wrappedAmount;
    }

    protected supportsNetwork(networkName: NetworkName): boolean {
        switch (networkName) {
            case NetworkName.Ethereum:
            case NetworkName.EthereumSepolia:
                return true;
        }
        return false;
    }

    protected async getInternalSteps(firstInternalStepInput: StepInput): Promise<Step[]> {
        const wrappedAmount = await this.getWrappedAmount();
        const steps: Step[] = [
            new UnwrapBaseTokenStep(this.stakeAmount), // WETH => ETH
            new LidoStakeShortcutStep(this.wstETHTokenInfo, this.stakeAmount, wrappedAmount)// ETH => wstETH
        ]

        return steps;
    }

}