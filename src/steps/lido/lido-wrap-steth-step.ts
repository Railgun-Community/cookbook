import { RecipeERC20AmountRecipient, StepConfig, StepInput, StepOutputERC20Amount, UnvalidatedStepOutput, RecipeERC20Info } from "../../models";
import { Step } from "../../steps/step";
import { compareERC20Info } from "../../utils";
import { LidoWSTETHContract } from "../../contract/lido";
import { Provider } from "ethers";

export class LidoWrapSTETHStep extends Step {
    readonly config: StepConfig = {
        name: "Lido Wrap stETH",
        description: "Wrap stETH to wstETH",
        hasNonDeterministicOutput: false
    };

    readonly wstETHTokenInfo: RecipeERC20Info;
    readonly stETHTokenInfo: RecipeERC20Info;
    private provider: Provider;

    constructor(wstETHTokenInfo: RecipeERC20Info, stETHTokenInfo: RecipeERC20Info, provider: Provider) {
        super();
        this.wstETHTokenInfo = wstETHTokenInfo;
        this.stETHTokenInfo = stETHTokenInfo;
        this.provider = provider;
    }

    private async getWrapAmount(stakeAmount: bigint): Promise<bigint> {
        const wstETHContract = new LidoWSTETHContract(this.wstETHTokenInfo.tokenAddress, this.provider);
        const wrappedAmount = await wstETHContract.getWstETHByStETH(stakeAmount);
        return wrappedAmount;
    }

    protected async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
        const { erc20Amounts } = input;
        const { erc20AmountForStep, unusedERC20Amounts } =
            this.getValidInputERC20Amount(
                erc20Amounts,
                erc20Amount => compareERC20Info(erc20Amount, this.stETHTokenInfo),
                undefined,
            );

        const wrapAmount = erc20AmountForStep.minBalance;

        const spentTokenAmount: RecipeERC20AmountRecipient = {
            ...this.stETHTokenInfo,
            amount: wrapAmount,
            recipient: this.wstETHTokenInfo.tokenAddress
        };

        const wrappedAmount = await this.getWrapAmount(wrapAmount);
        const wrappedTokenAmount: StepOutputERC20Amount = {
            ...this.wstETHTokenInfo,
            expectedBalance: wrappedAmount,
            minBalance: wrappedAmount,
            approvedSpender: undefined
        };

        const wstethContract = new LidoWSTETHContract(this.wstETHTokenInfo.tokenAddress);
        const crossContractCall = await wstethContract.wrap(wrapAmount);

        return {
            crossContractCalls: [crossContractCall],
            spentERC20Amounts: [spentTokenAmount],
            outputERC20Amounts: [wrappedTokenAmount, ...unusedERC20Amounts],
            outputNFTs: input.nfts
        }
    }
}
