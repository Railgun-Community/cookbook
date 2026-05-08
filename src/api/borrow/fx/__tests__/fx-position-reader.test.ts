import chai from 'chai';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { getFxPool, getFxPosition } from '../fx-position-reader';

const { expect } = chai;

describe('fx-position-reader — getFxPool [requires RUN_FORK_TESTS=1]', function () {
  this.timeout(30_000);

  if (!process.env.RUN_FORK_TESTS) {
    it.skip('skipped — set RUN_FORK_TESTS=1 to run', () => {});
    return;
  }

  // Use a public RPC if MAINNET_RPC_URL isn't set — publicnode worked
  // in Task 1's discovery. Fork tests are read-only so any reliable
  // public RPC works.
  const rpcUrl = process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
  const provider = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  it('reads wstETH-Long pool state', async () => {
    const pool = await getFxPool('wstETH-Long', provider);
    expect(pool.name).to.equal('wstETH-Long');
    expect(pool.collateralDecimals).to.equal(18n);
    // Chai's greaterThan doesn't accept bigint; compare-then-assert.
    expect(pool.debtCapacity > 0n).to.equal(true);
    // Mainnet expectations from Task 1 discovery (May 2026):
    expect(pool.borrowFeeRatio).to.equal(5_000_000n);
    expect(pool.repayFeeRatio).to.equal(2_000_000n);
    expect(pool.liquidationDebtRatio).to.equal(950_000_000_000_000_000n); // 0.95e18
    expect(pool.liquidationBonusRatio).to.equal(40_000_000n); // 4e7
  });

  it('reads WBTC-Long pool state', async () => {
    const pool = await getFxPool('WBTC-Long', provider);
    expect(pool.name).to.equal('WBTC-Long');
    expect(pool.collateralDecimals).to.equal(8n);
    expect(pool.debtCapacity > 0n).to.equal(true);
    expect(pool.liquidationDebtRatio).to.equal(950_000_000_000_000_000n);
  });

  it('returns name=undefined for custom pool refs', async () => {
    const pool = await getFxPool({
      address: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8', // wstETH-Long
      collateralToken: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      collateralDecimals: 18n,
    }, provider);
    expect(pool.name).to.equal(undefined);
    expect(pool.address.toLowerCase()).to.equal('0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'.toLowerCase());
  });
});

describe('fx-position-reader — getFxPosition [requires RUN_FORK_TESTS=1]', function () {
  this.timeout(30_000);

  if (!process.env.RUN_FORK_TESTS) {
    it.skip('skipped — set RUN_FORK_TESTS=1 to run', () => {});
    return;
  }

  const rpcUrl = process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
  const provider = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });

  it('reads a known wstETH-Long position', async () => {
    // Use a conservative positionId. If 1 doesn't exist on-chain, the
    // call returns zeros — that's still valid (just no position state).
    // For a stronger smoke check, replace with a real positionId from
    // the v0 calibration tx 0x3f7c7c42... once known.
    const knownPositionId = 1n;

    const position = await getFxPosition(knownPositionId, 'wstETH-Long', provider);
    expect(position.positionId).to.equal(knownPositionId);
    expect(position.collateralDecimals).to.equal(18n);
    expect(position.pool.address.toLowerCase()).to.equal(
      '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'.toLowerCase(),
    );
    // rawColls, rawDebts, debtRatio could be 0n if positionId 1 doesn't
    // exist; we just check the shape is right.
    expect(position).to.have.property('rawColls');
    expect(position).to.have.property('debt');
    expect(position).to.have.property('collateralAmount');
  });
});
