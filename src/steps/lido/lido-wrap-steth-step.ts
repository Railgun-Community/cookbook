import { RecipeERC20AmountRecipient, LidoWrapQuote, StepConfig, StepInput, StepOutputERC20Amount, UnvalidatedStepOutput } from "../../models";
import { Step } from "../../steps/step";
import { compareERC20Info } from "../../utils";
import { LidoWSTETHContract } from "../../contract/lido";

export class LidoWrapSTETHStep extends Step {
    readonly config: StepConfig = {
        name: "Lido Wrap stETH",
        description: "Wrap stETH to wstETH",
        hasNonDeterministicOutput: false
    };

    readonly wrapQuote: LidoWrapQuote;

    constructor(wrapQuote: LidoWrapQuote) {
        super();
        this.wrapQuote = wrapQuote;
    }

    protected async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
        const { erc20Amounts } = input;

        const { inputTokenInfo: stETHTokenInfo, inputAmount: wrapAmount, outputTokenInfo: wstETHTokenInfo, outputAmount: wrappedAmount } = this.wrapQuote;

        const { erc20AmountForStep, unusedERC20Amounts } =
            this.getValidInputERC20Amount(
                erc20Amounts,
                erc20Amount => compareERC20Info(erc20Amount, stETHTokenInfo),
                wrapAmount,
            );

        const spentTokenAmount: RecipeERC20AmountRecipient = {
            ...stETHTokenInfo,
            amount: wrapAmount,
            recipient: wstETHTokenInfo.tokenAddress
        };

        const wrappedTokenAmount: StepOutputERC20Amount = {
            ...wstETHTokenInfo,
            expectedBalance: wrappedAmount,
            minBalance: wrappedAmount,
            approvedSpender: undefined
        };

        const wstethContract = new LidoWSTETHContract(wstETHTokenInfo.tokenAddress);
        const crossContractCall = await wstethContract.wrap(wrapAmount);

        return {
            crossContractCalls: [crossContractCall],
            spentERC20Amounts: [spentTokenAmount],
            outputERC20Amounts: [wrappedTokenAmount, ...unusedERC20Amounts],
            outputNFTs: input.nfts
        }
    }
}
