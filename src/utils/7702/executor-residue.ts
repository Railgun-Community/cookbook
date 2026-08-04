import { Interface, Provider, getAddress } from 'ethers';
import { NFTTokenType, isDefined } from '@railgun-community/shared-models';
import {
  RecipeInput,
  RecipeOutput,
  StepOutput,
} from '../../models/export-models';
import { nftIdentityKey, normalizeTokenSubID } from '../nft';
import { EphemeralExecutor, resolveExecutorAddress } from './ephemeral-executor';

/**
 * Residual state left on the ephemeral executor after a 7702 batch.
 *
 * ## Why this exists at all
 *
 * A fresh-per-batch executor made leftover approvals and dust *harmless*: the
 * account was abandoned the moment the batch ended, so an unspent allowance
 * authorised a pull from an account that would never hold anything again. That
 * is no longer the model. `EphemeralExecutor` is reused — supply collateral in
 * one batch, borrow against it in another — and reuse inverts the property:
 *
 *  - **An allowance survives into the future.** A router still authorised to
 *    pull `type(uint256).max` from an account that keeps receiving unshielded
 *    value is a standing withdrawal right, not a loose end.
 *  - **Residue is attributable.** Every operation on an address-bound position
 *    is publicly the same address, so leftovers are a growing public record
 *    tied to a live handle rather than to a discarded one.
 *  - **Residue is the signature of a partially-failed batch.** `requireSuccess`
 *    is hardcoded `false` on both 7702 paths in the wallet SDK, so a batch whose
 *    inner call reverts still mines with `status 1`. An unconsumed allowance of
 *    exactly the approved amount, or an input token still sitting at the
 *    executor, is frequently the *only* signal that the work did not happen.
 *
 * ## Why it is a harness assertion and not a runtime step
 *
 * A runtime check would cost gas in every batch a user ever sends, to verify a
 * property of the *recipes* rather than of that user's transaction. Recipes are
 * fixed at build time; a residue defect is the same defect on every execution.
 * So it is asserted once, in the fork harness, over the recipe's own declared
 * output — never encoded into `crossContractCalls`.
 *
 * ## What "clean" means here
 *
 * Four surfaces, each defaulting to *nothing survives*, each overridable only by
 * a policy entry that carries a written `reason`:
 *
 *  | surface | default expectation |
 *  |---|---|
 *  | native balance | `0` |
 *  | ERC-20 balance, for every asset the recipe touched | `0` |
 *  | ERC-20 allowance, for every `(asset, spender)` the batch approves | `0` |
 *  | ERC-721/1155 ownership + operator approval | not held, not approved |
 *
 * The ERC-20 balance surface is deliberately **wider than the recipe's inputs**:
 * a swap buys an asset the recipe never unshielded, a vault deposit mints
 * shares, a borrow delivers the loan asset. Each of those passes through the
 * executor and each must leave it.
 *
 * ## The per-recipe allowance policy
 *
 * See {@link SHIPPED_APPROVAL_RESIDUE_POLICY} for the shipped table: which
 * approval each recipe creates, what survives it, and why. Three classes exist
 * and only the first two are defensible.
 */

// =============================================================================
// Surface — what the batch touched, derived from the recipe's own output.
// =============================================================================

/**
 * `type(uint256).max`. Note that the common ERC-20 implementations treat an
 * allowance of exactly this value as *infinite* and skip the decrement in
 * `transferFrom`, so a max approval does not decay as it is spent: it survives
 * the batch in full, indefinitely, unless something explicitly zeroes it.
 */
export const UNBOUNDED_ALLOWANCE = 2n ** 256n - 1n;

/**
 * Minimal decode surface. Human-readable fragments rather than the bundled
 * `abi.token.*` JSON, because only two selectors are needed and stating them
 * inline documents exactly what is and is not decoded.
 *
 * `approve(address,uint256)` is **selector-ambiguous**: ERC-20's
 * `approve(spender, amount)` and ERC-721's `approve(operator, tokenId)` share
 * `0x095ea7b3`. They are disambiguated by target: a call to an address the
 * recipe declares as an NFT contract is read as the ERC-721 form. Decoding an
 * ERC-721 single-token approval as an allowance would otherwise report a token
 * id as an approved amount.
 */
const APPROVAL_INTERFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
]);

const APPROVE_SELECTOR = APPROVAL_INTERFACE.getFunction('approve')
  ?.selector as string;
const SET_APPROVAL_FOR_ALL_SELECTOR = APPROVAL_INTERFACE.getFunction(
  'setApprovalForAll',
)?.selector as string;

/** One `(asset, spender)` pair the executor may hold an allowance on. */
export type ResidualAllowanceSurfaceEntry = {
  tokenAddress: string;
  spender: string;
  /**
   * Amount of the **last** `approve()` the batch encodes for this pair, if it
   * encodes one at all. Absent when the pair is known only from the step model
   * (`approvedSpender`) — which happens when an allowance is inherited from a
   * previous batch rather than created by this one.
   *
   * Carried so a violation can name the *cause* ("the batch approved max") and
   * not only the symptom ("the allowance is max").
   */
  encodedApproval?: bigint;
  /** Step names whose output carried `approvedSpender` for this pair. */
  declaredBySteps: string[];
};

/** One ERC-721/1155 the executor may still hold. */
export type ResidualNFTSurfaceEntry = {
  nftAddress: string;
  tokenSubID: string;
  nftTokenType: NFTTokenType;
};

/** One `setApprovalForAll(operator, true)` the batch encodes. */
export type ResidualOperatorSurfaceEntry = {
  nftAddress: string;
  operator: string;
};

export type ExecutorResidueSurface = {
  allowances: ResidualAllowanceSurfaceEntry[];
  operatorApprovals: ResidualOperatorSurfaceEntry[];
  /** Every ERC-20 the recipe touched in any channel, checksummed, deduped. */
  tokenAddresses: string[];
  /**
   * The subset of `tokenAddresses` the trailing shield actually sweeps —
   * lowercased.
   *
   * `Recipe.getRecipeOutput` builds `erc20AmountRecipients` from the union of
   * every step's `outputERC20Amounts` plus any unhandled recipe input, and that
   * list is what becomes `shieldERC20Recipients`. A shield request carries
   * `value = 0`, which relay-adapt reads as "sweep `balanceOf(this)`", so any
   * asset on the list comes back whole even if a mid-batch call failed.
   *
   * An asset the recipe names ONLY in `spentERC20Amounts`,
   * `feeERC20AmountRecipients` or `outputPositions` is not on that list. Nothing
   * asks for it to be shielded, so a balance there is **stranded**, not merely
   * unswept — a materially different failure, and worth saying so.
   */
  shieldSweptTokenAddresses: string[];
  nfts: ResidualNFTSurfaceEntry[];
  /**
   * `approve()` calls whose target is an NFT contract, so the second argument
   * is a token id rather than an amount. Kept rather than dropped so a reader
   * can see that decoding was incomplete instead of assuming the allowance
   * surface is exhaustive.
   */
  undecodedApprovals: { to: string; data: string }[];
};

const allowanceKey = (tokenAddress: string, spender: string): string =>
  `${tokenAddress.toLowerCase()}-${spender.toLowerCase()}`;

/**
 * Checksum an address, or throw naming where it came from.
 *
 * Deliberately not a "skip what I cannot parse" helper. Every address here
 * defines a slot in a *safety* surface, so dropping an unparseable one would
 * quietly shrink what gets checked and let the assertion report "clean" over an
 * account it never looked at properly. Failing to parse means the answer is
 * unknown, and unknown is not clean.
 */
const requireAddress = (address: string, context: string): string => {
  try {
    return getAddress(address);
  } catch (cause: unknown) {
    throw new Error(
      `assertExecutorResidue: ${context} is not a usable address ("${address}"), ` +
        `so the residue surface cannot be built. An unparseable address here ` +
        `would silently drop a slot from the check.`,
      { cause },
    );
  }
};

/**
 * Every ERC-20 the recipe names, in any channel.
 *
 * Recipient fields are deliberately NOT read: `RecipeERC20AmountRecipient.
 * recipient` is polymorphic and carries human labels (`'Morpho Blue Market'`,
 * `'RAILGUN Shield Fee'`) on the spent/fee arrays. Only `tokenAddress` fields
 * are addresses in every position.
 */
const collectTokenAddresses = (
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): string[] => {
  const seen = new Map<string, string>();
  const add = (tokenAddress: string) => {
    const checksummed = requireAddress(tokenAddress, 'ERC-20 tokenAddress');
    seen.set(checksummed.toLowerCase(), checksummed);
  };

  recipeInput.erc20Amounts.forEach(erc20Amount => add(erc20Amount.tokenAddress));
  recipeOutput.stepOutputs.forEach((stepOutput: StepOutput) => {
    stepOutput.outputERC20Amounts.forEach(o => add(o.tokenAddress));
    (stepOutput.spentERC20Amounts ?? []).forEach(o => add(o.tokenAddress));
    (stepOutput.feeERC20AmountRecipients ?? []).forEach(o =>
      add(o.tokenAddress),
    );
    (stepOutput.outputPositions ?? []).forEach(p => add(p.tokenAddress));
  });
  recipeOutput.erc20AmountRecipients.forEach(o => add(o.tokenAddress));
  recipeOutput.feeERC20AmountRecipients.forEach(o => add(o.tokenAddress));
  recipeOutput.outputPositions.forEach(p => add(p.tokenAddress));

  return [...seen.values()];
};

/**
 * Every NFT the recipe names, in any channel — step `outputNFTs`/`spentNFTs`,
 * recipe `nftRecipients`, and the bearer half of `outputPositions`.
 *
 * `spentNFTs` is included on purpose even though "spent" here means burned:
 * under `requireSuccess = false` a burn that did not happen leaves the NFT at
 * the executor, and that is precisely the case worth catching.
 */
const collectNFTs = (
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): ResidualNFTSurfaceEntry[] => {
  const seen = new Map<string, ResidualNFTSurfaceEntry>();
  const add = (nft: ResidualNFTSurfaceEntry) => {
    const entry: ResidualNFTSurfaceEntry = {
      nftAddress: requireAddress(nft.nftAddress, 'nftAddress'),
      tokenSubID: nft.tokenSubID,
      nftTokenType: nft.nftTokenType,
    };
    seen.set(nftIdentityKey(entry), entry);
  };

  recipeInput.nfts.forEach(add);
  recipeOutput.stepOutputs.forEach((stepOutput: StepOutput) => {
    stepOutput.outputNFTs.forEach(add);
    (stepOutput.spentNFTs ?? []).forEach(add);
    (stepOutput.outputPositions ?? []).forEach(position => {
      if (position.custody === 'bearer') {
        add({
          nftAddress: position.nftAddress,
          tokenSubID: position.tokenSubID,
          nftTokenType: position.nftTokenType,
        });
      }
    });
  });
  recipeOutput.nftRecipients.forEach(add);
  recipeOutput.outputPositions.forEach(position => {
    if (position.custody === 'bearer') {
      add({
        nftAddress: position.nftAddress,
        tokenSubID: position.tokenSubID,
        nftTokenType: position.nftTokenType,
      });
    }
  });

  return [...seen.values()];
};

/**
 * Everything the executor could plausibly be left holding, derived from the
 * recipe's own output. Pure — no chain access, no provider, no I/O.
 *
 * The allowance surface has two independent sources and takes their union:
 *
 *  1. **Decoded `crossContractCalls`.** Ground truth for what this batch
 *     approves, including an approval no step declared.
 *  2. **The step model's `approvedSpender`.** Catches a pair the batch relies on
 *     but does not itself create — an allowance inherited from an earlier batch,
 *     which under a reused executor is now a real case.
 *
 * A pair present in one and absent from the other is reported through
 * `encodedApproval`/`declaredBySteps` rather than dropped, so the disagreement
 * stays visible.
 */
export const collectExecutorResidueSurface = (
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): ExecutorResidueSurface => {
  const nfts = collectNFTs(recipeInput, recipeOutput);
  const nftAddresses = new Set(nfts.map(nft => nft.nftAddress.toLowerCase()));

  const allowances = new Map<string, ResidualAllowanceSurfaceEntry>();
  const operatorApprovals = new Map<string, ResidualOperatorSurfaceEntry>();
  const undecodedApprovals: { to: string; data: string }[] = [];

  recipeOutput.crossContractCalls.forEach(call => {
    const { to, data } = call;
    if (!isDefined(to) || !isDefined(data) || data.length < 10) {
      return;
    }
    const selector = data.slice(0, 10).toLowerCase();
    if (
      selector !== APPROVE_SELECTOR &&
      selector !== SET_APPROVAL_FOR_ALL_SELECTOR
    ) {
      return;
    }
    const target = requireAddress(to, 'crossContractCall target');

    if (selector === SET_APPROVAL_FOR_ALL_SELECTOR) {
      const decoded = APPROVAL_INTERFACE.decodeFunctionData(
        'setApprovalForAll',
        data,
      );
      if (decoded[1] !== true) {
        return;
      }
      // Addresses out of an ABI decode are already checksummed.
      const operator = String(decoded[0]);
      operatorApprovals.set(allowanceKey(target, operator), {
        nftAddress: target,
        operator,
      });
      return;
    }

    // Selector-ambiguous — see APPROVAL_INTERFACE. An approve() aimed at a
    // contract the recipe declares as an NFT is the ERC-721 form, whose second
    // argument is a token id, not an amount.
    if (nftAddresses.has(target.toLowerCase())) {
      undecodedApprovals.push({ to: target, data });
      return;
    }

    const decoded = APPROVAL_INTERFACE.decodeFunctionData('approve', data);
    const spender = String(decoded[0]);
    const key = allowanceKey(target, spender);
    // Last write wins: `ApproveERC20SpenderStep` emits `approve(0)` then
    // `approve(n)` for assets that require a clear (USDT), and it is the second
    // that determines what survives.
    allowances.set(key, {
      tokenAddress: target,
      spender,
      encodedApproval: decoded[1] as bigint,
      declaredBySteps: allowances.get(key)?.declaredBySteps ?? [],
    });
  });

  recipeOutput.stepOutputs.forEach((stepOutput: StepOutput) => {
    stepOutput.outputERC20Amounts.forEach(erc20Amount => {
      const { approvedSpender } = erc20Amount;
      if (!isDefined(approvedSpender) || approvedSpender === '') {
        return;
      }
      const asset = requireAddress(
        erc20Amount.tokenAddress,
        `${stepOutput.name} output tokenAddress`,
      );
      const spender = requireAddress(
        approvedSpender,
        `${stepOutput.name} approvedSpender`,
      );
      const key = allowanceKey(asset, spender);
      const existing = allowances.get(key);
      const declaredBySteps = existing?.declaredBySteps ?? [];
      if (!declaredBySteps.includes(stepOutput.name)) {
        declaredBySteps.push(stepOutput.name);
      }
      allowances.set(key, {
        tokenAddress: asset,
        spender,
        ...(isDefined(existing?.encodedApproval) && {
          encodedApproval: existing?.encodedApproval,
        }),
        declaredBySteps,
      });
    });
  });

  return {
    allowances: [...allowances.values()],
    operatorApprovals: [...operatorApprovals.values()],
    tokenAddresses: collectTokenAddresses(recipeInput, recipeOutput),
    shieldSweptTokenAddresses: recipeOutput.erc20AmountRecipients.map(
      recipient => recipient.tokenAddress.toLowerCase(),
    ),
    nfts,
    undecodedApprovals,
  };
};

// =============================================================================
// Policy — what is allowed to survive, and why.
// =============================================================================

/**
 * An allowance permitted to survive the batch.
 *
 * `reason` is required and must be non-empty. That is the entire mechanism: the
 * point here is that surviving residue is *stated* rather than discovered, so an
 * exemption without a written justification is itself a violation.
 */
export type AllowedResidualAllowance = {
  tokenAddress: string;
  spender: string;
  /** Inclusive upper bound. `UNBOUNDED_ALLOWANCE` permits a max approval. */
  max: bigint;
  reason: string;
};

export type AllowedResidualBalance = {
  tokenAddress: string;
  /** Inclusive upper bound, in the asset's native units. */
  max: bigint;
  reason: string;
};

export type AllowedResidualNFT = {
  nftAddress: string;
  tokenSubID: string;
  reason: string;
};

export type AllowedResidualOperatorApproval = {
  nftAddress: string;
  operator: string;
  reason: string;
};

export type ExecutorResiduePolicy = {
  allowances?: AllowedResidualAllowance[];
  balances?: AllowedResidualBalance[];
  nfts?: AllowedResidualNFT[];
  operatorApprovals?: AllowedResidualOperatorApproval[];
  /** Native balance permitted to survive. Defaults to `0n`. */
  maxNativeBalance?: bigint;
  /**
   * Permit allowance exemptions that no `(asset, spender)` in the surface
   * matches. Off by default: a stale exemption silently pre-authorises residue
   * on a pair the recipe no longer creates, which is how an exemption written
   * for one refactor survives into the next.
   */
  allowUnusedAllowanceExemptions?: boolean;
};

// =============================================================================
// Reader — the one I/O seam.
// =============================================================================

/**
 * The chain reads this module needs, as a narrow interface rather than a
 * `Provider`.
 *
 * Two reasons. The assertion becomes unit-testable with an in-memory fake, so
 * its logic is verified without a fork node — which matters because a fork run
 * here is slow, serialised, and corrupts the fork if killed. And the caller
 * chooses how the reads are made (batched, multicalled, cached) without this
 * module growing a provider dependency it would then have to keep working
 * across ethers versions.
 */
export type ResidueChainReader = {
  getNativeBalance(address: string): Promise<bigint>;
  getERC20Allowance(
    tokenAddress: string,
    owner: string,
    spender: string,
  ): Promise<bigint>;
  getERC20Balance(tokenAddress: string, owner: string): Promise<bigint>;
  /** `undefined` when `ownerOf` reverts — the id is burned or never minted. */
  getERC721Owner(
    nftAddress: string,
    tokenSubID: string,
  ): Promise<Optional<string>>;
  getERC1155Balance(
    nftAddress: string,
    owner: string,
    tokenSubID: string,
  ): Promise<bigint>;
  isApprovedForAll(
    nftAddress: string,
    owner: string,
    operator: string,
  ): Promise<boolean>;
};

const READER_INTERFACE = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]);

/**
 * ethers error codes that mean "the contract answered no" rather than "the read
 * did not happen": a revert, or a response this ABI cannot decode (an address
 * with no code returns empty data).
 *
 * Only these may be interpreted. Anything else — a dropped connection, a rate
 * limit, a timeout — leaves the answer *unknown*, and an unknown must not be
 * read as clean, so it propagates.
 */
const CALL_FAILED_CODES: ReadonlySet<string> = new Set([
  'CALL_EXCEPTION',
  'BAD_DATA',
]);

const isCallFailure = (err: unknown): boolean =>
  typeof (err as { code?: unknown })?.code === 'string' &&
  CALL_FAILED_CODES.has((err as { code: string }).code);

/** {@link ResidueChainReader} backed by an ethers `Provider`. */
export const ethersResidueChainReader = (
  provider: Provider,
): ResidueChainReader => {
  const read = async (
    to: string,
    fragment: string,
    args: unknown[],
  ): Promise<unknown[]> => {
    const data = READER_INTERFACE.encodeFunctionData(fragment, args);
    try {
      const result = await provider.call({ to, data });
      return [...READER_INTERFACE.decodeFunctionResult(fragment, result)];
    } catch (cause: unknown) {
      // Name the read. Without this, a residue check over a dozen contracts
      // fails with one undifferentiated ethers error.
      throw new Error(
        `assertExecutorResidue: ${fragment} on ${to} failed, so the executor's ` +
          `residual state for it is unknown — which is not the same as clean.`,
        { cause },
      );
    }
  };

  return {
    getNativeBalance: (address: string) => provider.getBalance(address),
    getERC20Allowance: async (tokenAddress, owner, spender) => {
      const [allowance] = await read(
        tokenAddress,
        'allowance(address,address)',
        [owner, spender],
      );
      return allowance as bigint;
    },
    getERC20Balance: async (tokenAddress, owner) => {
      const [balance] = await read(tokenAddress, 'balanceOf(address)', [owner]);
      return balance as bigint;
    },
    getERC721Owner: async (nftAddress, tokenSubID) => {
      try {
        const [owner] = await read(nftAddress, 'ownerOf(uint256)', [
          BigInt(tokenSubID),
        ]);
        return String(owner);
      } catch (err: unknown) {
        // A burned or never-minted id reverts. That is the success case for a
        // full close, so it is not an error here — the caller sees "not held".
        // A transport failure is NOT that, and must not be laundered into a
        // pass: it means the answer is unknown.
        if (isCallFailure((err as { cause?: unknown })?.cause ?? err)) {
          return undefined;
        }
        throw err;
      }
    },
    getERC1155Balance: async (nftAddress, owner, tokenSubID) => {
      const [balance] = await read(nftAddress, 'balanceOf(address,uint256)', [
        owner,
        BigInt(tokenSubID),
      ]);
      return balance as bigint;
    },
    isApprovedForAll: async (nftAddress, owner, operator) => {
      const [approved] = await read(
        nftAddress,
        'isApprovedForAll(address,address)',
        [owner, operator],
      );
      return approved === true;
    },
  };
};

// =============================================================================
// Observation + violations.
// =============================================================================

export type ObservedResidualAllowance = ResidualAllowanceSurfaceEntry & {
  allowance: bigint;
};
export type ObservedResidualBalance = {
  tokenAddress: string;
  balance: bigint;
  /** See `ExecutorResidueSurface.shieldSweptTokenAddresses`. */
  sweptByShield: boolean;
};
export type ObservedResidualNFT = ResidualNFTSurfaceEntry & {
  heldAmount: bigint;
};
export type ObservedResidualOperatorApproval = ResidualOperatorSurfaceEntry & {
  approved: boolean;
};

export type ObservedExecutorResidue = {
  executor: string;
  nativeBalance: bigint;
  allowances: ObservedResidualAllowance[];
  balances: ObservedResidualBalance[];
  nfts: ObservedResidualNFT[];
  operatorApprovals: ObservedResidualOperatorApproval[];
};

/** Read the executor's post-batch state for everything in `surface`. */
export const readExecutorResidue = async (
  reader: ResidueChainReader,
  executor: string,
  surface: ExecutorResidueSurface,
): Promise<ObservedExecutorResidue> => {
  const [nativeBalance, allowances, balances, nfts, operatorApprovals] =
    await Promise.all([
      reader.getNativeBalance(executor),
      Promise.all(
        surface.allowances.map(async entry => ({
          ...entry,
          allowance: await reader.getERC20Allowance(
            entry.tokenAddress,
            executor,
            entry.spender,
          ),
        })),
      ),
      Promise.all(
        surface.tokenAddresses.map(async tokenAddress => ({
          tokenAddress,
          balance: await reader.getERC20Balance(tokenAddress, executor),
          sweptByShield: surface.shieldSweptTokenAddresses.includes(
            tokenAddress.toLowerCase(),
          ),
        })),
      ),
      Promise.all(
        surface.nfts.map(async entry => {
          if (entry.nftTokenType === NFTTokenType.ERC1155) {
            return {
              ...entry,
              heldAmount: await reader.getERC1155Balance(
                entry.nftAddress,
                executor,
                entry.tokenSubID,
              ),
            };
          }
          const owner = await reader.getERC721Owner(
            entry.nftAddress,
            entry.tokenSubID,
          );
          const held =
            isDefined(owner) && owner.toLowerCase() === executor.toLowerCase();
          return { ...entry, heldAmount: held ? 1n : 0n };
        }),
      ),
      Promise.all(
        surface.operatorApprovals.map(async entry => ({
          ...entry,
          approved: await reader.isApprovedForAll(
            entry.nftAddress,
            executor,
            entry.operator,
          ),
        })),
      ),
    ]);

  return {
    executor,
    nativeBalance,
    allowances,
    balances,
    nfts,
    operatorApprovals,
  };
};

export type ExecutorResidueViolationKind =
  | 'native-balance'
  | 'token-balance'
  | 'allowance'
  | 'nft-held'
  | 'operator-approval'
  | 'exemption-without-reason'
  | 'unused-allowance-exemption';

export type ExecutorResidueViolation = {
  kind: ExecutorResidueViolationKind;
  message: string;
};

export type ExecutorResidueReport = {
  executor: string;
  surface: ExecutorResidueSurface;
  observed: ObservedExecutorResidue;
  violations: ExecutorResidueViolation[];
};

const describeAllowance = (value: bigint): string =>
  value === UNBOUNDED_ALLOWANCE ? 'type(uint256).max (unbounded)' : `${value}`;

/**
 * Compare observed residue against policy. Pure, and returns **every**
 * violation rather than stopping at the first.
 *
 * That is deliberate. A batch that failed inside `requireSuccess = false` trips
 * several of these at once — the allowance is untouched, the input asset is
 * still there, the NFT was never burned — and the shape of the whole set is what
 * identifies the failure. First-fail reporting would show one symptom and hide
 * the diagnosis.
 */
export const findExecutorResidueViolations = (
  observed: ObservedExecutorResidue,
  policy: ExecutorResiduePolicy = {},
): ExecutorResidueViolation[] => {
  const violations: ExecutorResidueViolation[] = [];

  const allowanceExemptions = policy.allowances ?? [];
  const balanceExemptions = policy.balances ?? [];
  const nftExemptions = policy.nfts ?? [];
  const operatorExemptions = policy.operatorApprovals ?? [];

  const requireReason = (label: string, reason: string) => {
    if (reason.trim() === '') {
      violations.push({
        kind: 'exemption-without-reason',
        message:
          `${label}: residue exemption has no reason. An exemption states why ` +
          `residue is expected; one without a justification is an undocumented ` +
          `deviation, which is the condition this assertion exists to prevent.`,
      });
    }
  };
  allowanceExemptions.forEach(e =>
    requireReason(`allowance ${e.tokenAddress} -> ${e.spender}`, e.reason),
  );
  balanceExemptions.forEach(e =>
    requireReason(`balance ${e.tokenAddress}`, e.reason),
  );
  nftExemptions.forEach(e =>
    requireReason(`nft ${e.nftAddress} #${e.tokenSubID}`, e.reason),
  );
  operatorExemptions.forEach(e =>
    requireReason(`operator ${e.nftAddress} -> ${e.operator}`, e.reason),
  );

  const maxNativeBalance = policy.maxNativeBalance ?? 0n;
  if (observed.nativeBalance > maxNativeBalance) {
    violations.push({
      kind: 'native-balance',
      message:
        `executor ${observed.executor} holds ${observed.nativeBalance} wei ` +
        `(permitted ${maxNativeBalance}). The executor is a pass-through: ` +
        `native value left on it was not accounted for by the recipe.`,
    });
  }

  observed.balances.forEach(({ tokenAddress, balance, sweptByShield }) => {
    const exemption = balanceExemptions.find(
      e => e.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
    const max = exemption?.max ?? 0n;
    if (balance > max) {
      violations.push({
        kind: 'token-balance',
        message:
          `executor ${observed.executor} holds ${balance} of ${tokenAddress} ` +
          `(permitted ${max}${
            isDefined(exemption) ? ` — ${exemption.reason}` : ''
          }). ` +
          (sweptByShield
            ? `The shield epilogue requests this asset, so it should have been ` +
              `swept: the sweep ran short, or the call that should have consumed ` +
              `the balance did not run — requireSuccess = false lets that mine ` +
              `with status 1.`
            : `STRANDED: this asset is not in erc20AmountRecipients, so the ` +
              `shield epilogue never requests it and nothing sweeps it back. ` +
              `It stays on the executor indefinitely.`),
      });
    }
  });

  const matchedExemptions = new Set<AllowedResidualAllowance>();
  observed.allowances.forEach(entry => {
    const exemption = allowanceExemptions.find(
      e =>
        e.tokenAddress.toLowerCase() === entry.tokenAddress.toLowerCase() &&
        e.spender.toLowerCase() === entry.spender.toLowerCase(),
    );
    if (isDefined(exemption)) {
      matchedExemptions.add(exemption);
    }
    const max = exemption?.max ?? 0n;
    if (entry.allowance > max) {
      const cause = isDefined(entry.encodedApproval)
        ? ` The batch approved ${describeAllowance(entry.encodedApproval)}.`
        : ` The batch encodes no approve() for this pair — it was inherited from an earlier batch.`;
      violations.push({
        kind: 'allowance',
        message:
          `executor ${observed.executor} still allows ${entry.spender} to pull ` +
          `${describeAllowance(entry.allowance)} of ${entry.tokenAddress} ` +
          `(permitted ${describeAllowance(max)}${
            isDefined(exemption) ? ` — ${exemption.reason}` : ''
          }).${cause} A reused executor keeps receiving unshielded value, so a ` +
          `surviving allowance is a standing withdrawal right over all of it.`,
      });
    }
  });

  if (policy.allowUnusedAllowanceExemptions !== true) {
    allowanceExemptions.forEach(exemption => {
      if (matchedExemptions.has(exemption)) {
        return;
      }
      violations.push({
        kind: 'unused-allowance-exemption',
        message:
          `policy exempts ${exemption.tokenAddress} -> ${exemption.spender} ` +
          `("${exemption.reason}") but this recipe creates no such allowance. ` +
          `A stale exemption pre-authorises residue on a pair nothing checks; ` +
          `remove it, or set allowUnusedAllowanceExemptions.`,
      });
    });
  }

  observed.nfts.forEach(entry => {
    if (entry.heldAmount <= 0n) {
      return;
    }
    const exemption = nftExemptions.find(
      e =>
        e.nftAddress.toLowerCase() === entry.nftAddress.toLowerCase() &&
        normalizeTokenSubID(e.tokenSubID) ===
          normalizeTokenSubID(entry.tokenSubID),
    );
    if (isDefined(exemption)) {
      return;
    }
    violations.push({
      kind: 'nft-held',
      message:
        `executor ${observed.executor} still holds ${entry.heldAmount} of NFT ` +
        `${entry.nftAddress} #${entry.tokenSubID}. A bearer position left on ` +
        `the executor is neither shielded nor burned — the batch's NFT leg did ` +
        `not complete.`,
    });
  });

  observed.operatorApprovals.forEach(entry => {
    if (!entry.approved) {
      return;
    }
    const exemption = operatorExemptions.find(
      e =>
        e.nftAddress.toLowerCase() === entry.nftAddress.toLowerCase() &&
        e.operator.toLowerCase() === entry.operator.toLowerCase(),
    );
    if (isDefined(exemption)) {
      return;
    }
    violations.push({
      kind: 'operator-approval',
      message:
        `executor ${observed.executor} still approves ${entry.operator} as ` +
        `operator for all of ${entry.nftAddress}. setApprovalForAll is ` +
        `unbounded in both amount and time, and covers NFTs the executor does ` +
        `not yet hold.`,
    });
  });

  return violations;
};

export class ExecutorResidueError extends Error {
  readonly report: ExecutorResidueReport;

  constructor(name: string, report: ExecutorResidueReport) {
    super(
      `${name}: ephemeral executor ${report.executor} did not end the batch clean ` +
        `(${report.violations.length} violation${
          report.violations.length === 1 ? '' : 's'
        }):\n` +
        report.violations
          .map(violation => `  - [${violation.kind}] ${violation.message}`)
          .join('\n'),
    );
    this.name = 'ExecutorResidueError';
    this.report = report;
  }
}

/**
 * Assert the ephemeral executor is left clean after a batch.
 *
 * Intended for the 7702 fork harness — see
 * `executeRecipe7702AndAssertUnshieldBalances` — and for any downstream
 * integrator that wants the same property in its own tests. It performs read
 * calls only and encodes nothing into the batch.
 *
 * Throws {@link ExecutorResidueError} listing every violation; returns the full
 * report (including a clean one) so a caller can log what was checked.
 */
export const assertExecutorResidue = async (opts: {
  /** Label for the failure message — usually the recipe name. */
  name: string;
  executor: EphemeralExecutor | string;
  recipeInput: RecipeInput;
  recipeOutput: RecipeOutput;
  reader: ResidueChainReader;
  policy?: ExecutorResiduePolicy;
}): Promise<ExecutorResidueReport> => {
  const { name, recipeInput, recipeOutput, reader, policy } = opts;
  const executor = resolveExecutorAddress(
    opts.executor,
    'assertExecutorResidue',
  );

  const surface = collectExecutorResidueSurface(recipeInput, recipeOutput);
  const observed = await readExecutorResidue(reader, executor, surface);
  const violations = findExecutorResidueViolations(observed, policy);

  const report: ExecutorResidueReport = {
    executor,
    surface,
    observed,
    violations,
  };
  if (violations.length > 0) {
    throw new ExecutorResidueError(name, report);
  }
  return report;
};

// =============================================================================
// The shipped per-recipe allowance policy.
// =============================================================================

/**
 * What survives a shipped recipe's approval, and why.
 *
 * - `none` — the spender pulls exactly the approved amount, so the allowance
 *   reaches zero on success. A surviving allowance means the pull did not
 *   happen.
 * - `bounded` — the approval is deliberately an upper bound because the exact
 *   pull is not knowable at build time; the surplus survives, bounded by a
 *   figure the quote states.
 * - `unbounded` — the recipe calls `ApproveERC20SpenderStep` with **no amount**,
 *   which approves `type(uint256).max`. This is a defect under a reused
 *   executor, not a design decision: the allowance never decays, and the
 *   executor keeps receiving unshielded value the spender may then pull.
 *   Recorded here rather than silently exempted.
 */
export type ApprovalResidueClass = 'none' | 'bounded' | 'unbounded';

export type ShippedApprovalResiduePolicy = {
  /** Path under `src/`, used by the drift test to prove the table is complete. */
  recipeFile: string;
  /** Number of `new ApproveERC20SpenderStep(...)` call sites in that file. */
  approvalCallSites: number;
  /** What is approved, by role — never a literal address. */
  approvedAssetRole: string;
  /** Who may pull it, by role. */
  spenderRole: string;
  /** Third constructor argument, or `undefined` for a max approval. */
  approvedAmountExpression: string;
  residue: ApprovalResidueClass;
  reason: string;
};

/**
 * Every ERC-20 approval a shipped recipe creates, classified.
 *
 * Guarded against drift by `__tests__/executor-residue-policy.test.ts`, which
 * scans `src/recipes/**` for `new ApproveERC20SpenderStep(` and fails if any
 * file or call site is missing from this table. A new approving recipe
 * therefore cannot land without stating what it leaves behind.
 *
 * Note the split: of sixteen approval call sites, seven approve an exact
 * amount, one approves a stated upper bound, and **eight approve
 * `type(uint256).max`**. So "the cookbook approves exact amounts" holds for the
 * Morpho family and the two f(x) repay paths, and fails for f(x) collateral
 * supply, 0x, Beefy and Uniswap v2 — half the surface.
 */
export const SHIPPED_APPROVAL_RESIDUE_POLICY: readonly ShippedApprovalResiduePolicy[] =
  [
    {
      recipeFile: 'recipes/morpho/blue-supply-collateral-and-borrow-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'market collateral asset',
      spenderRole: 'Morpho Blue singleton',
      approvedAmountExpression: 'supplyQuote.collateralAssets',
      residue: 'none',
      reason:
        'supplyCollateral pulls exactly collateralAssets, so the allowance reaches zero on success. The borrow leg needs no allowance.',
    },
    {
      recipeFile: 'recipes/morpho/blue-repay-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'market loan asset',
      spenderRole: 'Morpho Blue singleton',
      approvedAmountExpression: 'repayQuote.repayAssets',
      residue: 'none',
      reason:
        'assets-mode repay(assets, 0) pulls exactly repayAssets, so the allowance reaches zero on success.',
    },
    {
      recipeFile: 'recipes/morpho/blue-repay-and-withdraw-collateral-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'market loan asset',
      spenderRole: 'Morpho Blue singleton',
      approvedAmountExpression: 'repayQuote.repayAssets',
      residue: 'none',
      reason:
        'assets-mode repay(assets, 0) pulls exactly repayAssets; the withdraw-collateral leg needs no allowance.',
    },
    {
      recipeFile: 'recipes/morpho/blue-close-position-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'market loan asset',
      spenderRole: 'Morpho Blue singleton',
      approvedAmountExpression: 'repayQuote.maxRepaidAssets',
      residue: 'bounded',
      reason:
        'shares-mode repay(0, shares) pulls whatever the shares are worth at inclusion, which is not knowable at ' +
        'build time, so the approval carries a slippage buffer. Interest only accrues, so the pull is at least ' +
        'expectedRepaidAssets and the surviving allowance is at most maxRepaidAssets - expectedRepaidAssets, ' +
        'i.e. expectedRepaidAssets * slippageBasisPoints / 10000.',
    },
    {
      recipeFile: 'recipes/morpho/morpho-transact-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'each declared bundle pull asset',
      spenderRole: 'each declared bundle pull spender',
      approvedAmountExpression: 'pull.amount',
      residue: 'none',
      reason:
        'One approval per declared pull, each for that pull exact amount. The single call site sits inside a map ' +
        'over the bundle, so the number of approvals is data-dependent while the policy is not.',
    },
    {
      recipeFile: 'recipes/vault/morpho/metamorpho-deposit-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'vault underlying asset',
      spenderRole: 'MetaMorpho vault (ERC-4626)',
      approvedAmountExpression: 'quote.depositAssets',
      residue: 'none',
      reason:
        'ERC-4626 deposit(assets, receiver) pulls exactly assets, so the allowance reaches zero on success.',
    },
    {
      recipeFile: 'recipes/borrow/fx/fx-mint-close-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pool debt asset',
      spenderRole: 'f(x) PoolManager',
      approvedAmountExpression: 'opts.approveAmount',
      residue: 'none',
      reason:
        'PoolManager.operate() pulls the full approveAmount — repayAmount plus the repay fee — and the step reads ' +
        'that same figure back off the approved input in order to book the fee. A wei-level survivor would mean ' +
        'the recipe and the contract disagree on fee rounding, which is worth failing on rather than pre-exempting.',
    },
    {
      recipeFile: 'recipes/borrow/fx/fx-mint-repay-debt-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pool debt asset',
      spenderRole: 'f(x) PoolManager',
      approvedAmountExpression:
        'opts.approveAmount, constructor-checked to equal repayAmount * (FEE_DENOM + repayFeeRatio) / FEE_DENOM',
      residue: 'none',
      reason:
        'Same pull as the close path, and the recipe constructor rejects any approveAmount that is not exactly the ' +
        'fee-inclusive figure.',
    },
    {
      recipeFile: 'recipes/borrow/fx/fx-mint-open-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pool collateral asset',
      spenderRole: 'f(x) PoolManager',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT. No amount is passed, so the executor grants PoolManager an infinite allowance on the collateral ' +
        'asset that nothing later revokes. The supplied amount is known at build time (collInput.expectedBalance), ' +
        'so an exact approval is available.',
    },
    {
      recipeFile: 'recipes/borrow/fx/fx-mint-topup-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pool collateral asset',
      spenderRole: 'f(x) PoolManager',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT, same shape as fx-mint-open-recipe. The top-up amount is collInput.expectedBalance and is known at ' +
        'build time.',
    },
    {
      recipeFile: 'recipes/borrow/fx/fx-mint-topup-and-borrow-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pool collateral asset',
      spenderRole: 'f(x) PoolManager',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT, same shape as fx-mint-open-recipe. The borrow leg needs no allowance; only the collateral supply ' +
        'does, and its amount is known.',
    },
    {
      recipeFile: 'recipes/swap/zero-x-v2-swap-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'sell asset',
      spenderRole: 'quote.spender — the 0x v2 allowance target',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT. sellERC20Amount is passed as the tokenInfo argument, not as the amount, so the third parameter is ' +
        'undefined and the approval is max. The sell amount is exact and already in hand. This is the widest of ' +
        'the seven: the spender is a third-party aggregator contract and every combo in the repo routes through it.',
    },
    {
      recipeFile: 'recipes/vault/beefy/beefy-deposit-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'vault deposit asset',
      spenderRole: 'Beefy vault',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT. depositERC20Info is the tokenInfo argument and no amount is supplied, so the vault keeps an ' +
        'infinite allowance.',
    },
    {
      recipeFile:
        'recipes/liquidity/uni-v2-like/uni-v2-like-add-liquidity-recipe.ts',
      approvalCallSites: 2,
      approvedAssetRole: 'both pair assets',
      spenderRole: 'Uniswap-v2-like router',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT, twice. addLiquidity pulls at most the two desired amounts, both known at build time, so the ' +
        'correct approval is the desired amount and the unpulled remainder simply stays unapproved.',
    },
    {
      recipeFile:
        'recipes/liquidity/uni-v2-like/uni-v2-like-remove-liquidity-recipe.ts',
      approvalCallSites: 1,
      approvedAssetRole: 'pair LP asset',
      spenderRole: 'Uniswap-v2-like router',
      approvedAmountExpression: 'undefined -> type(uint256).max',
      residue: 'unbounded',
      reason:
        'DEFECT. removeLiquidity burns exactly lpERC20Amount.amount, which is known at build time.',
    },
  ];
