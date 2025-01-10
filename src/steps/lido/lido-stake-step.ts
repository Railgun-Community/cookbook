import { ZeroAddress } from "ethers";
import { RecipeERC20AmountRecipient, RecipeERC20Info, StepConfig, StepInput, StepOutputERC20Amount, UnvalidatedStepOutput } from "models";
import { Step } from "../../steps/step";
import { compareERC20Info, getBaseToken } from "../../utils";
import { LidoSTETHContract } from "../../contract/lido";

export class LidoStakeStep extends Step {
    readonly config: StepConfig = {
        name: "Lido Staking [stETH]",
        description: "Stake ETH to get stETH",
        hasNonDeterministicOutput: false
    };

    readonly stETHTokenInfo: RecipeERC20Info;

    constructor(stETHTokenInfo: RecipeERC20Info) {
        super();
        this.stETHTokenInfo = stETHTokenInfo;
    }

    protected async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
        const { erc20Amounts, networkName } = input;
        const baseToken = getBaseToken(networkName);
        const { erc20AmountForStep, unusedERC20Amounts } =
            this.getValidInputERC20Amount(
                erc20Amounts,
                erc20Amount => compareERC20Info(erc20Amount, baseToken),
                undefined,
            );

        const amount = erc20AmountForStep.minBalance;
        const stakedBaseToken: RecipeERC20AmountRecipient = {
            ...baseToken,
            amount,
            recipient: 'Lido'
        };

        const stETHTokenAmount: StepOutputERC20Amount = {
            ...this.stETHTokenInfo,
            expectedBalance: amount,
            minBalance: amount,
            approvedSpender: undefined
        };

        const stEthContract = new LidoSTETHContract(stETHTokenAmount.tokenAddress);
        const crossContractCall = await stEthContract.submit(amount, ZeroAddress);

        return {
            crossContractCalls: [crossContractCall],
            spentERC20Amounts: [stakedBaseToken],
            outputERC20Amounts: [stETHTokenAmount, ...unusedERC20Amounts],
            outputNFTs: input.nfts
        }
    }
}
