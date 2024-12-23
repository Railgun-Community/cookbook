import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import {
    RecipeERC20AmountRecipient,
    RecipeERC20Info,
    StepConfig,
    StepInput,
    StepOutputERC20Amount,
    UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { getBaseToken } from '../../utils/wrap-util';
import { ContractTransaction } from 'ethers';

export class LidoStakeShortcutStep extends Step {
    readonly config: StepConfig = {
        name: 'Lido Staking [wstETH]',
        description: 'Stake ETH to get wstETH',
    };

    constructor(private wstETHTokenInfo: RecipeERC20Info, private amount: bigint, private wrappedAmount: bigint) {
        super();
    }

    protected async getStepOutput(
        input: StepInput,
    ): Promise<UnvalidatedStepOutput> {
        const { networkName, erc20Amounts } = input;

        const baseToken = getBaseToken(networkName);
        const { unusedERC20Amounts } =
            this.getValidInputERC20Amount(
                erc20Amounts,
                erc20Amount => compareERC20Info(erc20Amount, baseToken),
                this.amount
            );

        const contract = new RelayAdaptContract(input.networkName);
        const crossContractCalls: ContractTransaction[] = [
            await contract.multicall(false, [{
                to: this.wstETHTokenInfo.tokenAddress,
                data: '0x',
                value: this.amount
            }]),
        ];

        const transferredBaseToken: RecipeERC20AmountRecipient = {
            ...baseToken,
            amount: this.amount,
            recipient: this.wstETHTokenInfo.tokenAddress,
        };

        const outputWSTETHToken: StepOutputERC20Amount = {
            ...this.wstETHTokenInfo,
            expectedBalance: this.wrappedAmount,
            minBalance: this.wrappedAmount,
            approvedSpender: undefined
        };


        return {
            crossContractCalls,
            spentERC20Amounts: [transferredBaseToken],
            outputERC20Amounts: [outputWSTETHToken, ...unusedERC20Amounts],
            outputNFTs: input.nfts,
        };
    }
}
