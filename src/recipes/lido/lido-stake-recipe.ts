import { NetworkName } from "@railgun-community/shared-models";
import { RecipeConfig, RecipeERC20Info, StepInput } from "models";
import { Recipe } from '../recipe'
import { ApproveERC20SpenderStep, Step, UnwrapBaseTokenStep } from "../../steps";
import { LidoStakeStep, LidoWrapSTETHStep } from "../../steps/lido";
import { Provider } from "ethers";

const MIN_GAS_LIMIT_LIDO_STAKING = 2_400_000n;

export class LidoStakeRecipe extends Recipe {

    readonly config: RecipeConfig = {
        name: "Lido Staking Recipe",
        description: "Stake Eth to Get stETH and wrap it to wstETH",
        minGasLimit: MIN_GAS_LIMIT_LIDO_STAKING
    };

    private stETHTokenInfo: RecipeERC20Info;
    private wstETHTokenInfo: RecipeERC20Info;
    private provider: Provider;

    constructor(stETHTokenInfo: RecipeERC20Info, wstETHTokenInfo: RecipeERC20Info, provider: Provider) {
        super();
        this.stETHTokenInfo = stETHTokenInfo;
        this.wstETHTokenInfo = wstETHTokenInfo;
        this.provider = provider;
    }

    protected supportsNetwork(networkName: NetworkName): boolean {
        switch (networkName) {
            case NetworkName.Ethereum:
            case NetworkName.EthereumSepolia:
                return true;
            default:
                return false;
        }
    }

    protected async getInternalSteps(firstInternalStepInput: StepInput): Promise<Step[]> {
        const steps: Step[] = [
            new UnwrapBaseTokenStep(), // WETH => ETH
            new LidoStakeStep(this.stETHTokenInfo), // ETH => stETH
            new ApproveERC20SpenderStep(this.wstETHTokenInfo.tokenAddress, this.stETHTokenInfo), // approve wstETH to wrap stETH
            new LidoWrapSTETHStep(this.wstETHTokenInfo, this.stETHTokenInfo, this.provider) // wrap stETH to wstETH
        ]

        return steps;
    }

}