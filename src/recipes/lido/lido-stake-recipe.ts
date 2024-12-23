import { NetworkName } from "@railgun-community/shared-models";
import { RecipeConfig, RecipeERC20Info, StepInput, LidoWrapQuote, RecipeLidoStakeData } from "models";
import { Recipe } from '../recipe'
import { ApproveERC20SpenderStep, Step, UnwrapBaseTokenStep } from "../../steps";
import { LidoStakeStep, LidoWrapSTETHStep } from "../../steps/lido";
import { LidoWSTETHContract } from "../../contract/lido";
import { getTestProvider } from "../../test/shared.test";

const MIN_GAS_LIMIT_LIDO_STAKING: bigint = 2_400_000n;

export class LidoStakeRecipe extends Recipe {

    readonly config: RecipeConfig = {
        name: "Lido Staking Recipe",
        description: "Stake Eth to Get stETH and wrap it to wstETH",
        minGasLimit: MIN_GAS_LIMIT_LIDO_STAKING
    };

    private stETHTokenInfo: RecipeERC20Info;
    private wstETHTokenInfo: RecipeERC20Info;
    private stakeAmount: bigint;

    constructor(stETHTokenInfo: RecipeERC20Info, wstETHTokenInfo: RecipeERC20Info, stakeAmount: bigint) {
        super();
        this.stETHTokenInfo = stETHTokenInfo;
        this.wstETHTokenInfo = wstETHTokenInfo;
        this.stakeAmount = stakeAmount;
    }

    protected supportsNetwork(networkName: NetworkName): boolean {
        switch (networkName) {
            case NetworkName.Ethereum:
            case NetworkName.EthereumSepolia:
                return true;
        }
        return false;
    }

    private async getWrapQuote(): Promise<LidoWrapQuote> {
        const wrapAmount = this.stakeAmount;
        const provider = getTestProvider(); 
        const wstETHContract = new LidoWSTETHContract(this.wstETHTokenInfo.tokenAddress, provider);
        const wrappedAmount = await wstETHContract.getWstETHByStETH(this.stakeAmount);

        return {
            inputTokenInfo: this.stETHTokenInfo,
            inputAmount: wrapAmount,
            outputTokenInfo: this.wstETHTokenInfo,
            outputAmount: wrappedAmount
        };
    }

    protected async getInternalSteps(firstInternalStepInput: StepInput): Promise<Step[]> {
        const liquidStakeData: RecipeLidoStakeData = {
            amount: this.stakeAmount,
            stETHTokenInfo: this.stETHTokenInfo,
        };

        const wrapQuote = await this.getWrapQuote();

        const steps: Step[] = [
            new UnwrapBaseTokenStep(this.stakeAmount), // WETH => ETH
            new LidoStakeStep(liquidStakeData), // ETH => stETH
            new ApproveERC20SpenderStep(this.wstETHTokenInfo.tokenAddress, this.stETHTokenInfo, this.stakeAmount), // approve wstETH to wrap stETH
            new LidoWrapSTETHStep(wrapQuote) // wrap stETH to wstETH
        ]

        return steps;
    }

}