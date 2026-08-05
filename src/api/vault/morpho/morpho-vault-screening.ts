import { Contract, type Provider, getAddress } from 'ethers';
import {
  MORPHO_VAULT_FACTORIES,
  type MorphoDiscoveredVault,
  type MorphoVaultFactory,
  type MorphoVaultGeneration,
} from './morpho-vault-discovery';
import {
  MorphoVaultAPI,
  type MorphoVaultGateAccess,
  type MorphoVaultGates,
} from './metamorpho-vault-api';

// =============================================================================
// Screening — telling a usable Morpho vault from one that will strand shares.
//
// Discovery answers "which vaults exist". It says nothing about whether a
// RAILGUN batch can complete a round trip through one, and the difference is not
// rare:
//
//   - 43 of the 658 live Vault V2 vaults carry a SHARE gate. Depositing into one
//     mints shares to the ephemeral executor, and the shield leg is
//     `transferFrom(executor -> RAILGUN proxy)`, which V2 gate-checks on BOTH
//     endpoints. The proxy is a fixed third party that no curator allowlist will
//     contain, so the shares are minted and then unshieldable — the deposit
//     "works" and the position is stuck public. 24 of those 43 are USDC vaults,
//     so this is squarely in the path of anyone asking for "a USDC Morpho vault".
//   - 2 of the 658 revert on `totalAssets()` — and therefore on every ERC-4626
//     preview. A quote against them throws; a caller that discovered them by
//     asset alone has no way to know before it does.
//   - 340 of the 1,108 hold zero assets. That is NOT a blocker (a first
//     depositor is legitimate) but it is surfaced, because it is the difference
//     between a live vault and a shell someone deployed and abandoned.
//
// ## Read-failure policy (brief §9)
//
// The same discipline as `api/morpho/morpho-blue-rediscovery.ts` and
// `api/borrow/fx/fx-open-preflight.ts`: an unreadable check is not a passing
// check. Every failed read becomes an explicit `unreadable` blocker, `ok` is
// never true when one is present, and no read failure is ever coerced into a
// value — in particular {@link MorphoVaultScreening.totalAssets} is `undefined`
// when it could not be read and `0n` only when the vault genuinely holds
// nothing. A caller must be able to tell "empty" from "could not look".
//
// ## Relationship to the quote path
//
// `MorphoVaultAPI.assertVaultUsable` enforces the same share-gate rule by
// THROWING inside every `get*Quote`, which is the funnel all three vault recipes
// pass through. Screening is the same question asked earlier and in bulk, so a
// caller picks a vault it can actually use instead of discovering the refusal
// after it has chosen one. It deliberately calls `MorphoVaultAPI.getVaultGates`
// rather than re-reading the gates itself, so the two can never disagree.
// =============================================================================

/**
 * True only for the two ethers v6 failure modes that mean "this contract does
 * not answer that function": an empty revert (`CALL_EXCEPTION`) and an
 * undecodable/empty return (`BAD_DATA`). Everything else — `NETWORK_ERROR`,
 * `SERVER_ERROR`, `TIMEOUT`, a rate limit — is a transport failure and must be
 * reported as unreadable, never as a negative answer.
 *
 * Duplicated from `metamorpho-vault-api.ts` (where it is module-private) rather
 * than widening that module's surface; the two must stay in step.
 */
const isUnanswerableCall = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'CALL_EXCEPTION' || code === 'BAD_DATA';
};

const REGISTRY_ABI = [
  'function isMetaMorpho(address) view returns (bool)',
  'function isVaultV2(address) view returns (bool)',
] as const;

const VAULT_STATE_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
] as const;

/**
 * Why a vault should not be routed to.
 *
 * `unreadable` is a first-class code rather than an absence, so "screened and
 * fine" and "could not screen" are never the same value.
 */
export type MorphoVaultBlockerCode =
  | 'not-factory-registered'
  | 'not-erc4626'
  | 'share-gate'
  | 'asset-gate'
  | 'asset-mismatch'
  | 'unquotable'
  | 'unreadable';

export type MorphoVaultBlocker = {
  readonly code: MorphoVaultBlockerCode;
  readonly detail: string;
};

export type MorphoVaultScreening = {
  readonly vaultAddress: string;
  /**
   * The vault's live `asset()`. `undefined` when the call was refused (a
   * `not-erc4626` blocker) or could not be reached (an `unreadable` one) —
   * the blockers say which.
   */
  readonly assetAddress?: string;
  /**
   * Established by factory registry membership, not by the caller's claim.
   * `undefined` when no factory answered `true` or the reads failed.
   */
  readonly generation?: MorphoVaultGeneration;
  readonly factoryAddress?: string;
  /** Gate configuration, from {@link MorphoVaultAPI.getVaultGates}. */
  readonly gates?: MorphoVaultGates;
  /** Present only when an `account` was supplied and the gates needed asking. */
  readonly gateAccess?: MorphoVaultGateAccess;
  /**
   * `totalAssets()`. `0n` means the vault genuinely holds nothing; `undefined`
   * means the read failed and nothing may be concluded from it.
   */
  readonly totalAssets?: bigint;
  /**
   * The vault answers `totalAssets()`, which every ERC-4626 preview routes
   * through. Measured across all 1,108 live vaults: answering `totalAssets()`
   * and answering `previewDeposit`/`previewRedeem` agreed on every single one
   * (1,106 answered all three, 2 answered none), so this one call is a
   * validated stand-in for "this vault will quote".
   */
  readonly quotable?: boolean;
  /** True only when there are no blockers at all, `unreadable` included. */
  readonly ok: boolean;
  readonly blockers: readonly MorphoVaultBlocker[];
  /** Checks deliberately NOT performed, named so the omission is legible. */
  readonly unchecked: readonly string[];
  /** The block the reads were taken around. `-1` when it could not be read. */
  readonly checkedAtBlock: number;
};

/** Named so the omission is legible at the call site rather than implied. */
const BASE_UNCHECKED = Object.freeze([
  // Nothing read here binds the next block. A curator can attach a gate, and a
  // Vault V2 adapter can start reverting, between this screening and the batch.
  'same-block-guarantee',
  // Whether the vault's underlying Blue markets are sane (idle IRM, bad oracle).
  // That is `api/morpho/morpho-blue-market-discovery.ts`'s question, not this
  // one, and a vault's allocation changes without any vault-level signal.
  'underlying-market-quality',
  // Depositing is not the same as being ABLE to deposit a given size: V2 caps
  // are per-id and `maxDeposit` is spec'd to 0 on some vaults, so a size check
  // has to happen against the actual amount at quote time.
  'deposit-capacity-for-a-given-size',
]);

const UNCHECKED_ACCOUNT_ACCESS =
  'per-account-gate-access (no account supplied)';

export type MorphoVaultRegistration = {
  readonly vaultAddress: string;
  /**
   * `true` when a factory claims it, `false` when all queried factories
   * answered and none did, `undefined` when the answer is not established
   * because a read failed.
   */
  readonly registered?: boolean;
  readonly factory?: MorphoVaultFactory;
  /** Factories whose registry read failed, with the reason. */
  readonly unreadable: readonly { factory: string; reason: string }[];
};

/**
 * Ask every known factory whether it deployed this vault.
 *
 * This is the authenticity check the creation logs cannot provide: a
 * `CreateVaultV2` log carries no redundant field to verify itself against, so
 * the factory's own `isMetaMorpho`/`isVaultV2` mapping is the authority. It also
 * works for an address that never came from a log at all — a config file, a UI,
 * a user paste — and it needs no `eth_getLogs`, which matters because the common
 * keyless endpoints refuse that method outright.
 *
 * All three factories are asked because their registries are SEPARATE, verified
 * on-chain: the v1.0 factory answers `true` for Steakhouse USDC `0xBEEF0173…`
 * and the v1.1 factory answers `false` for the same vault. Checking one and
 * concluding "not a Morpho vault" would reject 88 real vaults.
 *
 * Costs one `eth_call` per factory (three today), all issued together.
 */
export async function verifyMorphoVaultFactoryRegistration(params: {
  vaultAddress: string;
  provider: Provider;
  factories?: readonly MorphoVaultFactory[];
}): Promise<MorphoVaultRegistration> {
  const { provider } = params;
  const vaultAddress = getAddress(params.vaultAddress);
  const factories = params.factories ?? MORPHO_VAULT_FACTORIES;

  const results = await Promise.allSettled(
    factories.map(async factory => {
      const contract = new Contract(factory.address, REGISTRY_ABI, provider);
      const claimed = (await contract[factory.registryFunction](
        vaultAddress,
      )) as boolean;
      return { factory, claimed };
    }),
  );

  const unreadable: { factory: string; reason: string }[] = [];
  let match: MorphoVaultFactory | undefined;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      unreadable.push({
        factory: factories[index].address,
        reason: String(result.reason),
      });
      return;
    }
    if (result.value.claimed) {
      match = result.value.factory;
    }
  });

  if (match !== undefined) {
    // A positive answer is conclusive on its own — a factory that says it
    // deployed the vault settles the question even if a sibling read failed.
    return { vaultAddress, registered: true, factory: match, unreadable };
  }
  return {
    vaultAddress,
    // Only "no" when every factory actually answered. Otherwise undefined:
    // an unread factory is not a factory that said no.
    registered: unreadable.length === 0 ? false : undefined,
    unreadable,
  };
}

/**
 * Screen one vault for whether a RAILGUN batch can round-trip through it.
 *
 * Six to nine `eth_call`s: the factory registry (three), `asset()`,
 * `totalAssets()`, the four gate getters, and — only when an `account` is given
 * and the vault has ASSET gates but no share gate — the per-account `can*`
 * helpers.
 *
 * The rules, in the order they matter:
 *
 * 1. **Not factory-registered → blocked.** The address is not a vault this
 *    package knows how to reason about. Everything below assumes it is one.
 * 2. **Any share gate → blocked, regardless of `account`.** Shielding the
 *    shares is `transferFrom(executor -> RAILGUN proxy)` and Vault V2 checks
 *    `canSendShares(from)` AND `canReceiveShares(to)`. The proxy is a fixed
 *    third party, so even an allowlisted executor cannot finish the round trip.
 *    This is the one that costs real privacy: the deposit succeeds, the shield
 *    does not, and the position sits public on the ephemeral account. Measured:
 *    43 of 658 V2 vaults.
 * 3. **`totalAssets()` reverts → blocked as `unquotable`.** Measured: 2 of 658.
 * 4. **`asset()` reverts → blocked as `not-erc4626`.** The contract refused the
 *    interface; that is an answer, not a failure to reach it.
 * 5. **`asset()` disagrees with `expectedAsset` → blocked.** Catches a stale
 *    registry entry or a copy-paste before it becomes a deposit of the wrong
 *    token.
 * 6. **Asset gates with an `account` → ask the vault.** A configured gate can
 *    still be permissive and only the gate knows; asset gates never touch the
 *    share token, so a permissive one is genuinely harmless.
 *
 * A vault holding zero assets is NOT blocked — a first depositor is legitimate —
 * but `totalAssets` is returned so a caller can rank on it. 340 of the 1,108
 * live vaults are empty.
 */
export async function screenMorphoVault(params: {
  vaultAddress: string;
  provider: Provider;
  /**
   * The account that would execute the batch (the ephemeral 7702 executor).
   * Supplying it enables the per-account gate check; omitting it leaves
   * `per-account-gate-access` in {@link MorphoVaultScreening.unchecked}.
   */
  account?: string;
  /** Cross-check the vault's live `asset()` against this. Case-insensitive. */
  expectedAsset?: string;
  /**
   * Skip the registry sweep when the vault came from
   * {@link scanMorphoVaults} and the factory is already known. Saves two
   * `eth_call`s per vault, which matters when screening hundreds.
   */
  factory?: MorphoVaultFactory;
}): Promise<MorphoVaultScreening> {
  const { provider, account, expectedAsset } = params;
  const vaultAddress = getAddress(params.vaultAddress);
  const blockers: MorphoVaultBlocker[] = [];
  const unchecked: string[] = [...BASE_UNCHECKED];

  const vault = new Contract(vaultAddress, VAULT_STATE_ABI, provider);

  // Issued together so a slow call cannot straddle a block boundary and pair
  // fresh gates with a stale asset. The block number rides along rather than
  // being awaited first: an unreachable provider must come back as an
  // `unreadable` blocker, not as a thrown error.
  const [blockResult, registrationResult, assetResult, totalAssetsResult, gatesResult] =
    await Promise.allSettled([
      provider.getBlockNumber(),
      verifyMorphoVaultFactoryRegistration({
        vaultAddress,
        provider,
        factories: params.factory === undefined ? undefined : [params.factory],
      }),
      vault.asset() as Promise<string>,
      vault.totalAssets() as Promise<bigint>,
      MorphoVaultAPI.getVaultGates(vaultAddress, provider),
    ]);

  // -1 is never a real block, so a caller cannot mistake it for a pinned read.
  const checkedAtBlock =
    blockResult.status === 'fulfilled' ? blockResult.value : -1;
  if (blockResult.status === 'rejected') {
    blockers.push({
      code: 'unreadable',
      detail: `could not read the current block: ${String(blockResult.reason)}`,
    });
  }

  let generation: MorphoVaultGeneration | undefined;
  let factoryAddress: string | undefined;
  if (registrationResult.status === 'rejected') {
    blockers.push({
      code: 'unreadable',
      detail: `could not read the factory registries: ${String(
        registrationResult.reason,
      )}`,
    });
  } else {
    const registration = registrationResult.value;
    generation = registration.factory?.generation;
    factoryAddress = registration.factory?.address;
    if (registration.registered === true) {
      // Established.
    } else if (registration.registered === false) {
      blockers.push({
        code: 'not-factory-registered',
        detail:
          `${vaultAddress} is not registered by any known Morpho vault ` +
          `factory (${MORPHO_VAULT_FACTORIES.map(f => f.name).join(', ')}). ` +
          'It may be a vault on another chain, a fork, or not a Morpho vault ' +
          'at all — nothing below can be trusted about it.',
      });
    } else {
      blockers.push({
        code: 'unreadable',
        detail:
          'factory registration is unestablished: ' +
          registration.unreadable
            .map(entry => `${entry.factory} (${entry.reason})`)
            .join('; '),
      });
    }
  }

  let assetAddress: string | undefined;
  if (assetResult.status === 'fulfilled') {
    assetAddress = getAddress(assetResult.value);
    if (
      expectedAsset !== undefined &&
      assetAddress.toLowerCase() !== getAddress(expectedAsset).toLowerCase()
    ) {
      blockers.push({
        code: 'asset-mismatch',
        detail:
          `vault ${vaultAddress} holds ${assetAddress}, not the expected ` +
          `${getAddress(expectedAsset)}.`,
      });
    }
  } else if (isUnanswerableCall(assetResult.reason)) {
    // The contract refused the ERC-4626 surface. That is an answer — the
    // address is not a vault — not a failure to reach it, and a caller that
    // retried would retry forever. Reproduced live against WETH, whose fallback
    // swallows `asset()`.
    blockers.push({
      code: 'not-erc4626',
      detail:
        `${vaultAddress} does not answer asset(), so it is not an ERC-4626 ` +
        'vault. Retrying will not change that.',
    });
  } else {
    blockers.push({
      code: 'unreadable',
      detail: `could not read asset(): ${String(assetResult.reason)}`,
    });
  }

  // `totalAssets()` is the quote canary. A revert here is the vault refusing,
  // not the transport failing, so the two outcomes get different codes.
  let totalAssets: bigint | undefined;
  let quotable: boolean | undefined;
  if (totalAssetsResult.status === 'fulfilled') {
    totalAssets = totalAssetsResult.value;
    quotable = true;
  } else if (isUnanswerableCall(totalAssetsResult.reason)) {
    quotable = false;
    blockers.push({
      code: 'unquotable',
      detail:
        `vault ${vaultAddress} reverts on totalAssets(), so previewDeposit / ` +
        'previewRedeem / previewWithdraw revert with it and no quote can be ' +
        'built. Measured on mainnet: 2 of 658 live Vault V2 vaults do this ' +
        'while still answering asset() and totalSupply().',
    });
  } else {
    blockers.push({
      code: 'unreadable',
      detail: `could not read totalAssets(): ${String(
        totalAssetsResult.reason,
      )}`,
    });
  }

  let gates: MorphoVaultGates | undefined;
  let gateAccess: MorphoVaultGateAccess | undefined;
  if (gatesResult.status === 'fulfilled') {
    gates = gatesResult.value;
    if (gates.shareTransferGated) {
      blockers.push({
        code: 'share-gate',
        detail:
          `vault ${vaultAddress} has a share gate ` +
          `(receiveShares=${gates.receiveSharesGate ?? 'unreadable'}, ` +
          `sendShares=${gates.sendSharesGate ?? 'unreadable'}). Shielding the ` +
          'shares is transferFrom(executor -> RAILGUN proxy) and both endpoints ' +
          'are gate-checked, so the deposit would succeed and the shares would ' +
          'then be unshieldable — the position stays public on the ephemeral ' +
          'account. No executor allowlisting fixes this; the proxy is a fixed ' +
          'third party.',
      });
    }
    // A Vault V2 whose gate getters ALL fail reads as `supportsGates: false`,
    // which is indistinguishable from a V1 that genuinely has no gates — and
    // that lands as `ok: true` with no blocker. The factory registry already
    // says this is a V2, so the two disagree, and the disagreement is the
    // evidence: a V2 answers its gate getters.
    //
    // Not hypothetical. `rpc.mevblocker.io`, one of the endpoints this feature
    // selects, emits spurious CALL_EXCEPTION on repeated identical `eth_call`s
    // (measured: 2/5 on `totalSupply`, 3/5 on `previewMint`), which is exactly
    // the shape `isUnanswerableCall` reads as "the contract refused". Partial
    // flakes already fail closed; this is the all-four case.
    if (generation === 'vault-v2' && !gates.supportsGates) {
      blockers.push({
        code: 'unreadable',
        detail:
          `vault ${vaultAddress} is registered on the Vault V2 factory but ` +
          'answered none of its four gate getters, so whether it is share-gated ' +
          'could not be established. Treating that as ungated would report a ' +
          'share-gated vault as shieldable — the one thing this screen exists ' +
          'to prevent — so it is reported unreadable instead.',
      });
    }
  } else {
    blockers.push({
      code: 'unreadable',
      detail: `could not read the vault gates: ${String(gatesResult.reason)}`,
    });
  }

  // Per-account asset-gate access. Only worth a round trip when there is an
  // asset gate to ask about and no share gate has already condemned the vault.
  const needsAccountCheck =
    gates !== undefined && gates.isGated && !gates.shareTransferGated;
  if (account === undefined) {
    unchecked.push(UNCHECKED_ACCOUNT_ACCESS);
  } else if (needsAccountCheck) {
    try {
      gateAccess = await MorphoVaultAPI.getGateAccess({
        vaultAddress,
        account,
        provider,
        gates,
      });
      if (!gateAccess.canDeposit || !gateAccess.canExit) {
        blockers.push({
          code: 'asset-gate',
          detail:
            `vault ${vaultAddress} denies ${account}: ` +
            `canDeposit=${gateAccess.canDeposit} (canSendAssets=${gateAccess.canSendAssets}), ` +
            `canExit=${gateAccess.canExit} (canReceiveAssets=${gateAccess.canReceiveAssets}).`,
        });
      }
    } catch (cause: unknown) {
      blockers.push({
        code: 'unreadable',
        detail: `could not read per-account gate access: ${String(cause)}`,
      });
    }
  }

  return {
    vaultAddress,
    assetAddress,
    generation,
    factoryAddress,
    gates,
    gateAccess,
    totalAssets,
    quotable,
    ok: blockers.length === 0,
    blockers,
    unchecked,
    checkedAtBlock,
  };
}

/**
 * Three disjoint buckets. A vault with a definite blocker is `blocked` even if
 * some other read also failed — the definite answer wins. `unreadable` holds
 * only the vaults with nothing against them but an incomplete screening, which
 * is the case a caller must not silently treat as either good or bad.
 */
export type MorphoVaultScreeningReport = {
  readonly screenings: readonly MorphoVaultScreening[];
  readonly shieldable: readonly MorphoVaultScreening[];
  readonly blocked: readonly MorphoVaultScreening[];
  readonly unreadable: readonly MorphoVaultScreening[];
  /** No screening hit an `unreadable` blocker. */
  readonly complete: boolean;
};

export const hasUnreadableBlocker = (
  screening: MorphoVaultScreening,
): boolean => screening.blockers.some(blocker => blocker.code === 'unreadable');

/**
 * Screen many vaults, bounded concurrency.
 *
 * Accepts either raw addresses or {@link MorphoDiscoveredVault} entries from a
 * scan; the latter also carry the factory (skipping two registry `eth_call`s
 * each) and the asset the creation log declared, which is then cross-checked
 * against the live `asset()`. That cross-check is the closest thing to
 * self-verification these logs allow, and it held on 1,108 of 1,108 mainnet
 * vaults — a mismatch means the log was mis-decoded or is not what it claims.
 */
export async function screenMorphoVaults(params: {
  vaults: readonly (MorphoDiscoveredVault | string)[];
  provider: Provider;
  account?: string;
  /** Simultaneous vault screenings. Defaults to 8. */
  concurrency?: number;
}): Promise<MorphoVaultScreeningReport> {
  const { provider, account } = params;
  const concurrency = params.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `screenMorphoVaults: concurrency must be a positive integer (got ${concurrency})`,
    );
  }

  const screenings: MorphoVaultScreening[] = [];
  for (let start = 0; start < params.vaults.length; start += concurrency) {
    const slice = params.vaults.slice(start, start + concurrency);
    const batch = await Promise.all(
      slice.map(entry => {
        if (typeof entry === 'string') {
          return screenMorphoVault({ vaultAddress: entry, provider, account });
        }
        return screenMorphoVault({
          vaultAddress: entry.vaultAddress,
          provider,
          account,
          expectedAsset: entry.assetAddress,
          factory: MORPHO_VAULT_FACTORIES.find(
            factory =>
              factory.address.toLowerCase() ===
              entry.factoryAddress.toLowerCase(),
          ),
        });
      }),
    );
    screenings.push(...batch);
  }

  const shieldable = screenings.filter(screening => screening.ok);
  const blocked = screenings.filter(
    screening =>
      !screening.ok &&
      screening.blockers.some(blocker => blocker.code !== 'unreadable'),
  );
  const unreadable = screenings.filter(
    screening =>
      !screening.ok &&
      !screening.blockers.some(blocker => blocker.code !== 'unreadable'),
  );

  return {
    screenings,
    shieldable,
    blocked,
    unreadable,
    // `unreadable.length === 0` is NOT the same predicate and was wrong here: a
    // vault carrying a definite blocker AND a failed read lands in `blocked`,
    // not in `unreadable`, so the count missed it and `complete` came back true
    // with a read still outstanding. Ask every screening directly — which is
    // what `hasUnreadableBlocker` exists for, and what `findMorphoVaults`
    // already does.
    complete: !screenings.some(hasUnreadableBlocker),
  };
}
