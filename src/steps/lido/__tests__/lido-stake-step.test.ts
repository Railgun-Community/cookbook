import { NetworkName } from "@railgun-community/shared-models";
import { LidoStakeStep } from '../lido-stake-step'
import { RecipeERC20Info, StepInput, RecipeLidoStakeData } from "../../../models";
import { expect } from "chai";
import { NETWORK_CONFIG } from "@railgun-community/shared-models";

const STETH_TOKEN: RecipeERC20Info = {
    tokenAddress: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    decimals: 18n
};
const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

const amount = 10000n;

const stepInput: StepInput = {
    networkName,
    erc20Amounts: [
        {
            tokenAddress,
            decimals: 18n,
            isBaseToken: true,
            expectedBalance: 12000n,
            minBalance: 12000n,
            approvedSpender: undefined,
        },
    ],
    nfts: [],
};

describe("lido staking step", () => {
    it('Should stake ETH and get stETH', async () => {
        const liquidStakeData: RecipeLidoStakeData = {
            amount,
            stETHTokenInfo: STETH_TOKEN,
        }

        const step = new LidoStakeStep(liquidStakeData);
        const output = await step.getValidStepOutput(stepInput);

        expect(output.spentERC20Amounts).to.deep.equals([
            {
                amount,
                isBaseToken: true,
                recipient: 'Lido',
                tokenAddress,
                decimals: 18n,
            }
        ]);

        expect(output.outputERC20Amounts[0]).to.deep.equal(
            {
                approvedSpender: undefined,
                expectedBalance: amount,
                minBalance: amount,
                tokenAddress: STETH_TOKEN.tokenAddress,
                decimals: 18n

            }
        );
    })
});