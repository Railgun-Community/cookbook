import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { JsonRpcProvider } from 'ethers';
import {
  assertFxOpenViable,
  preflightFxOpen,
} from '../fx-open-preflight';
import { getFxPool, getNextFxPositionId } from '../fx-position-reader';

chai.use(chaiAsPromised);
const { expect } = chai;

// publicnode serves both the reads here and the failure-mode assertions.
const RPC = 'https://ethereum-rpc.publicnode.com';

describe('preflightFxOpen', function run() {
  this.timeout(90_000);

  let provider: JsonRpcProvider;

  before(() => {
    provider = new JsonRpcProvider(RPC);
  });

  after(() => {
    provider.destroy();
  });

  it('Should clear a viable open on wstETH-Long', async () => {
    const pool = await getFxPool('wstETH-Long', provider);
    const headroom = pool.debtCapacity - pool.debtBalance;

    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n, // trivially inside any real headroom
      provider,
    });

    // Capacity is live state. Asserting `ok` unconditionally would make this
    // test a liveness check on the pool rather than on the preflight, so branch
    // on the state and assert the correct answer for each — a full pool SHOULD
    // block, and reporting that faithfully is the behaviour under test.
    if (headroom >= 1n) {
      expect(result.blockers).to.deep.equal([]);
      expect(result.ok).to.equal(true);
    } else {
      expect(result.blockers.map(b => b.code)).to.contain('debt-capacity');
    }
    expect(result.predictedPositionId > 0n).to.equal(true);
    expect(result.checkedAtBlock > 0).to.equal(true);
  });

  it('Should block an open that exceeds the pool debt capacity', async () => {
    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 2n ** 200n, // beyond any real capacity
      provider,
    });

    expect(result.ok).to.equal(false);
    expect(result.blockers.map(b => b.code)).to.contain('debt-capacity');
  });

  it('Should detect a stale position id rather than let the shield revert', async () => {
    const live = await getNextFxPositionId('wstETH-Long', provider);

    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n,
      provider,
      predictedPositionId: live - 1n, // as if another opener had taken it
    });

    expect(result.ok).to.equal(false);
    expect(result.blockers.map(b => b.code)).to.contain('position-id-stale');
    // The caller gets the CURRENT id back, so rebuilding does not need a
    // second round trip.
    expect(result.predictedPositionId).to.equal(live);
  });

  it('Should accept the id it just handed out', async () => {
    const first = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n,
      provider,
    });
    const second = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n,
      provider,
      predictedPositionId: first.predictedPositionId,
    });

    // Can only fail if a real open landed between the two calls, which is the
    // race this check exists to catch — so assert on the blocker set, not on
    // `ok`, and allow that specific outcome.
    const codes = second.blockers.map(b => b.code);
    expect(codes.filter(c => c !== 'position-id-stale')).to.deep.equal([]);
  });

  it('Should never report ok when a read failed', async () => {
    const dead = new JsonRpcProvider('http://127.0.0.1:1');
    try {
      const result = await preflightFxOpen({
        pool: 'wstETH-Long',
        targetDebt: 1n,
        provider: dead,
      });
      // An unreadable check is not a passing check — the failure mode this
      // guards against is a transport error presenting as "nothing wrong".
      expect(result.ok).to.equal(false);
      expect(result.blockers.map(b => b.code)).to.contain('unreadable');
      // And it must not throw on the way — `getBlockNumber` used to run
      // unguarded ahead of the settled reads, so an unreachable provider
      // escaped as an exception instead of a reported blocker.
      expect(result.checkedAtBlock).to.equal(-1);
    } finally {
      dead.destroy();
    }
  });

  it('Should name what it did not check, even on a clean pass', async () => {
    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n,
      provider,
    });

    // The caller has to be able to tell "checked and fine" from "not checked".
    // The debt-ratio gap is the load-bearing one: an open that lands above the
    // rebalance threshold still passes this preflight.
    expect(result.unchecked).to.contain('resulting-debt-ratio');
    expect(result.unchecked).to.contain('operate-simulation');
    expect(result.unchecked).to.contain('same-block-guarantee');
  });

  it('Should check the debt ratio when given a collateral amount', async () => {
    // 1 wstETH backing 100 fxUSD is far under the 86.67% ceiling.
    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 100_000_000_000_000_000_000n,
      collateralAmount: 1_000_000_000_000_000_000n,
      provider,
    });

    expect(result.blockers.map(b => b.code)).to.not.contain('debt-ratio');
    // And the check is now REPORTED as done, not silently absent.
    expect(result.unchecked).to.not.contain('resulting-debt-ratio');
  });

  it('Should block an open that would exceed the pool debt ratio', async () => {
    // Sizing this correctly requires knowing which unit the oracle prices in,
    // and getting it wrong makes the test vacuous. The anchor price is per RAW
    // collateral unit, and wstETH raw is stETH-denominated — so 1 wstETH is
    // ~1.24 raw units, worth ~$2,330 rather than the ~$1,880 the raw price
    // alone suggests. An earlier version of this test borrowed 1,700 against
    // 1 wstETH expecting a rejection; that is ~73%, comfortably legal, and the
    // test passed a build it was meant to reject.
    //
    // 2,400 fxUSD against 1 wstETH is ~103%, unambiguously over the 86.67%
    // ceiling f(x) enforces. This is the check that catches an open refused on
    // RISK grounds rather than capacity or permissions.
    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 2_400_000_000_000_000_000_000n,
      collateralAmount: 1_000_000_000_000_000_000n,
      provider,
    });

    expect(result.ok).to.equal(false);
    expect(result.blockers.map(b => b.code)).to.contain('debt-ratio');
    const blocker = result.blockers.find(b => b.code === 'debt-ratio');
    // The message must carry the actual figures, since the caller's next move
    // is to pick a smaller debt or more collateral.
    expect(blocker?.detail).to.match(/debt ratio of \d+/);
    expect(blocker?.detail).to.match(/maximum of \d+/);
  });

  it('Should report the ratio as unchecked when no collateral is given', async () => {
    const result = await preflightFxOpen({
      pool: 'wstETH-Long',
      targetDebt: 1n,
      provider,
    });

    // Absence of a blocker must not read as a pass. Without a collateral amount
    // there is nothing to compute a ratio from, and the caller has to be able
    // to tell that apart from "checked and fine".
    expect(result.unchecked).to.contain('resulting-debt-ratio');
  });

  it('Should not claim a ratio check it could not perform', async () => {
    const dead = new JsonRpcProvider('http://127.0.0.1:1');
    try {
      const result = await preflightFxOpen({
        pool: 'wstETH-Long',
        targetDebt: 1n,
        collateralAmount: 1_000_000_000_000_000_000n,
        provider: dead,
      });
      // A ratio that could not be computed is not a ratio that is fine.
      expect(result.ok).to.equal(false);
      expect(result.unchecked).to.contain('resulting-debt-ratio');
    } finally {
      dead.destroy();
    }
  });

  it('Should raise from the asserting form, naming the blocker', async () => {
    await expect(
      assertFxOpenViable({
        pool: 'wstETH-Long',
        targetDebt: 2n ** 200n,
        provider,
      }),
    ).to.eventually.be.rejectedWith(/debt-capacity/);
  });
});
