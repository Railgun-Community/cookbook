import { NetworkName } from '@railgun-community/shared-models';
import { Provider, ZeroAddress } from 'ethers';
import {
  MetaMorphoVaultContract,
  MorphoVaultV2GateName,
} from '../../../contract/vault/morpho/metamorpho-vault-contract';
import { ERC20Contract } from '../../../contract/token/erc20-contract';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../../utils/7702';
import { minBalanceAfterSlippage } from '../../../utils/number';

const assertValidSlippage = (slippageBasisPoints: bigint): void => {
  if (slippageBasisPoints < 0n || slippageBasisPoints > 10000n) {
    throw new Error(
      `morpho: slippageBasisPoints out of range: ${slippageBasisPoints}`,
    );
  }
};

/**
 * True only for the two ethers v6 failure modes that mean "this contract does
 * not answer that function": an empty revert (`CALL_EXCEPTION`) and an
 * undecodable/empty return (`BAD_DATA`, e.g. the address holds no code).
 *
 * Everything else — `NETWORK_ERROR`, `SERVER_ERROR`, `TIMEOUT`, a rate limit —
 * is rethrown. Swallowing those would let a flaky RPC silently downgrade a
 * gated vault to "ungated", which is the exact failure this check exists to
 * prevent.
 */
const isUnanswerableCall = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'CALL_EXCEPTION' || code === 'BAD_DATA';
};

const GATE_NAMES: readonly MorphoVaultV2GateName[] = [
  'receiveSharesGate',
  'sendSharesGate',
  'receiveAssetsGate',
  'sendAssetsGate',
] as const;

/**
 * Which half of the vault an access question is about. Mirrors the contract:
 * `deposit()`/`mint()` both funnel into `enter()`, `withdraw()`/`redeem()` both
 * funnel into `exit()`, and each internal function carries its own pair of gate
 * checks. There is no separate "withdraw" case — it is `exit`.
 */
export type MorphoVaultGateOperation = 'deposit' | 'exit';

/**
 * Gate configuration read off a Morpho vault.
 *
 * A gate address of `undefined` means the getter did not answer. Combined with
 * `supportsGates` that is unambiguous: if `supportsGates` is false the vault is
 * not a Vault V2 and has no gate mechanism; if it is true but an individual
 * getter still failed, the vault is a V2 whose state could not be read, and the
 * derived booleans treat that gate as SET (fail closed).
 */
export type MorphoVaultGates = {
  vaultAddress: string;
  /**
   * The vault answers the Vault V2 gate getters. False for a V1 MetaMorpho
   * vault, which has no gating mechanism at all — this doubles as the runtime
   * generation discriminator the `MorphoVaultVersion` label never provided.
   */
  supportsGates: boolean;
  receiveSharesGate?: string;
  sendSharesGate?: string;
  receiveAssetsGate?: string;
  sendAssetsGate?: string;
  /** Any gate is configured. This is the headline "is this vault gated" answer. */
  isGated: boolean;
  /** `enter()` is gated: `receiveSharesGate` (onBehalf) or `sendAssetsGate` (msg.sender). */
  depositGated: boolean;
  /** `exit()` is gated: `sendSharesGate` (onBehalf) or `receiveAssetsGate` (receiver). */
  exitGated: boolean;
  /**
   * Plain ERC-20 movement of the SHARE token is gated (`sendSharesGate` or
   * `receiveSharesGate`). Load-bearing for RAILGUN specifically: shielding
   * vault shares is a `transferFrom` from the ephemeral executor to the RAILGUN
   * contract, and BOTH endpoints are gate-checked.
   */
  shareTransferGated: boolean;
};

/** Per-account answers from the vault's own `can*` view helpers. */
export type MorphoVaultGateAccess = {
  vaultAddress: string;
  account: string;
  gates: MorphoVaultGates;
  canReceiveShares: boolean;
  canSendShares: boolean;
  canReceiveAssets: boolean;
  canSendAssets: boolean;
  /** `enter()` would pass for this account: `canReceiveShares && canSendAssets`. */
  canDeposit: boolean;
  /** `exit()` would pass for this account: `canSendShares && canReceiveAssets`. */
  canExit: boolean;
};

/**
 * Thrown at build time when a Morpho vault's gates would reject the batch.
 *
 * This exists because the on-chain failure is SILENT: relay-adapt runs the
 * cross-contract calls with `requireSuccess = false`, so a reverting
 * `deposit`/`redeem` still mines with `status 1`, having done nothing, and the
 * unshielded value strands on the single-use ephemeral account. Refusing to
 * build is the only point at which this is diagnosable.
 */
export class MorphoVaultGatedError extends Error {
  override readonly name: string = 'MorphoVaultGatedError';

  readonly gates: MorphoVaultGates;

  readonly account: string;

  readonly operation: MorphoVaultGateOperation;

  constructor(params: {
    gates: MorphoVaultGates;
    account: string;
    operation: MorphoVaultGateOperation;
    reason: string;
  }) {
    const { gates, account, operation, reason } = params;
    super(
      `morpho: vault ${gates.vaultAddress} is gated and would reject this ` +
        `${operation} for ${account} — ${reason}. The batch would mine having ` +
        `done nothing (relay-adapt does not require success) and the value ` +
        `would strand. Gates: receiveShares=${gates.receiveSharesGate ?? 'unreadable'}, ` +
        `sendShares=${gates.sendSharesGate ?? 'unreadable'}, ` +
        `receiveAssets=${gates.receiveAssetsGate ?? 'unreadable'}, ` +
        `sendAssets=${gates.sendAssetsGate ?? 'unreadable'}.`,
    );
    this.gates = gates;
    this.account = account;
    this.operation = operation;
    Object.setPrototypeOf(this, MorphoVaultGatedError.prototype);
  }
}

/**
 * Static metadata for a MetaMorpho ERC-4626 vault, read on-chain.
 */
export type MetaMorphoVaultData = {
  vaultAddress: string;
  assetAddress: string;
  assetDecimals: bigint;
  shareDecimals: bigint;
};

/**
 * A deposit quote: everything a {@link MetaMorphoDepositStep} needs, resolved
 * on-chain. `receiver` is the validated ephemeral EOA (EIP-7702), never
 * relay-adapt. Share output is non-deterministic across blocks, so the step
 * declares `[minShares, expectedShares]`.
 */
export type MetaMorphoDepositQuote = MetaMorphoVaultData & {
  depositAssets: bigint;
  expectedShares: bigint;
  minShares: bigint;
  slippageBasisPoints: bigint;
  receiver: string;
};

/**
 * A redeem quote (shares-denominated: `redeem(shares)`) for the redeem step.
 * `receiver` and `owner` are both the ephemeral EOA: it holds the shares
 * (owner == msg.sender, so no allowance is needed) and receives the assets.
 * Asset output is non-deterministic → `[minAssets, expectedAssets]`.
 */
export type MetaMorphoRedeemQuote = MetaMorphoVaultData & {
  redeemShares: bigint;
  expectedAssets: bigint;
  minAssets: bigint;
  slippageBasisPoints: bigint;
  receiver: string;
  owner: string;
};

/**
 * A withdraw quote (assets-denominated: `withdraw(assets)`). The ASSET output
 * is deterministic (exactly `withdrawAssets`); the SHARES burned drift with the
 * exchange rate, so `maxShares` is a conservative upper bound on consumption —
 * the caller must unshield at least `maxShares` shares. Leftover shares reshield.
 */
export type MetaMorphoWithdrawQuote = MetaMorphoVaultData & {
  withdrawAssets: bigint;
  expectedShares: bigint;
  maxShares: bigint;
  slippageBasisPoints: bigint;
  receiver: string;
  owner: string;
};

/**
 * Self-contained data layer for MetaMorpho vault recipes — mirrors the 0x-V2
 * `ZeroXV2Quote` shape (recipe calls it internally; callers never pre-fetch
 * rates), but reads ERC-4626 previews on-chain via a provider so quotes are
 * correct against whatever chain/fork the recipe runs on.
 */
export class MorphoVaultAPI {
  static supportsNetwork(networkName: NetworkName): boolean {
    // MetaMorpho + Morpho Blue addresses wired here are Ethereum mainnet.
    return networkName === NetworkName.Ethereum;
  }

  static async getVaultData(
    vaultAddress: string,
    provider: Provider,
  ): Promise<MetaMorphoVaultData> {
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const [assetAddress, shareDecimals] = await Promise.all([
      vault.asset(),
      vault.decimals(),
    ]);
    const assetDecimals = await new ERC20Contract(
      assetAddress,
      provider,
    ).decimals();
    return {
      vaultAddress,
      assetAddress,
      assetDecimals,
      shareDecimals,
    };
  }

  /**
   * Read the vault's gate configuration. One round trip (four parallel
   * `eth_call`s).
   *
   * Morpho Vaults V2 let a curator attach gate contracts that allowlist who may
   * enter, exit, or hold shares. A 7702 ephemeral executor is a freshly derived
   * account that has never been allowlisted anywhere, so a gated vault does not
   * inconvenience it — it rejects it, permanently, and silently.
   *
   * V1 MetaMorpho vaults have no gate mechanism: all four getters revert, which
   * this reports as `supportsGates: false, isGated: false`. Verified on-chain
   * (Ethereum, block 25_682_207): Steakhouse USDC `0xBEEF0173…` reverts on all
   * four and answers `MORPHO()`; Steakhouse Prime USDC `0xbeef0880…` answers
   * all four with `address(0)` and reverts on `MORPHO()`. Neither shipped vault
   * is gated today.
   *
   * Reads ALL FOUR gates deliberately. A two-read check of `receiveAssetsGate`
   * / `sendAssetsGate` covers only `exit()`'s receiver and `enter()`'s
   * msg.sender; it is blind to `receiveSharesGate` and `sendSharesGate`, which
   * gate minting, burning, AND every ERC-20 movement of the share token. Those
   * are the two that strand shares, because shielding them is a transfer.
   */
  static async getVaultGates(
    vaultAddress: string,
    provider: Provider,
  ): Promise<MorphoVaultGates> {
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const results = await Promise.all(
      GATE_NAMES.map(name =>
        vault.gateAddress(name).then(
          (address): string | undefined => address,
          (err: unknown): string | undefined => {
            if (isUnanswerableCall(err)) {
              return undefined;
            }
            throw err;
          },
        ),
      ),
    );
    const [
      receiveSharesGate,
      sendSharesGate,
      receiveAssetsGate,
      sendAssetsGate,
    ] = results;

    // Any getter answering proves this is a Vault V2. A partial answer should
    // be impossible; if it happens, the unread gates are treated as SET below.
    const supportsGates = results.some(address => address !== undefined);
    const gateSet = (address?: string): boolean =>
      address === undefined ? supportsGates : address !== ZeroAddress;

    const receiveSharesSet = gateSet(receiveSharesGate);
    const sendSharesSet = gateSet(sendSharesGate);
    const receiveAssetsSet = gateSet(receiveAssetsGate);
    const sendAssetsSet = gateSet(sendAssetsGate);

    return {
      vaultAddress,
      supportsGates,
      receiveSharesGate,
      sendSharesGate,
      receiveAssetsGate,
      sendAssetsGate,
      isGated:
        receiveSharesSet ||
        sendSharesSet ||
        receiveAssetsSet ||
        sendAssetsSet,
      depositGated: receiveSharesSet || sendAssetsSet,
      exitGated: sendSharesSet || receiveAssetsSet,
      shareTransferGated: receiveSharesSet || sendSharesSet,
    };
  }

  /**
   * Does this vault have ANY gate attached? Convenience over
   * {@link MorphoVaultAPI.getVaultGates} — use that when you need to know which
   * leg is affected, or {@link MorphoVaultAPI.getGateAccess} when you need to
   * know whether a specific account passes.
   */
  static async isGated(
    vaultAddress: string,
    provider: Provider,
  ): Promise<boolean> {
    return (await this.getVaultGates(vaultAddress, provider)).isGated;
  }

  /**
   * Ask the vault, via its own `canReceiveShares` / `canSendShares` /
   * `canReceiveAssets` / `canSendAssets` view helpers, whether `account` is
   * allowed. This is exact rather than heuristic: a configured gate can still
   * be permissive, and only the gate itself knows.
   *
   * Costs nothing extra on an ungated vault — an unset gate is unconditionally
   * permissive on-chain, so no call is made for it.
   *
   * A gate that REVERTS is reported as denied, not unknown. That matches the
   * chain: the vault's own docs note a gate "can block all vault interactions
   * if it reverts", and `enter`/`exit` bubble the revert.
   */
  static async getGateAccess(params: {
    vaultAddress: string;
    account: string;
    provider: Provider;
    /** Pre-read gates, to avoid a second round trip. */
    gates?: MorphoVaultGates;
  }): Promise<MorphoVaultGateAccess> {
    const { vaultAddress, account, provider } = params;
    const gates =
      params.gates ?? (await this.getVaultGates(vaultAddress, provider));
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);

    const check = async (
      name: 'canReceiveShares' | 'canSendShares' | 'canReceiveAssets' | 'canSendAssets',
      gateAddress: string | undefined,
    ): Promise<boolean> => {
      const configured =
        gateAddress === undefined ? gates.supportsGates : gateAddress !== ZeroAddress;
      if (!configured) {
        return true;
      }
      return vault.gateCheck(name, account).then(
        allowed => allowed,
        (err: unknown) => {
          if (isUnanswerableCall(err)) {
            return false;
          }
          throw err;
        },
      );
    };

    const [canReceiveShares, canSendShares, canReceiveAssets, canSendAssets] =
      await Promise.all([
        check('canReceiveShares', gates.receiveSharesGate),
        check('canSendShares', gates.sendSharesGate),
        check('canReceiveAssets', gates.receiveAssetsGate),
        check('canSendAssets', gates.sendAssetsGate),
      ]);

    return {
      vaultAddress,
      account,
      gates,
      canReceiveShares,
      canSendShares,
      canReceiveAssets,
      canSendAssets,
      canDeposit: canReceiveShares && canSendAssets,
      canExit: canSendShares && canReceiveAssets,
    };
  }

  /**
   * Refuse to quote against a vault whose gates would reject this batch.
   *
   * Called by every `get*Quote`, which is the single async funnel all three
   * vault recipes and both combos pass through. Recipes cannot do this in their
   * constructors — the check is a network read and constructors are sync — but
   * they do not need to: there is no path to a step that skips the quote.
   *
   * Refusal rules, in order:
   *
   * 1. Not gated → allow. This is every vault shipped today.
   * 2. Any SHARE gate configured → refuse, regardless of `account`. Shielding
   *    the shares is `transferFrom(executor → RAILGUN contract)` and V2 checks
   *    `canSendShares(from)` AND `canReceiveShares(to)`. The RAILGUN contract is
   *    a fixed third party that a curator's allowlist will not contain, so even
   *    an executor that passes cannot complete the round trip: `deposit` would
   *    succeed and the shares would then be unshieldable.
   * 3. Only ASSET gates configured → ask the vault about `account` and refuse
   *    only if it actually says no. `sendAssetsGate` gates depositing,
   *    `receiveAssetsGate` gates withdrawing; neither touches the share token,
   *    so a permissive one is genuinely harmless.
   */
  static async assertVaultUsable(params: {
    vaultAddress: string;
    account: string;
    operation: MorphoVaultGateOperation;
    provider: Provider;
    /**
     * Escape hatch for a caller that has independently established access (for
     * example via {@link MorphoVaultAPI.getGateAccess} plus knowledge of the
     * gate's policy). Skips the read entirely.
     */
    allowGatedVault?: boolean;
    gates?: MorphoVaultGates;
  }): Promise<void> {
    const { vaultAddress, account, operation, provider } = params;
    if (params.allowGatedVault === true) {
      return;
    }
    const gates =
      params.gates ?? (await this.getVaultGates(vaultAddress, provider));
    if (!gates.isGated) {
      return;
    }
    if (gates.shareTransferGated) {
      throw new MorphoVaultGatedError({
        gates,
        account,
        operation,
        reason:
          'a share gate is attached, so the vault shares cannot be moved ' +
          'between the ephemeral executor and the RAILGUN contract',
      });
    }
    const access = await this.getGateAccess({
      vaultAddress,
      account,
      provider,
      gates,
    });
    const allowed = operation === 'deposit' ? access.canDeposit : access.canExit;
    if (!allowed) {
      throw new MorphoVaultGatedError({
        gates,
        account,
        operation,
        reason:
          operation === 'deposit'
            ? `the vault reports canSendAssets=${access.canSendAssets} for this account`
            : `the vault reports canReceiveAssets=${access.canReceiveAssets} for this account`,
      });
    }
  }

  static async getDepositQuote(params: {
    vaultAddress: string;
    depositAssets: bigint;
    slippageBasisPoints: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
    /** See {@link MorphoVaultAPI.assertVaultUsable}. Default: enforce. */
    allowGatedVault?: boolean;
  }): Promise<MetaMorphoDepositQuote> {
    const { vaultAddress, depositAssets, slippageBasisPoints, provider } =
      params;
    if (depositAssets <= 0n) {
      throw new Error('morpho: deposit assets must be > 0');
    }
    assertValidSlippage(slippageBasisPoints);
    const receiver = resolveExecutorAddress(
      params.recipient,
      'MetaMorpho deposit receiver',
    );
    // Run alongside the metadata reads: the gate check is one round trip and
    // this keeps it off the critical path on the overwhelmingly common ungated
    // vault. Promise.all attaches a handler to both, so the losing rejection
    // cannot surface as an unhandled rejection.
    const [data] = await Promise.all([
      this.getVaultData(vaultAddress, provider),
      this.assertVaultUsable({
        vaultAddress,
        account: receiver,
        operation: 'deposit',
        provider,
        allowGatedVault: params.allowGatedVault,
      }),
    ]);
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const expectedShares = await vault.previewDeposit(depositAssets);
    const minShares = minBalanceAfterSlippage(
      expectedShares,
      slippageBasisPoints,
    );
    return {
      ...data,
      depositAssets,
      expectedShares,
      minShares,
      slippageBasisPoints,
      receiver,
    };
  }

  static async getRedeemQuote(params: {
    vaultAddress: string;
    redeemShares: bigint;
    slippageBasisPoints: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
    /** See {@link MorphoVaultAPI.assertVaultUsable}. Default: enforce. */
    allowGatedVault?: boolean;
  }): Promise<MetaMorphoRedeemQuote> {
    const { vaultAddress, redeemShares, slippageBasisPoints, provider } =
      params;
    if (redeemShares <= 0n) {
      throw new Error('morpho: redeem shares must be > 0');
    }
    assertValidSlippage(slippageBasisPoints);
    // owner == receiver == ephemeral EOA (owner is msg.sender under 7702).
    const executor = resolveExecutorAddress(
      params.recipient,
      'MetaMorpho redeem receiver',
    );
    const [data] = await Promise.all([
      this.getVaultData(vaultAddress, provider),
      this.assertVaultUsable({
        vaultAddress,
        account: executor,
        operation: 'exit',
        provider,
        allowGatedVault: params.allowGatedVault,
      }),
    ]);
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const expectedAssets = await vault.previewRedeem(redeemShares);
    const minAssets = minBalanceAfterSlippage(
      expectedAssets,
      slippageBasisPoints,
    );
    return {
      ...data,
      redeemShares,
      expectedAssets,
      minAssets,
      slippageBasisPoints,
      receiver: executor,
      owner: executor,
    };
  }

  static async getWithdrawQuote(params: {
    vaultAddress: string;
    withdrawAssets: bigint;
    slippageBasisPoints: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
    /** See {@link MorphoVaultAPI.assertVaultUsable}. Default: enforce. */
    allowGatedVault?: boolean;
  }): Promise<MetaMorphoWithdrawQuote> {
    const { vaultAddress, withdrawAssets, slippageBasisPoints, provider } =
      params;
    if (withdrawAssets <= 0n) {
      throw new Error('morpho: withdraw assets must be > 0');
    }
    assertValidSlippage(slippageBasisPoints);
    // Exact-assets withdraw burns a non-deterministic share count, so a zero
    // buffer makes maxShares == previewWithdraw and reverts on any share-rate
    // drift between build and inclusion. Require a non-zero buffer here (deposit
    // /redeem tolerate 0 — their bands are validation-only, never on-chain).
    if (slippageBasisPoints < 1n) {
      throw new Error(
        'morpho: withdraw slippageBasisPoints must be >= 1 to absorb share-rate drift',
      );
    }
    // owner == receiver == ephemeral EOA (owner is msg.sender under 7702).
    const executor = resolveExecutorAddress(
      params.recipient,
      'MetaMorpho withdraw receiver',
    );
    const [data] = await Promise.all([
      this.getVaultData(vaultAddress, provider),
      this.assertVaultUsable({
        vaultAddress,
        account: executor,
        operation: 'exit',
        provider,
        allowGatedVault: params.allowGatedVault,
      }),
    ]);
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const expectedShares = await vault.previewWithdraw(withdrawAssets);
    // Conservative upper bound: shares burned can rise with rate drift, so
    // over-declare consumption (never a share shortfall). Leftover reshields.
    const maxShares =
      expectedShares + (expectedShares * slippageBasisPoints) / 10000n;
    return {
      ...data,
      withdrawAssets,
      expectedShares,
      maxShares,
      slippageBasisPoints,
      receiver: executor,
      owner: executor,
    };
  }
}
