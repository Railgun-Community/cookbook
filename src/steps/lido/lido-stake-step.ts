import { ZeroAddress } from "ethers";
import { RecipeERC20AmountRecipient, RecipeERC20Info, StepConfig, StepInput, StepOutputERC20Amount, UnvalidatedStepOutput } from "models";
import { Step } from "../../steps/step";
import { compareERC20Info, getBaseToken } from "../../utils";
import { LidoSTETHContract } from "../../contract/lido";

export interface RecipeLidoStakeData {
    amount: bigint;
    stETHTokenInfo: RecipeERC20Info,
};

export class LidoStakeStep extends Step {
    readonly config: StepConfig = {
        name: "Lido Liquid Staking",
        description: "Stake ETH to get stETH",
        hasNonDeterministicOutput: false
    };

    readonly liquidStakeData: RecipeLidoStakeData;

    constructor(liquidStakeData: RecipeLidoStakeData) {
        super();
        this.liquidStakeData = liquidStakeData;
    }

    protected async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
        const { amount, stETHTokenInfo } = this.liquidStakeData;
        const { erc20Amounts, networkName } = input;

        const baseToken = getBaseToken(networkName);
        const { erc20AmountForStep, unusedERC20Amounts } =
            this.getValidInputERC20Amount(
                erc20Amounts,
                erc20Amount => compareERC20Info(erc20Amount, baseToken),
                amount,
            );

        const stakedBaseToken: RecipeERC20AmountRecipient = {
            ...baseToken,
            amount: amount ?? erc20AmountForStep.expectedBalance,
            recipient: 'Lido'
        };

        const stETHTokenAmount: StepOutputERC20Amount = {
            ...stETHTokenInfo,
            expectedBalance: amount ?? erc20AmountForStep.expectedBalance,
            minBalance: amount ?? erc20AmountForStep.expectedBalance,
            approvedSpender: undefined
        };

        const stEthContract = new LidoSTETHContract(stETHTokenAmount.tokenAddress);
        const crossContractCall = await stEthContract.stake(amount, ZeroAddress);

        return {
            crossContractCalls: [crossContractCall],
            spentERC20Amounts: [stakedBaseToken],
            outputERC20Amounts: [stETHTokenAmount, ...unusedERC20Amounts],
            outputNFTs: input.nfts
        }
    }
}
