import chai from 'chai';
import {
  Contract,
  JsonRpcProvider,
  concat,
  keccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers';
import { NetworkName, NFTTokenType } from '@railgun-community/shared-models';
import { FxMintCloseRecipe } from '../../../../recipes/borrow/fx/fx-mint-close-recipe';
import {
  getFxPool,
  getFxPosition,
  getFxRepayCeiling,
} from '../../../../api/borrow/fx/fx-position-reader';
import { computeFxClose, resolvePool } from '../fx-mint-util';
import { setRailgunFees } from '../../../../init';
import type { FxMintPoolName } from '../fx-mint-util';

const { expect } = chai;

/**
 * Replay a FULL close against Ethereum mainnet at head, as the real owner of a
 * real position, via `eth_call` with state overrides.
 *
 * Nothing is signed and nothing is spent — `eth_call` does not check
 * signatures, so this runs against genuine positions, genuine collateral and
 * genuine indices rather than a fixture's idea of them. That matters here
 * specifically: the defect this locks down is a share-rounding boundary, and a
 * fixture with an identity index cannot express it.
 *
 * **What it caught.** A full close encoded with explicit amounts reverts
 * `ErrorWithdrawExceedSupply()` on both long pools — `_operate` converts the
 * amount back to shares rounding UP and overshoots the position by one share —
 * and `Panic(0x11)` on `WBTC-Short`, where the same round-up underflows the
 * unguarded `positionDebt -= shares`. Only f(x)'s `type(int256).min` sentinel,
 * on BOTH legs, retires a position exactly.
 *
 * Note that `WBTC-Short` passed the explicit encoding when this was first
 * measured on 2026-08-12 and fails it now against the SAME position. Whether an
 * explicit amount lands is a property of the index at mine time. Do not narrow
 * the sentinel to one side on the strength of a green run.
 *
 * Opt-in via `RUN_MAINNET_SIM=1`, plus an RPC that honours `eth_call` state
 * overrides. `rpc.mevblocker.io` and `eth.drpc.org` both do; many public nodes
 * do not, and a node that silently ignores overrides would make every check
 * here pass for the wrong reason — which is what the per-pool CONTROL exists to
 * catch.
 *
 * Its own gate rather than `RUN_FORK_TESTS`, deliberately: that one starts the
 * anvil harness this suite has no use for. What this needs is mainnet at head —
 * a pinned fork would freeze the very indices whose movement is the defect.
 */
describe('FxMintCloseRecipe — full close on mainnet [requires RUN_MAINNET_SIM=1]', function () {
  this.timeout(600_000);

  if ((process.env.RUN_MAINNET_SIM ?? '') === '') {
    it.skip('skipped — set RUN_MAINNET_SIM=1 to run', () => {});
    return;
  }

  const rpcUrl =
    process.env.FX_SIM_RPC ??
    process.env.MAINNET_RPC_URL ??
    'https://rpc.mevblocker.io';
  const provider = new JsonRpcProvider(rpcUrl);

  const ZK_ADDRESS =
    '0zk1qyzgh9ctuxm6d06gmax39xutjgrawdsljtv80lqnjtqp3exxayuf0rv7j6fe3z53laetcl9u3cma0q9k4npgy8c8ga4h6mx83v09m8ewctsekw4a079dcl5sw4k';

  const POOL_ABI = [
    'function getPosition(uint256) view returns (uint256,uint256)',
    'function getNextPositionId() view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
  ];

  const HUGE = zeroPadValue(toBeHex(2n ** 128n), 32);
  const ZERO = zeroPadValue('0x00', 32);

  /**
   * Locate a token's mapping slots by overriding a candidate and reading the
   * value back, rather than assuming a storage layout. A wrong guess would
   * simulate against the owner's REAL balance and pass for the wrong reason.
   *
   * The range rather than a namespace guess is deliberate: fxUSD is an
   * ERC-1967 proxy whose balances sit at integer slot 151, behind the storage
   * gaps its inheritance chain reserves.
   */
  const SCAN_DEPTH = 260;
  const mapSlot = (key: string, base: string): string =>
    keccak256(concat([zeroPadValue(key, 32), base]));
  const nested = (outer: string, inner: string, base: string): string =>
    keccak256(concat([zeroPadValue(inner, 32), mapSlot(outer, base)]));

  const probe = async (
    token: string,
    callData: string,
    slotFor: (base: string) => string,
  ): Promise<string | undefined> => {
    for (let i = 0; i < SCAN_DEPTH; i += 1) {
      const base = zeroPadValue(toBeHex(i), 32);
      try {
        const raw = (await provider.send('eth_call', [
          { to: token, data: callData },
          'latest',
          { [token]: { stateDiff: { [slotFor(base)]: HUGE } } },
        ])) as string;
        if (BigInt(raw) === 2n ** 128n) return base;
      } catch {
        // Not this slot — an override landing somewhere structural can make
        // the read revert. Keep scanning.
      }
    }
    return undefined;
  };

  const POOLS: FxMintPoolName[] = [
    'wstETH-Long',
    'WBTC-Long',
    'stETH-Short',
    'WBTC-Short',
  ];

  before(() => {
    setRailgunFees(NetworkName.Ethereum, 25n, 25n);
  });

  POOLS.forEach(name => {
    it(`closes a live position in full on ${name}`, async () => {
      const resolved = resolvePool(name);
      const poolContract = new Contract(resolved.address, POOL_ABI, provider);
      const next = (await poolContract.getNextPositionId()) as bigint;

      // Walk back for a position with both legs non-zero and an EOA owner.
      // `next - 1` is often closed and burnt-in-spirit — f(x) reports a closed
      // position as (0, 0) rather than reverting — and a CONTRACT owner would
      // run its own code rather than behave as a plain account.
      let positionId: bigint | undefined;
      let owner = '';
      for (let id = next - 1n; id > next - 30n && id > 0n; id -= 1n) {
        const [colls, debts] = (await poolContract.getPosition(id)) as [
          bigint,
          bigint,
        ];
        if (colls === 0n || debts === 0n) continue;
        const holder = (await poolContract.ownerOf(id)) as string;
        if ((await provider.getCode(holder)) !== '0x') continue;
        positionId = id;
        owner = holder;
        break;
      }
      if (positionId === undefined) {
        throw new Error(`${name}: no live EOA-owned position in the last 30 ids`);
      }

      const [position, poolState] = await Promise.all([
        getFxPosition(positionId, name, provider),
        getFxPool(name, provider),
      ]);

      const close = computeFxClose({
        collateral: position.collateralAmount,
        debt: position.debt,
        // Deliberately over-funded, so the close sizes to a FULL one rather
        // than being capped by affordability.
        availableDebtToken: position.debt * 2n,
        repayFeeRatio: poolState.repayFeeRatio,
        withdrawFeeRatio: poolState.withdrawFeeRatio,
        railgunUnshieldFeeBps: 25n,
      });
      expect(close.partialClose).to.equal(false);

      const recipe = new FxMintCloseRecipe({
        pool: name,
        positionId,
        repayAmount: close.repayAmount,
        approveAmount: close.approveAmount,
        withdrawColl: close.withdrawColl,
        withdrawFeeRatio: poolState.withdrawFeeRatio,
        partialClose: close.partialClose,
      });

      const output = await recipe.getRecipeOutput({
        railgunAddress: ZK_ADDRESS,
        networkName: NetworkName.Ethereum,
        erc20Amounts: [
          {
            tokenAddress: resolved.debtToken,
            decimals: resolved.debtDecimals,
            isBaseToken: false,
            amount: close.approveAmount * 2n,
          },
        ],
        nfts: [
          {
            nftAddress: resolved.address,
            tokenSubID: '0x' + positionId.toString(16),
            nftTokenType: NFTTokenType.ERC721,
            amount: 1n,
          },
        ],
      });

      const erc20 = new Contract(
        resolved.debtToken,
        [
          'function balanceOf(address) view returns (uint256)',
          'function allowance(address,address) view returns (uint256)',
        ],
        provider,
      );
      const balBase = await probe(
        resolved.debtToken,
        erc20.interface.encodeFunctionData('balanceOf', [owner]),
        base => mapSlot(owner, base),
      );
      expect(balBase, 'balance slot').to.not.equal(undefined);
      const allowBase = await probe(
        resolved.debtToken,
        erc20.interface.encodeFunctionData('allowance', [
          owner,
          resolved.poolManager,
        ]),
        base => nested(owner, resolved.poolManager, base),
      );
      expect(allowBase, 'allowance slot').to.not.equal(undefined);

      const balSlot = mapSlot(owner, balBase as string);
      const allowSlot = nested(
        owner,
        resolved.poolManager,
        allowBase as string,
      );
      const funded = {
        [resolved.debtToken]: {
          stateDiff: { [balSlot]: HUGE, [allowSlot]: HUGE },
        },
      };

      // CONTROL. Zero the balance and the allowance; operate() must revert.
      //
      // Zeroing, not omitting. Several of these owners hold a real PoolManager
      // allowance on chain, so "leave the override out" does not remove the
      // allowance and the control passes vacuously — which is how it read green
      // upstream on the long pools, where the operate() being tested was
      // reverting for an unrelated reason anyway.
      const operateCall = output.crossContractCalls[
        output.crossContractCalls.length - 1
      ] as { to: string; data: string };
      let controlReverted = false;
      try {
        await provider.send('eth_call', [
          { from: owner, to: operateCall.to, data: operateCall.data },
          'latest',
          {
            [resolved.debtToken]: {
              stateDiff: { [balSlot]: ZERO, [allowSlot]: ZERO },
            },
          },
        ]);
      } catch {
        controlReverted = true;
      }
      expect(
        controlReverted,
        `${name}: CONTROL passed — the node is ignoring state overrides, so ` +
          'every other assertion in this test is meaningless',
      ).to.equal(true);

      // Every leg of the recipe's OWN calldata must succeed. Replaying what the
      // recipe emits, rather than hand-rolled calldata, is what makes this a
      // test of the encoding rather than of the pool.
      for (const call of output.crossContractCalls as {
        to: string;
        data: string;
      }[]) {
        await provider.send('eth_call', [
          { from: owner, to: call.to, data: call.data },
          'latest',
          funded,
        ]);
      }
    });

    it(`reports a repay ceiling below the full debt on ${name}`, async () => {
      // The sibling constraint. A repay leaves collateral in place, so f(x)'s
      // minDebtRatio floor bounds it — measured at head, ~99.97% of debt on a
      // long but only ~89% on a short. "Repay everything" is not expressible.
      const resolved = resolvePool(name);
      const poolContract = new Contract(resolved.address, POOL_ABI, provider);
      const next = (await poolContract.getNextPositionId()) as bigint;

      let positionId: bigint | undefined;
      for (let id = next - 1n; id > next - 30n && id > 0n; id -= 1n) {
        const [colls, debts] = (await poolContract.getPosition(id)) as [
          bigint,
          bigint,
        ];
        if (colls > 0n && debts > 0n) {
          positionId = id;
          break;
        }
      }
      if (positionId === undefined) {
        throw new Error(`${name}: no live position in the last 30 ids`);
      }

      const ceiling = await getFxRepayCeiling(positionId, name, provider);
      expect(ceiling.minRemainingDebt > 0n).to.equal(true);
      expect(ceiling.maxRepayAmount < ceiling.debt).to.equal(true);
      expect(ceiling.maxRepayFraction < 10n ** 18n).to.equal(true);
    });
  });
});
