import { NetworkName } from '@railgun-community/shared-models';
import { RecipeConfig, RecipeERC20Info, StepInput } from 'models';
import { Recipe } from '../recipe';
import { Step, WrapBaseTokenStep } from '../../steps';
import { LidoUnstakeShortcutStep } from '../../steps/lido';
import { Provider } from 'ethers';

const MIN_GAS_LIMIT_LIDO_STAKING = 2_400_000n;

// TODO: remove shortcut from name
export class LidoUnstakeShortcutRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Lido Unstaking Shortcut Recipe',
    description: 'Unstake Eth to Get wstETH',
    minGasLimit: MIN_GAS_LIMIT_LIDO_STAKING,
  };

  private wstETHTokenInfo: RecipeERC20Info;
  private provider: Provider;
  // TODO: remove wstethinput, use local constant API for getting addresses.
  constructor(wstETHTokenInfo: RecipeERC20Info, provider: Provider) {
    super();
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

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const steps: Step[] = [
      new LidoUnstakeShortcutStep(this.wstETHTokenInfo, this.provider), // wstETH => ETH
      new WrapBaseTokenStep(), // ETH => WETH
    ];

    return steps;
  }
}
