import {
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { resolveExecutorAddress } from '../../utils/7702';

/**
 * Authorizes (or revokes) another address to manage the ephemeral EOA's Morpho
 * Blue positions via `setAuthorization`. Needed only for the retained-account /
 * Bundler3 model where the position owner and the acting account differ; the
 * same-account recipes never need it (the EOA is both owner and `msg.sender`).
 *
 * Moves no tokens — inputs pass through unchanged.
 */
export class MorphoBlueSetAuthorizationStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Set Authorization',
    description: 'Authorizes or revokes an operator on Morpho Blue positions.',
  };

  private readonly authorized: string;
  private readonly isAuthorized: boolean;

  constructor(authorized: string, isAuthorized: boolean) {
    super();
    this.authorized = resolveExecutorAddress(
      authorized,
      'MorphoBlueSetAuthorizationStep authorized',
    );
    this.isAuthorized = isAuthorized;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createSetAuthorization(
      this.authorized,
      this.isAuthorized,
    );

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [],
      outputERC20Amounts: input.erc20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
