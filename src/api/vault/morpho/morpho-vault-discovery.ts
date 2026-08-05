import {
  Interface,
  type InterfaceAbi,
  type Log,
  type Provider,
  getAddress,
  zeroPadValue,
} from 'ethers';

// =============================================================================
// MetaMorpho / Morpho Vault V2 discovery — enumerating vaults from the factories
// that deployed them.
//
// ## Why this exists
//
// The curated registry in `steps/vault/morpho/morpho-vault-util.ts` carries two
// addresses. Mainnet carries 1,108 (measured below). A consumer that wants "a
// USDC Morpho vault" therefore either hardcodes one of the two, or reaches for a
// hosted indexer — an API key and a liveness dependency this package cannot
// verify. Neither is necessary: all three factories index their own vaults, both
// in logs and in an on-chain registry mapping.
//
// ## Measured population (Ethereum mainnet, head block 25,688,692)
//
// | factory                                      | vaults | first creation |
// |----------------------------------------------|--------|----------------|
// | `MetaMorphoFactory`   `0xA9c3…1101` (v1.0)   |     88 |     18,927,491 |
// | `MetaMorphoV1_1Factory` `0x1897…5c24`        |    362 |     21,450,663 |
// | `VaultV2Factory`      `0xA1D9…0405`          |    658 |     23,375,073 |
//
// Every one of the 1,108 was confirmed by reading its factory's own registry
// getter (`isMetaMorpho` / `isVaultV2`) and its live `asset()`: 1,108/1,108
// registered, 1,108/1,108 with a live `asset()` equal to the asset in the
// creation log, 0 mismatches.
//
// ## The topic-layout trap — this cannot be one query
//
// The two creation events index different things at different positions:
//
// | event                    | topic1 | topic2 | topic3 | data                     |
// |--------------------------|--------|--------|--------|--------------------------|
// | `CreateMetaMorpho`       | vault  | caller | **asset** | owner, timelock, name, symbol, salt |
// | `CreateVaultV2`          | owner  | **asset** | vault  | salt                  |
//
// So the asset sits at topic3 on the MetaMorpho factories and at topic2 on the
// V2 factory, and the VAULT ADDRESS sits at the opposite one. A single
// `eth_getLogs` with both topic0s and the asset pinned at one position does not
// half-work — it returns exactly the factories whose layout it happens to match
// and silently zero of the other. Pinning at topic3 drops all 658 V2 vaults;
// pinning at topic2 drops all 450 MetaMorpho vaults. This is the same shape of
// bug as the Blue position scan (`api/morpho/morpho-blue-events.ts`), so this
// module issues one query per factory and never merges them.
//
// The upside of the asset being indexed at all: unlike Blue's `CreateMarket`
// (whose entire `MarketParams` struct is in the data word, forcing a full sweep),
// "every USDC vault" here is a SERVER-side filter. Three queries per block chunk,
// not a download of every vault ever made.
//
// ## Self-verification: not possible from the log alone
//
// A Blue `CreateMarket` log carries the market id and the params that hash to it,
// so the reader recomputes one from the other and trusts neither. These logs
// carry no such redundancy — there is nothing in a `CreateVaultV2` log to check
// the vault address against. The authoritative check is the factory's own
// registry mapping, which is one `eth_call` and needs no log access at all:
// {@link verifyMorphoVaultFactoryRegistration}, used by the screening layer.
// That check is strictly more useful than an in-log one, because it also answers
// for an address a caller got from somewhere else entirely.
//
// ## What discovery does NOT tell you
//
// That a vault exists says nothing about whether RAILGUN can use it. 43 of the
// 658 V2 vaults carry a SHARE gate, which makes shielding their shares
// impossible (see `morpho-vault-screening.ts`), and 340 of the 1,108 hold zero
// assets. Enumerate here, screen there.
// =============================================================================

/**
 * Which contract generation deployed a vault. This is not cosmetic: it decides
 * whether the vault can be gated at all.
 *
 * Measured across the full population: all 450 `metamorpho-v1`/`metamorpho-v1.1`
 * vaults revert on all four Vault V2 gate getters (no gate mechanism exists in
 * their bytecode), and all 658 `vault-v2` vaults answer all four. The split is
 * clean — there was not one partial or ambiguous vault.
 */
export type MorphoVaultGeneration =
  | 'metamorpho-v1'
  | 'metamorpho-v1.1'
  | 'vault-v2';

/** `CreateMetaMorpho`, emitted identically by the v1.0 and v1.1 factories. */
export const CREATE_METAMORPHO_ABI = [
  'event CreateMetaMorpho(address indexed metaMorpho, address indexed caller, address initialOwner, uint256 initialTimelock, address indexed asset, string name, string symbol, bytes32 salt)',
] as const;

/**
 * `CreateVaultV2` from `morpho-org/vault-v2` `IVaultV2Factory`. Note the vault
 * address is the LAST parameter and `salt` is the only unindexed one — the
 * mirror image of the MetaMorpho layout.
 */
export const CREATE_VAULT_V2_ABI = [
  'event CreateVaultV2(address indexed owner, address indexed asset, bytes32 salt, address indexed newVaultV2)',
] as const;

export const CREATE_METAMORPHO_INTERFACE = new Interface(
  CREATE_METAMORPHO_ABI as unknown as InterfaceAbi,
);

export const CREATE_VAULT_V2_INTERFACE = new Interface(
  CREATE_VAULT_V2_ABI as unknown as InterfaceAbi,
);

export const CREATE_METAMORPHO_TOPIC0 =
  CREATE_METAMORPHO_INTERFACE.getEvent('CreateMetaMorpho')?.topicHash ?? '';

export const CREATE_VAULT_V2_TOPIC0 =
  CREATE_VAULT_V2_INTERFACE.getEvent('CreateVaultV2')?.topicHash ?? '';

/**
 * One deployer of Morpho vaults, with everything a scan needs to read it
 * correctly. The topic indices are per-factory precisely because they differ —
 * see the trap note at the top of this file.
 */
export type MorphoVaultFactory = {
  address: string;
  generation: MorphoVaultGeneration;
  /** Human label, for error messages. */
  name: string;
  topic0: string;
  /** Topic index holding the created vault's address. */
  vaultTopicIndex: 1 | 3;
  /** Topic index holding the vault's underlying asset. */
  assetTopicIndex: 2 | 3;
  /**
   * Block of this factory's FIRST creation, measured rather than taken from a
   * deploy record. Scanning from Blue's genesis instead costs millions of empty
   * blocks per factory for the same answer.
   */
  firstVaultBlock: number;
  /** The factory's own registry mapping getter. */
  registryFunction: 'isMetaMorpho' | 'isVaultV2';
};

/**
 * The three Ethereum mainnet factories. Each was confirmed on-chain by function
 * selector, not by name: v1.0 and v1.1 expose exactly
 * `isMetaMorpho`/`MORPHO`/`createMetaMorpho` and both report `MORPHO()` ==
 * `0xBBBB…FFCb` (the Blue singleton); the V2 factory exposes exactly
 * `isVaultV2`/`vaultV2`/`createVaultV2`.
 *
 * The registries are SEPARATE, which matters: `isMetaMorpho` on the v1.0 factory
 * answers `true` for Steakhouse USDC `0xBEEF0173…` and the v1.1 factory answers
 * `false` for the same vault. A one-factory membership check therefore rejects
 * real vaults — {@link verifyMorphoVaultFactoryRegistration} asks all three.
 */
export const MORPHO_VAULT_FACTORIES: readonly MorphoVaultFactory[] = [
  {
    address: '0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101',
    generation: 'metamorpho-v1',
    name: 'MetaMorphoFactory',
    topic0: CREATE_METAMORPHO_TOPIC0,
    vaultTopicIndex: 1,
    assetTopicIndex: 3,
    firstVaultBlock: 18_927_491,
    registryFunction: 'isMetaMorpho',
  },
  {
    address: '0x1897A8997241C1cD4bD0698647e4EB7213535c24',
    generation: 'metamorpho-v1.1',
    name: 'MetaMorphoV1_1Factory',
    topic0: CREATE_METAMORPHO_TOPIC0,
    vaultTopicIndex: 1,
    assetTopicIndex: 3,
    firstVaultBlock: 21_450_663,
    registryFunction: 'isMetaMorpho',
  },
  {
    address: '0xA1D94F746dEfa1928926b84fB2596c06926C0405',
    generation: 'vault-v2',
    name: 'VaultV2Factory',
    topic0: CREATE_VAULT_V2_TOPIC0,
    vaultTopicIndex: 3,
    assetTopicIndex: 2,
    firstVaultBlock: 23_375_073,
    registryFunction: 'isVaultV2',
  },
] as const;

export const morphoVaultFactoryForAddress = (
  address: string,
): MorphoVaultFactory | undefined =>
  MORPHO_VAULT_FACTORIES.find(
    factory => factory.address.toLowerCase() === address.toLowerCase(),
  );

/** One vault, as its creation log describes it. Checksummed addresses. */
export type MorphoDiscoveredVault = {
  vaultAddress: string;
  assetAddress: string;
  generation: MorphoVaultGeneration;
  factoryAddress: string;
  createdAtBlock: number;
  /**
   * The account the factory handed initial ownership to. On MetaMorpho this is
   * the `initialOwner` argument; on V2 it is the indexed `owner`. Owners change
   * afterwards — this is provenance, never a current-state answer.
   */
  initialOwner: string;
  salt: string;
  /** MetaMorpho only: V2's creation event carries no name/symbol. */
  name?: string;
  symbol?: string;
  /** MetaMorpho only. Seconds. */
  initialTimelock?: bigint;
  /**
   * Whether this generation has a gate mechanism at all. `false` for
   * `metamorpho-v1`/`v1.1`, whose bytecode has no gate getters, so their shares
   * are unconditionally transferable and RAILGUN can always shield them.
   * `true` for `vault-v2` — which does NOT mean gated, only that it must be
   * read. See `morpho-vault-screening.ts`.
   */
  canBeGated: boolean;
};

/** A block range one factory's scan could not read. Never silently dropped. */
export type MorphoVaultScanGap = {
  factoryAddress: string;
  fromBlock: number;
  toBlock: number;
  reason: string;
};

export type MorphoVaultScan = {
  vaults: MorphoDiscoveredVault[];
  /** Ranges that failed. A non-empty list means `vaults` is a partial answer. */
  unscanned: MorphoVaultScanGap[];
  /** `unscanned.length === 0`. Surfaced so a caller cannot render a total blind. */
  complete: boolean;
  /** Factories actually queried, in scan order. */
  factories: readonly string[];
  /** The head the scan was bounded by. */
  toBlock: number;
  /** The asset the scan was server-filtered on, if any. Checksummed. */
  asset?: string;
};

export type ScanMorphoVaultsParams = {
  provider: Provider;
  /**
   * Server-side filter on the vault's underlying asset, applied at the correct
   * topic index PER FACTORY. This is the cheap path — prefer it over scanning
   * everything and filtering locally.
   */
  asset?: string;
  /**
   * Defaults to each factory's own {@link MorphoVaultFactory.firstVaultBlock}.
   * A single number applies to every factory (and is clamped up to each
   * factory's first block, since earlier blocks cannot contain its logs).
   */
  fromBlock?: number;
  /** Defaults to the provider's latest block. */
  toBlock?: number;
  /**
   * Blocks per `eth_getLogs`. Defaults to 200,000 — creations are sparse
   * (1,108 logs across ~7M blocks) and this was the value the measurement ran
   * at. Lower it for a node that caps by range: 10,000 is the common public cap.
   */
  chunkSize?: number;
  /** Restrict the scan. Defaults to all of {@link MORPHO_VAULT_FACTORIES}. */
  factories?: readonly MorphoVaultFactory[];
  /** Restrict by generation. Applied on top of `factories`. */
  generations?: readonly MorphoVaultGeneration[];
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Enumerate Morpho vaults from their factories' creation logs.
 *
 * One `eth_getLogs` per factory per block chunk. With an `asset` the node does
 * the filtering, so "every USDC vault" costs the same as "every vault".
 *
 * **Errors are reported, never mapped to an empty result.** A failed range
 * becomes an `unscanned` entry against the factory that owned it and clears
 * `complete`, so "no vault for this asset" and "the scan could not read the
 * blocks where that vault was created" stay distinguishable. Note that the
 * common public endpoints refuse `eth_getLogs` outright (publicnode answers 403,
 * ankr requires a key), so an empty-and-incomplete scan is the NORMAL result on
 * a keyless RPC — a caller that ignores `complete` will report "this asset has
 * no Morpho vault" to a user whose vault plainly exists.
 *
 * A failed chunk is not retried here, matching `scanMorphoBluePositionLogs`: a
 * hidden retry turns a rate limit into a long silent stall, and the recorded
 * range is precise enough to re-scan exactly what was missed.
 *
 * Cost: creations are append-only, so cache the result and re-scan only
 * `[lastToBlock + 1, head]`.
 */
export async function scanMorphoVaults(
  params: ScanMorphoVaultsParams,
): Promise<MorphoVaultScan> {
  const { provider } = params;
  const chunkSize = params.chunkSize ?? 200_000;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(
      `scanMorphoVaults: chunkSize must be a positive integer (got ${chunkSize})`,
    );
  }

  const factories = (params.factories ?? MORPHO_VAULT_FACTORIES).filter(
    factory =>
      params.generations === undefined ||
      params.generations.includes(factory.generation),
  );
  const asset =
    params.asset === undefined ? undefined : getAddress(params.asset);
  const factoryAddresses = factories.map(factory => factory.address);

  let toBlock: number;
  if (params.toBlock !== undefined) {
    toBlock = params.toBlock;
  } else {
    try {
      toBlock = await provider.getBlockNumber();
    } catch (cause: unknown) {
      // Cannot even establish the range. Report it rather than returning an
      // empty scan that reads as "this asset has no vault".
      return {
        vaults: [],
        unscanned: factories.map(factory => ({
          factoryAddress: factory.address,
          fromBlock: factory.firstVaultBlock,
          toBlock: factory.firstVaultBlock,
          reason: `could not read the current block: ${errorMessage(cause)}`,
        })),
        complete: false,
        factories: factoryAddresses,
        // -1, not 0, and the difference is not cosmetic: the documented contract
        // is that this is -1 when no block could be read, and a caller resuming
        // an append-only scan from `toBlock + 1` would restart from block 1 on a
        // 0 — re-walking the entire chain to reach the same answer. -1 resumes
        // at 0, which is the honest "start over" rather than an off-by-one that
        // looks like progress.
        toBlock: -1,
        asset,
      };
    }
  }

  const vaults: MorphoDiscoveredVault[] = [];
  const unscanned: MorphoVaultScanGap[] = [];

  for (const factory of factories) {
    // Clamp up: a factory cannot have emitted before its own first creation, so
    // a caller-supplied earlier start is wasted range, not extra coverage.
    const fromBlock = Math.max(
      params.fromBlock ?? factory.firstVaultBlock,
      factory.firstVaultBlock,
    );
    const topics: (string | null)[] = [factory.topic0, null, null, null];
    if (asset !== undefined) {
      topics[factory.assetTopicIndex] = zeroPadValue(asset, 32);
    }
    // Trailing nulls carry no filtering information and some nodes reject a
    // 4-length topics array on an event with fewer topics; trim them.
    while (topics.length > 1 && topics[topics.length - 1] === null) {
      topics.pop();
    }

    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, toBlock);
      let logs: readonly Log[];
      try {
        logs = await provider.getLogs({
          address: factory.address,
          topics,
          fromBlock: start,
          toBlock: end,
        });
      } catch (cause: unknown) {
        unscanned.push({
          factoryAddress: factory.address,
          fromBlock: start,
          toBlock: end,
          reason: errorMessage(cause),
        });
        continue;
      }

      for (const log of logs) {
        const decoded = decodeMorphoVaultCreationLog(log, factory);
        if (decoded === undefined) {
          // A log matching the topic that does not decode is not a vault.
          // Record the block rather than the log, so `complete` carries the
          // doubt into the caller's hands.
          unscanned.push({
            factoryAddress: factory.address,
            fromBlock: log.blockNumber,
            toBlock: log.blockNumber,
            reason: `${factory.name} creation log at block ${log.blockNumber} failed to decode`,
          });
          continue;
        }
        vaults.push(decoded);
      }
    }
  }

  vaults.sort(
    (a, b) =>
      a.createdAtBlock - b.createdAtBlock ||
      a.vaultAddress.localeCompare(b.vaultAddress),
  );

  return {
    vaults,
    unscanned,
    complete: unscanned.length === 0,
    factories: factoryAddresses,
    toBlock,
    asset,
  };
}

/**
 * Decode one creation log against the factory that emitted it.
 *
 * Exported because pinning a decoder against recorded bytes is the only
 * verification available to a consumer without `eth_getLogs`, and because the
 * per-factory topic indices are the part that is easy to get wrong.
 *
 * Returns `undefined` rather than throwing: the caller decides whether an
 * undecodable log is a gap (it is) or an error.
 */
export const decodeMorphoVaultCreationLog = (
  log: Pick<Log, 'topics' | 'data' | 'blockNumber'>,
  factory: MorphoVaultFactory,
): MorphoDiscoveredVault | undefined => {
  if (log.topics.length !== 4 || log.topics[0] !== factory.topic0) {
    return undefined;
  }
  const canBeGated = factory.generation === 'vault-v2';
  try {
    const vaultAddress = getAddress(
      `0x${log.topics[factory.vaultTopicIndex].slice(26)}`,
    );
    const assetAddress = getAddress(
      `0x${log.topics[factory.assetTopicIndex].slice(26)}`,
    );
    if (factory.generation === 'vault-v2') {
      const decoded = CREATE_VAULT_V2_INTERFACE.decodeEventLog(
        'CreateVaultV2',
        log.data,
        log.topics,
      );
      return {
        vaultAddress,
        assetAddress,
        generation: factory.generation,
        factoryAddress: factory.address,
        createdAtBlock: log.blockNumber,
        initialOwner: getAddress(decoded[0] as string),
        salt: decoded[2] as string,
        canBeGated,
      };
    }
    const decoded = CREATE_METAMORPHO_INTERFACE.decodeEventLog(
      'CreateMetaMorpho',
      log.data,
      log.topics,
    );
    return {
      vaultAddress,
      assetAddress,
      generation: factory.generation,
      factoryAddress: factory.address,
      createdAtBlock: log.blockNumber,
      initialOwner: getAddress(decoded[2] as string),
      initialTimelock: decoded[3] as bigint,
      name: decoded[5] as string,
      symbol: decoded[6] as string,
      salt: decoded[7] as string,
      canBeGated,
    };
  } catch {
    return undefined;
  }
};

export type MorphoVaultFilter = {
  /** Case-insensitive. */
  asset?: string;
  generations?: readonly MorphoVaultGeneration[];
  /**
   * Drop `vault-v2` vaults. Blunt but exact: a V1 vault has no gate mechanism
   * in its bytecode, so its shares can always be shielded, and no state read is
   * needed to know that. Use this when an unavoidably-safe answer is worth more
   * than reach; use `screenMorphoVaults` when it is not.
   */
  ungatableOnly?: boolean;
  createdOnOrAfterBlock?: number;
};

/**
 * Filter a scan result. Pure — no network, no state.
 *
 * Separate from the scan because the scan is the expensive part and its result
 * is reusable. Note the asset filter here is a fallback: passing `asset` to
 * {@link scanMorphoVaults} pushes the same filter onto the node.
 */
export const filterMorphoVaults = (
  scan: MorphoVaultScan,
  filter: MorphoVaultFilter,
): MorphoDiscoveredVault[] =>
  scan.vaults.filter(
    vault =>
      (filter.asset === undefined ||
        vault.assetAddress.toLowerCase() === filter.asset.toLowerCase()) &&
      (filter.generations === undefined ||
        filter.generations.includes(vault.generation)) &&
      (filter.ungatableOnly !== true || !vault.canBeGated) &&
      (filter.createdOnOrAfterBlock === undefined ||
        vault.createdAtBlock >= filter.createdOnOrAfterBlock),
  );
