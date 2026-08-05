import { type Provider, getAddress } from 'ethers';
import {
  MORPHO_VAULT_FACTORIES,
  scanMorphoVaults,
  type MorphoDiscoveredVault,
  type MorphoVaultGeneration,
  type MorphoVaultScanGap,
} from './morpho-vault-discovery';
import {
  hasUnreadableBlocker,
  screenMorphoVault,
  type MorphoVaultScreening,
} from './morpho-vault-screening';

// =============================================================================
// "Find me a vault for this asset" — the one call that composes enumeration and
// screening without leaving the caller a way to get it wrong.
//
// `scanMorphoVaults` answers which vaults exist and `screenMorphoVault` answers
// whether RAILGUN can round-trip through one. Wiring them together looks trivial
// and has two traps that a caller hits by default:
//
//   1. **The empty scan.** `eth_getLogs` is the ONLY enumeration path (verified:
//      no factory exposes an enumerable getter — see the note on
//      {@link MORPHO_VAULT_SEEDS}), and the common keyless endpoints refuse it.
//      A caller that reads `scan.vaults.length === 0` as "this asset has no
//      Morpho vault" tells the user their vault does not exist. So this module
//      never returns a bare list: `complete` and `enumeration` ride along, and
//      a curated seed set keeps the keyless case USEFUL rather than empty.
//   2. **Resolving an asset by symbol.** Measured across the 115 distinct assets
//      the 1,108 live vaults hold: THREE separate addresses claim the symbol
//      `USDC`, and one of them reports 18 decimals rather than 6. `PYUSD`,
//      `EURe` and `USDz` are likewise claimed twice. Every entry point here
//      takes an asset ADDRESS and every candidate's live `asset()` is
//      cross-checked against it, so a decoy cannot be reached by asking for the
//      right ticker.
//
// ## Seeds are addresses, never state
//
// {@link MORPHO_VAULT_SEEDS} carries only facts that cannot change — the vault's
// address, its asset, and the factory generation that deployed it. It does NOT
// carry balances, gate configuration, or a usability verdict, because a V2
// curator can attach a gate at any time and a snapshot of that would go stale
// silently and dangerously. Every seed is screened live like any other
// candidate, so a seed that becomes gated tomorrow is reported blocked
// tomorrow. That is what makes a hardcoded list safe here.
// =============================================================================

/**
 * A curated Morpho vault, kept to the fields that are immutable for the life of
 * the contract. Everything a routing decision actually depends on is read live.
 */
export type MorphoVaultSeed = {
  /** Vault symbol, for logs and pickers. Not read on-chain — a label only. */
  readonly label: string;
  readonly vaultAddress: string;
  readonly assetAddress: string;
  /** Asset ticker. A LABEL — never resolve an asset by it, see the note above. */
  readonly assetSymbol: string;
  readonly generation: MorphoVaultGeneration;
};

/**
 * Curated Ethereum mainnet vaults, one to four per major asset.
 *
 * This is the keyless fallback, not the primary path — prefer
 * {@link findMorphoVaults} with a provider that serves `eth_getLogs`, which
 * enumerates all 1,108 live vaults instead of these 16. It exists because there
 * is no log-free enumeration to fall back to: the factories' dispatchers expose
 * only `isMetaMorpho(address)` / `isVaultV2(address)` (membership, given an
 * address you already have), `MORPHO()`, the `create*` entry points, and
 * `vaultV2(owner,asset,salt)` — verified by extracting the PUSH4 selector tables
 * from all three deployed factories. There is no `vaultsLength()`, no
 * `vaults(uint256)`, no array getter of any kind. A membership mapping cannot be
 * iterated, so without logs the only way to reach a vault is to already know its
 * address. Hence a curated list.
 *
 * Every entry was measured at Ethereum block 25,689,048 and satisfied ALL of:
 * registered by its factory; `asset()` matching the address recorded here;
 * `totalAssets()` answering (so the ERC-4626 previews quote); and NO gate of any
 * kind attached — for the V2 entries all four gate getters returned
 * `address(0)`, and the V1/V1.1 entries have no gate mechanism in their bytecode
 * at all. TVL at that block is noted per entry purely as provenance for why the
 * entry was picked; it is not a live figure and nothing reads it.
 *
 * Selection was "largest shieldable vault per major asset", drawn from a full
 * census of every vault the three factories ever created, so these are not
 * hand-picked favourites — they are the top of a measured ranking.
 */
export const MORPHO_VAULT_SEEDS: readonly MorphoVaultSeed[] = [
  // ---- USDC (6dp). 532 live vaults, 507 shieldable, 24 share-gated. ----
  {
    label: 'adpUSDC',
    vaultAddress: '0x55555815a5595991C3A0Ff119B59AEF6C8B55555',
    assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetSymbol: 'USDC',
    generation: 'metamorpho-v1.1',
  }, // 118,107,993 USDC
  {
    label: 'steakUSDC (V2)',
    vaultAddress: '0xbeef088055857739C12CD3765F20b7679Def0f51',
    assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetSymbol: 'USDC',
    generation: 'vault-v2',
  }, // 106,689,182 USDC — the shipped KNOWN_MORPHO_VAULTS_V2 entry.
  {
    label: 'gtusdcp',
    vaultAddress: '0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0',
    assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetSymbol: 'USDC',
    generation: 'vault-v2',
  }, // 78,208,107 USDC
  {
    label: 'steakUSDC',
    vaultAddress: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetSymbol: 'USDC',
    generation: 'metamorpho-v1',
  }, // 76,185,228 USDC — the shipped KNOWN_METAMORPHO_VAULTS entry.

  // ---- USDT (6dp). 120 live vaults, none gated. ----
  {
    label: 'steakUSDT',
    vaultAddress: '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa',
    assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    assetSymbol: 'USDT',
    generation: 'metamorpho-v1',
  }, // 87,726,735 USDT
  {
    label: 'steakUSDT (V2)',
    vaultAddress: '0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9',
    assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    assetSymbol: 'USDT',
    generation: 'vault-v2',
  }, // 73,968,897 USDT

  // ---- WETH (18dp). 101 live vaults, none gated. ----
  {
    label: 'steakETH',
    vaultAddress: '0xBEEf050ecd6a16c4e7bfFbB52Ebba7846C4b8cD4',
    assetAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    assetSymbol: 'WETH',
    generation: 'metamorpho-v1',
  }, // 12,212 WETH
  {
    label: 'vbgtWETH',
    vaultAddress: '0x31A5684983EeE865d943A696AAC155363bA024f9',
    assetAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    assetSymbol: 'WETH',
    generation: 'metamorpho-v1.1',
  }, // 9,793 WETH
  {
    label: 'gWETHq',
    vaultAddress: '0x1878805799273d10aE96a58201A6f5254CF9824F',
    assetAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    assetSymbol: 'WETH',
    generation: 'vault-v2',
  }, // 8,976 WETH

  // ---- WBTC (8dp). 16 live vaults, none gated. ----
  {
    label: 'vbgtWBTC',
    vaultAddress: '0x812B2C6Ab3f4471c0E43D4BB61098a9211017427',
    assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    assetSymbol: 'WBTC',
    generation: 'metamorpho-v1.1',
  }, // 390.74 WBTC
  {
    label: 'gtWBTCc',
    vaultAddress: '0x443df5eEE3196e9b2Dd77CaBd3eA76C3dee8f9b2',
    assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    assetSymbol: 'WBTC',
    generation: 'metamorpho-v1',
  }, // 53.52 WBTC

  // ---- DAI (18dp). 9 live vaults, none gated. ----
  {
    label: 'gtDAIcore',
    vaultAddress: '0x500331c9fF24D9d11aee6B07734Aa72343EA74a5',
    assetAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    assetSymbol: 'DAI',
    generation: 'metamorpho-v1',
  }, // 2,327,776 DAI

  // ---- USDS (18dp). 16 live vaults, none gated. ----
  {
    label: 'skyMoneyUsdsFlagship',
    vaultAddress: '0xE15fcC81118895b67b6647BBd393182dF44E11E0',
    assetAddress: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
    assetSymbol: 'USDS',
    generation: 'vault-v2',
  }, // 44,843,562 USDS

  // ---- PYUSD (6dp). The CANONICAL PYUSD — a second address also claims the
  // ticker, which is exactly why callers pass an address here. ----
  {
    label: 'senPYUSDmain',
    vaultAddress: '0xb576765fB15505433aF24FEe2c0325895C559FB2',
    assetAddress: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
    assetSymbol: 'PYUSD',
    generation: 'vault-v2',
  }, // 295,810,211 PYUSD
  {
    label: 'senPYUSDPRIMEv2',
    vaultAddress: '0xC21b08C16458202593D4D9B26b9984Ee67b38BbD',
    assetAddress: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
    assetSymbol: 'PYUSD',
    generation: 'vault-v2',
  }, // 176,650,520 PYUSD

  // ---- wstETH (18dp). 8 live vaults, none gated. ----
  {
    label: 'bbqWSTETH',
    vaultAddress: '0x833AdaeF212c5cD3f78906B44bBfb18258F238F0',
    assetAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    assetSymbol: 'wstETH',
    generation: 'metamorpho-v1.1',
  }, // 277.01 wstETH
] as const;

/** Curated seeds holding `asset`. Case-insensitive; `[]` for an unknown asset. */
export const morphoVaultSeedsForAsset = (
  asset: string,
): readonly MorphoVaultSeed[] => {
  const wanted = asset.toLowerCase();
  return MORPHO_VAULT_SEEDS.filter(
    seed => seed.assetAddress.toLowerCase() === wanted,
  );
};

/**
 * One screened vault, with where it came from.
 *
 * `enumerated` and `curated` are separate booleans rather than one "source"
 * field because they are not alternatives: a vault can be both, and the useful
 * question — "did the factory scan actually confirm this one, or am I only
 * offering it because it is on a hardcoded list?" — is answered by
 * `enumerated`.
 */
export type MorphoVaultCandidate = {
  readonly vaultAddress: string;
  /** Appeared in this run's factory scan. */
  readonly enumerated: boolean;
  /** Appears in {@link MORPHO_VAULT_SEEDS}. */
  readonly curated: boolean;
  /** Present when `enumerated`. */
  readonly discovered?: MorphoDiscoveredVault;
  readonly seed?: MorphoVaultSeed;
  readonly screening: MorphoVaultScreening;
};

/** What the enumeration half did, kept separate from what screening found. */
export type MorphoVaultEnumeration = {
  /** False when the caller passed `enumerate: false`. */
  readonly attempted: boolean;
  /** Every requested range was read. Always false when `attempted` is false. */
  readonly complete: boolean;
  readonly unscanned: readonly MorphoVaultScanGap[];
  /** Head the scan was bounded by, or `-1` when it did not run or could not read one. */
  readonly toBlock: number;
};

export type MorphoVaultSearch = {
  /** The asset searched for, checksummed. */
  readonly asset: string;
  /**
   * Every candidate, ranked: shieldable first (by `totalAssets`, largest
   * first), then blocked, then merely unreadable.
   */
  readonly candidates: readonly MorphoVaultCandidate[];
  /**
   * Screened clean — no blockers at all, and at or above `minTotalAssets`.
   * Ranked by `totalAssets` descending.
   */
  readonly shieldable: readonly MorphoVaultCandidate[];
  /**
   * Screened clean but holding less than `minTotalAssets`. Empty unless that
   * was set. Kept as its own bucket so a size preference is never mistaken for
   * a safety verdict — these are usable, just small.
   */
  readonly belowMinimum: readonly MorphoVaultCandidate[];
  /** A definite reason not to route here (share gate, unquotable, mismatch…). */
  readonly blocked: readonly MorphoVaultCandidate[];
  /** Nothing against them except that the screening could not be completed. */
  readonly unreadable: readonly MorphoVaultCandidate[];
  readonly enumeration: MorphoVaultEnumeration;
  /**
   * The whole answer is trustworthy: enumeration covered every range AND every
   * candidate screened without an unreadable blocker.
   *
   * **A caller must branch on this before saying "no vault found".** When it is
   * false and `shieldable` is empty, the honest statement is "could not
   * establish", not "none exists".
   */
  readonly complete: boolean;
};

export type FindMorphoVaultsParams = {
  provider: Provider;
  /**
   * Asset ADDRESS, never a ticker — several live vault assets share a symbol
   * with the real thing (three different addresses answer `USDC`). Pushed to
   * the node as a topic filter, and re-checked against each vault's live
   * `asset()`.
   */
  asset: string;
  /**
   * The ephemeral 7702 executor. Supplying it enables the per-account gate
   * check on asset-gated vaults; omitting it leaves that in each screening's
   * `unchecked` list.
   */
  account?: string;
  /**
   * Include {@link MORPHO_VAULT_SEEDS} for this asset in the candidate pool.
   * Default true. They are screened live exactly like enumerated vaults, so
   * this widens reach on a keyless RPC without weakening any check.
   */
  useCuratedSeeds?: boolean;
  /**
   * Run the factory scan. Default true. Set false to screen only the curated
   * seeds — the cheap path on an endpoint known to refuse `eth_getLogs`, and
   * honest about it: `enumeration.attempted` is then false and `complete` can
   * never be true.
   */
  enumerate?: boolean;
  /**
   * Drop vaults holding less than this (in the asset's own units) from
   * `shieldable`. A zero-TVL vault is legitimate but is usually not what a
   * caller wants — 340 of the 1,108 live vaults hold nothing. Vaults whose
   * `totalAssets` could not be READ are never dropped by this; they are already
   * unreadable and must stay visible as such.
   */
  minTotalAssets?: bigint;
  /** Simultaneous screenings. Defaults to 8. */
  concurrency?: number;
  /** Forwarded to {@link scanMorphoVaults}. */
  fromBlock?: number;
  toBlock?: number;
  chunkSize?: number;
};

/**
 * Rank key. A vault whose `totalAssets` could not be read sorts last rather
 * than as zero — the §9 rule applied to ordering, not just to reporting.
 */
const byTotalAssetsDescending = (
  a: MorphoVaultCandidate,
  b: MorphoVaultCandidate,
): number => {
  const left = a.screening.totalAssets;
  const right = b.screening.totalAssets;
  if (left === right) {
    return a.vaultAddress.localeCompare(b.vaultAddress);
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left > right ? -1 : 1;
};

/**
 * Find and screen every Morpho vault for one asset, ranked by size.
 *
 * Enumerates from the three factories' creation logs (server-side filtered on
 * the asset, at the correct topic index per factory), merges in the curated
 * seeds, then screens every candidate live — factory registration, live
 * `asset()` against the asset asked for, `totalAssets()` as the quote canary,
 * and the four Vault V2 gates.
 *
 * The screening is what makes the result actionable rather than a directory
 * listing. In particular a share-gated vault is REJECTED here rather than
 * ranked: a deposit into one succeeds, mints shares to the ephemeral executor,
 * and then the shield leg — `transferFrom(executor -> RAILGUN proxy)` — is
 * refused at both endpoints, leaving the position public. 43 of the 658 live
 * Vault V2 vaults are like that and 24 of them are USDC, so "give me a USDC
 * vault" walks into one at a meaningful rate.
 *
 * Cost: a handful of `eth_getLogs` plus six to nine `eth_call`s per candidate.
 * For repeated use, hold the {@link scanMorphoVaults} result (creations are
 * append-only) and re-screen only the shortlist — screening is the part that
 * must be fresh, since a curator can attach a gate at any block.
 */
export async function findMorphoVaults(
  params: FindMorphoVaultsParams,
): Promise<MorphoVaultSearch> {
  const { provider, account } = params;
  const asset = getAddress(params.asset);
  const concurrency = params.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `findMorphoVaults: concurrency must be a positive integer (got ${concurrency})`,
    );
  }
  const shouldEnumerate = params.enumerate !== false;
  const useSeeds = params.useCuratedSeeds !== false;

  let enumeration: MorphoVaultEnumeration = {
    attempted: false,
    complete: false,
    unscanned: [],
    toBlock: -1,
  };
  const discovered = new Map<string, MorphoDiscoveredVault>();

  if (shouldEnumerate) {
    const scan = await scanMorphoVaults({
      provider,
      asset,
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
      chunkSize: params.chunkSize,
    });
    enumeration = {
      attempted: true,
      complete: scan.complete,
      unscanned: scan.unscanned,
      toBlock: scan.toBlock,
    };
    for (const vault of scan.vaults) {
      discovered.set(vault.vaultAddress.toLowerCase(), vault);
    }
  }

  const seeds = useSeeds ? morphoVaultSeedsForAsset(asset) : [];
  const seedByAddress = new Map(
    seeds.map(seed => [seed.vaultAddress.toLowerCase(), seed]),
  );

  const addresses = new Set<string>([
    ...discovered.keys(),
    ...seedByAddress.keys(),
  ]);

  const entries = [...addresses].map(key => ({
    key,
    discovered: discovered.get(key),
    seed: seedByAddress.get(key),
  }));

  const candidates: MorphoVaultCandidate[] = [];
  for (let start = 0; start < entries.length; start += concurrency) {
    const slice = entries.slice(start, start + concurrency);
    const batch = await Promise.all(
      slice.map(async entry => {
        const vaultAddress =
          entry.discovered?.vaultAddress ??
          getAddress(entry.seed?.vaultAddress ?? entry.key);
        // The factory is only passed when the SCAN produced this entry: a seed
        // records a generation, but taking that on trust would skip the very
        // registry check that proves the address is a Morpho vault at all.
        const factory =
          entry.discovered === undefined
            ? undefined
            : MORPHO_VAULT_FACTORIES.find(
                candidate =>
                  candidate.address.toLowerCase() ===
                  entry.discovered?.factoryAddress.toLowerCase(),
              );
        const screening = await screenMorphoVault({
          vaultAddress,
          provider,
          account,
          // Always the asset the CALLER asked for. For a scanned vault this is
          // also the asset its creation log declared (the topic the node
          // filtered on), so the check doubles as log-decode verification.
          expectedAsset: asset,
          factory,
        });
        return {
          vaultAddress,
          enumerated: entry.discovered !== undefined,
          curated: entry.seed !== undefined,
          discovered: entry.discovered,
          seed: entry.seed,
          screening,
        };
      }),
    );
    candidates.push(...batch);
  }

  const minTotalAssets = params.minTotalAssets ?? 0n;
  // Classified in one exhaustive pass, most-definite first. `screening.ok` is
  // exactly "no blockers", so every candidate lands in precisely one bucket.
  const shieldable: MorphoVaultCandidate[] = [];
  const blocked: MorphoVaultCandidate[] = [];
  const unreadable: MorphoVaultCandidate[] = [];
  const belowMinimum: MorphoVaultCandidate[] = [];
  for (const candidate of candidates) {
    const { screening } = candidate;
    if (
      screening.blockers.some(blocker => blocker.code !== 'unreadable')
    ) {
      // A definite blocker outranks an unreadable one: the vault is out either
      // way, but "we know why" and "we could not look" are different answers.
      blocked.push(candidate);
    } else if (hasUnreadableBlocker(screening)) {
      unreadable.push(candidate);
    } else if (
      minTotalAssets > 0n &&
      screening.totalAssets !== undefined &&
      screening.totalAssets < minTotalAssets
    ) {
      // Healthy, just smaller than the caller wants. Deliberately NOT folded
      // into `blocked` (nothing is wrong with it) nor `unreadable` (it was read
      // fine) — a caller lowering its floor should find it here.
      belowMinimum.push(candidate);
    } else {
      shieldable.push(candidate);
    }
  }
  shieldable.sort(byTotalAssetsDescending);
  blocked.sort(byTotalAssetsDescending);
  unreadable.sort(byTotalAssetsDescending);
  belowMinimum.sort(byTotalAssetsDescending);

  return {
    asset,
    candidates: [...shieldable, ...belowMinimum, ...blocked, ...unreadable],
    shieldable,
    belowMinimum,
    blocked,
    unreadable,
    enumeration,
    complete:
      enumeration.attempted &&
      enumeration.complete &&
      !candidates.some(candidate => hasUnreadableBlocker(candidate.screening)),
  };
}
