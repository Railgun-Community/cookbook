import chai from 'chai';
import { Interface, type Provider, type TransactionRequest } from 'ethers';
import { getFxDebtScalingFactor } from '../fx-position-reader';
import {
  FX_SCALE_PRECISION,
  FX_SHORT_POOL_MANAGER_ABI,
  resolvePool,
} from '../../../../steps/borrow/fx/fx-mint-util';

const { expect } = chai;

const managerIface = new Interface(
  FX_SHORT_POOL_MANAGER_ABI as unknown as string[],
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * A manager that answers `tokenRates` with whatever the test hands it.
 *
 * `(0, 0x0)` is what a manager returns for a token it holds no rate for — a
 * mapping miss decodes as zeros, not a revert. That is the ordinary case on a
 * long pool, whose debt is fxUSD.
 */
const makeManagerStub = (
  scalar: bigint,
  rateProvider: string = ZERO_ADDRESS,
): Provider => {
  const call = async (tx: TransactionRequest): Promise<string> => {
    const data = tx.data as string;
    if (data.slice(0, 10) !== managerIface.getFunction('tokenRates')?.selector) {
      throw new Error(`stub: unexpected call ${data.slice(0, 10)}`);
    }
    return managerIface.encodeFunctionResult('tokenRates', [
      scalar,
      rateProvider,
    ]);
  };
  return { call } as unknown as Provider;
};

describe('getFxDebtScalingFactor — missing tokenRates entry', () => {
  // The defect: this threw on BOTH long pools, so an exported helper on a
  // descriptor-driven API was unusable on half the pools it ships. The long
  // manager holds no `tokenRates` entry for fxUSD because fxUSD is not
  // rate-bearing — there is nothing to scale. `getFxPosition` already handled
  // that correctly (it reports `rawDebts === debt` on a long); only the
  // standalone helper disagreed.
  it('returns the identity for a LONG pool with no entry', async () => {
    const factor = await getFxDebtScalingFactor(
      resolvePool('wstETH-Long'),
      makeManagerStub(0n),
    );
    expect(factor).to.equal(FX_SCALE_PRECISION);
  });

  it('returns the identity for WBTC-Long too — it is the side, not the pool', async () => {
    const factor = await getFxDebtScalingFactor(
      resolvePool('WBTC-Long'),
      makeManagerStub(0n),
    );
    expect(factor).to.equal(FX_SCALE_PRECISION);
  });

  // The throw is kept where it is genuinely uncomputable. A short's debt IS the
  // rate-bearing asset, so reading a missing entry as identity would understate
  // a WBTC-Short debt by 10^10 rather than fail — silently, in the direction
  // that under-repays.
  it('still throws for a SHORT pool with no entry', async () => {
    try {
      await getFxDebtScalingFactor(
        resolvePool('WBTC-Short'),
        makeManagerStub(0n),
      );
      throw new Error('expected getFxDebtScalingFactor to throw');
    } catch (err) {
      expect((err as Error).message).to.match(/no tokenRates entry/);
    }
  });

  it('composes a present entry unchanged, on either side', async () => {
    // 1e10 is WBTC-Short's measured scalar — the 8 -> 18 decimal shift — and
    // with no rate provider the composed factor is scalar x PRECISION = 1e28.
    const factor = await getFxDebtScalingFactor(
      resolvePool('WBTC-Short'),
      makeManagerStub(10n ** 10n),
    );
    expect(factor).to.equal(10n ** 28n);
  });
});
