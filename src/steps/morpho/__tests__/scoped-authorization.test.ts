import chai from 'chai';
import { NetworkName } from '@railgun-community/shared-models';
import { withScopedMorphoBlueAuthorization } from '../scoped-authorization';
import { MorphoBlueSetAuthorizationStep } from '../blue-set-authorization-step';
import { Step } from '../../step';
import type {
  StepInput,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { getStepFailureMode } from '../../failure-modes';

const { expect } = chai;

const OPERATOR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const stepInput = (): StepInput => ({
  networkName: NetworkName.Ethereum,
  erc20Amounts: [],
  nfts: [],
});

/** Stands in for whatever the grant was needed for. */
class InnerStep extends Step {
  readonly config = { name: 'Inner', description: 'inner' };
  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    return {
      crossContractCalls: [
        { to: OTHER, data: '0xdeadbeef', value: 0n },
      ],
      outputERC20Amounts: input.erc20Amounts,
      outputNFTs: input.nfts,
    };
  }
}

const callsOf = async (steps: Step[]): Promise<string[]> => {
  const calls: string[] = [];
  for (const step of steps) {
    const output = await step.getValidStepOutput(stepInput());
    output.crossContractCalls.forEach(call => calls.push(call.data as string));
  }
  return calls;
};

describe('withScopedMorphoBlueAuthorization', () => {
  it('Should bracket the wrapped steps with a grant and a revoke', async () => {
    const steps = withScopedMorphoBlueAuthorization(OPERATOR, [
      new InnerStep(),
    ]);

    expect(steps).to.have.length(3);
    expect(steps[0]).to.be.instanceOf(MorphoBlueSetAuthorizationStep);
    expect(steps[1]).to.be.instanceOf(InnerStep);
    expect(steps[2]).to.be.instanceOf(MorphoBlueSetAuthorizationStep);
  });

  it('Should encode the revoke as its own call, after the wrapped work', async () => {
    const calls = await callsOf(
      withScopedMorphoBlueAuthorization(OPERATOR, [new InnerStep()]),
    );

    // setAuthorization(address,bool) — the trailing call must carry `false`.
    expect(calls).to.have.length(3);
    expect(calls[0].endsWith('1')).to.equal(true, 'first call grants');
    expect(calls[1]).to.equal('0xdeadbeef');
    expect(calls[2].endsWith('0')).to.equal(true, 'last call revokes');
  });

  it('Should aim the revoke at the same operator as the grant', async () => {
    const calls = await callsOf(
      withScopedMorphoBlueAuthorization(OPERATOR, [new InnerStep()]),
    );

    // A revoke naming a different address leaves the grant standing while
    // looking like it cleaned up, which is why the helper resolves once.
    const operatorWord = OPERATOR.slice(2).toLowerCase();
    expect(calls[0].toLowerCase()).to.contain(operatorWord);
    expect(calls[2].toLowerCase()).to.contain(operatorWord);
    expect(calls[0].slice(0, -1)).to.equal(calls[2].slice(0, -1));
  });

  it('Should still emit the revoke when the wrapped step fails', async () => {
    // The whole point. Both 7702 paths run with `requireSuccess = false`, so a
    // failing inner call does not break the multicall — the batch continues and
    // the trailing revoke executes. The step list is built up front and is not
    // conditional on any runtime outcome, so a failing InnerStep cannot remove
    // the revoke from the batch. Modelled here by asserting the revoke's
    // position is a property of construction, not of execution.
    class FailingInner extends InnerStep {
      protected async getStepOutput(
        input: StepInput,
      ): Promise<UnvalidatedStepOutput> {
        return {
          // Encodes a call to a contract that will revert on chain. It still
          // occupies a multicall slot, and the revoke still follows it.
          crossContractCalls: [{ to: OTHER, data: '0xbad0', value: 0n }],
          outputERC20Amounts: input.erc20Amounts,
          outputNFTs: input.nfts,
        };
      }
    }

    const calls = await callsOf(
      withScopedMorphoBlueAuthorization(OPERATOR, [new FailingInner()]),
    );

    expect(calls).to.have.length(3);
    expect(calls[2].endsWith('0')).to.equal(true);
  });

  it('Should leave the wrapped steps in order and unmodified', async () => {
    const a = new InnerStep();
    const b = new InnerStep();
    const steps = withScopedMorphoBlueAuthorization(OPERATOR, [a, b]);

    expect(steps[1]).to.equal(a);
    expect(steps[2]).to.equal(b);
    expect(steps).to.have.length(4);
  });

  it('Should reject an operator address the executor helpers refuse', () => {
    expect(() =>
      withScopedMorphoBlueAuthorization('not-an-address', [new InnerStep()]),
    ).to.throw();
  });

  it('Should keep the bare step documented as revoke-required', () => {
    // The helper exists because of this classification; if the failure-mode
    // table ever downgrades it, the helper's reason for existing is gone and
    // this should be revisited rather than silently diverging.
    const mode = getStepFailureMode('MorphoBlueSetAuthorizationStep');
    expect(mode?.onLaterFailure.recovery).to.equal('revoke-required');
    expect(mode?.onLaterFailure.residue).to.equal('protocol');
  });
});
