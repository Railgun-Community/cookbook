import { NetworkName } from '@railgun-community/shared-models';
import { RecipeConfig, RecipeERC20Info, StepInput } from 'models';
import { Recipe } from '../recipe';
import { Step, UnwrapBaseTokenStep } from '../../steps';
import { LidoStakeShortcutStep } from '../../steps/lido';
import { Provider } from 'ethers';

const MIN_GAS_LIMIT_LIDO_STAKING = 2_400_000n;

// TODO: remove shortcut from name
export class LidoStakeShortcutRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Lido Staking Shortcut Recipe',
    description: 'Stake Eth to Get wstETH',
    minGasLimit: MIN_GAS_LIMIT_LIDO_STAKING,
  };

  private wstETHTokenInfo: RecipeERC20Info;
  private provider: Provider;
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
      new UnwrapBaseTokenStep(), // WETH => ETH
      new LidoStakeShortcutStep(this.wstETHTokenInfo, this.provider), // ETH => wstETH
    ];

    return steps;
  }
}
