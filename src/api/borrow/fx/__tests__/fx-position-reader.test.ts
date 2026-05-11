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
    // positionId 1903 is the v0 calibration mint (tx 0x3f7c7c42... from
    // README's calibration table). Verified on mainnet via
    // `cast call <pool> 'getPosition(uint256)' 1903`: rawColls ≈ 5.86e13,
    // rawDebts ≈ 3.58e16 — both > 0, so we can assert actual values
    // rather than just shape. If this position is ever closed/burned the
    // assertions degrade gracefully (call returns zeros, the > 0n
    // assertions fail informatively).
    const knownPositionId = 1903n;

    const position = await getFxPosition(knownPositionId, 'wstETH-Long', provider);
    expect(position.positionId).to.equal(knownPositionId);
    expect(position.collateralDecimals).to.equal(18n);
    expect(position.pool.address.toLowerCase()).to.equal(
      '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'.toLowerCase(),
    );
    // Real value assertions — position 1903 was minted with nonzero
    // collateral and debt and (as of Task 13) hasn't been closed.
    // chai 4.x's .greaterThan typings don't accept bigint; compare-then-assert.
    expect(position.rawColls > 0n).to.equal(true);
    expect(position.rawDebts > 0n).to.equal(true);
    expect(position.debt > 0n).to.equal(true);
    expect(position.debt).to.equal(position.rawDebts); // debt is an alias for rawDebts
    expect(position.debtRatio > 0n).to.equal(true);
    expect(position.collateralAmount > 0n).to.equal(true);
  });
});
