import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../../abi/abi';
import { MetaMorpho } from '../../../typechain';
import { validateContractAddress } from '../../../utils/address';

/**
 * Morpho Vault V2 gating surface. V2 ONLY — a V1 MetaMorpho vault has no gate
 * mechanism at all and every one of these getters reverts on it (verified
 * on-chain against Steakhouse USDC `0xBEEF0173…`, which answers `MORPHO()` and
 * reverts on all four gate getters; Steakhouse Prime USDC `0xbeef0880…` is the
 * inverse). That asymmetry is what makes these getters a reliable generation
 * discriminator, so they are kept OUT of `abi.vault.metaMorpho` — that ABI
 * describes the shared ERC-4626 surface and must stay callable on both.
 *
 * Semantics, transcribed from morpho-org/vault-v2 `VaultV2.sol` (`address(0)`
 * disables a gate). NOTE the naming is counter-intuitive — the "assets" gates
 * are named for the direction the ASSETS move, not the user's action:
 *
 * - `receiveSharesGate`  → `canReceiveShares(account)`; checked on `onBehalf`
 *   in `enter()` (deposit/mint) and on `to` in `transfer`/`transferFrom`.
 * - `sendSharesGate`     → `canSendShares(account)`; checked on `onBehalf` in
 *   `exit()` (withdraw/redeem) and on `from`/`msg.sender` in transfers.
 * - `receiveAssetsGate`  → `canReceiveAssets(account)`; checked on `receiver`
 *   in `exit()`. Gates WITHDRAWING assets out of the vault.
 * - `sendAssetsGate`     → `canSendAssets(account)`; checked on `msg.sender` in
 *   `enter()`. Gates DEPOSITING assets into the vault.
 *
 * The `can*` helpers are `view` and short-circuit to `true` when their gate is
 * unset, so they are safe to call on any V2 vault. When a gate IS set they
 * delegate to it, and the vault's own docs warn a gate "can block all vault
 * interactions if it reverts" — a revert therefore means DENIED, not unknown.
 */
export const MORPHO_VAULT_V2_GATE_ABI = [
  {
    inputs: [],
    name: 'receiveSharesGate',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'sendSharesGate',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'receiveAssetsGate',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'sendAssetsGate',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'canReceiveShares',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'canSendShares',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'canReceiveAssets',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'canSendAssets',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** The four gates a Morpho Vault V2 curator can attach. */
export type MorphoVaultV2GateName =
  | 'receiveSharesGate'
  | 'sendSharesGate'
  | 'receiveAssetsGate'
  | 'sendAssetsGate';

/** The four per-account permission helpers a Morpho Vault V2 exposes. */
export type MorphoVaultV2GateCheck =
  | 'canReceiveShares'
  | 'canSendShares'
  | 'canReceiveAssets'
  | 'canSendAssets';

/**
 * Thin wrapper over a MetaMorpho ERC-4626 vault.
 *
 * Unlike the Beefy vault (which mints/burns to `msg.sender` implicitly via
 * depositAll/withdrawAll), ERC-4626 takes an explicit `receiver`/`owner`. Under
 * EIP-7702 these must be the executing ephemeral EOA so the shares/assets land
 * on the account the batch runs as — never the shared relay-adapt contract.
 */
export class MetaMorphoVaultContract {
  private readonly contract: MetaMorpho;

  private readonly address: string;

  private readonly provider?: Provider;

  // Built on first gate read, not in the constructor: every step builds one of
  // these per getStepOutput purely to encode calldata, and none of them touch
  // the gate surface. No reason to parse a second ABI on that path.
  private gateContractCache?: Contract;

  constructor(address: string, provider?: Provider) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid vault address for MetaMorpho contract');
    }
    this.address = address;
    this.provider = provider;
    this.contract = new Contract(
      address,
      abi.vault.metaMorpho,
      provider,
    ) as unknown as MetaMorpho;
  }

  private gateContract(): Contract {
    this.gateContractCache ??= new Contract(
      this.address,
      MORPHO_VAULT_V2_GATE_ABI,
      this.provider,
    );
    return this.gateContractCache;
  }

  /**
   * Read one Morpho Vault V2 gate address. Reverts (`CALL_EXCEPTION`) on a V1
   * MetaMorpho vault, which has no gate mechanism — callers must decide what an
   * absent getter means rather than having it silently coerced here.
   */
  gateAddress(gate: MorphoVaultV2GateName): Promise<string> {
    return this.gateContract()[gate]() as Promise<string>;
  }

  /**
   * Ask the vault whether `account` passes one gate. Only meaningful on a V2
   * vault; reverts on V1. A revert from a CONFIGURED gate means denied.
   */
  gateCheck(check: MorphoVaultV2GateCheck, account: string): Promise<boolean> {
    return this.gateContract()[check](account) as Promise<boolean>;
  }

  createDeposit(
    assets: bigint,
    receiver: string,
  ): Promise<ContractTransaction> {
    return this.contract.deposit.populateTransaction(assets, receiver);
  }

  createRedeem(
    shares: bigint,
    receiver: string,
    owner: string,
  ): Promise<ContractTransaction> {
    return this.contract.redeem.populateTransaction(shares, receiver, owner);
  }

  createWithdraw(
    assets: bigint,
    receiver: string,
    owner: string,
  ): Promise<ContractTransaction> {
    return this.contract.withdraw.populateTransaction(assets, receiver, owner);
  }

  asset(): Promise<string> {
    return this.contract.asset();
  }

  decimals(): Promise<bigint> {
    return this.contract.decimals();
  }

  previewDeposit(assets: bigint): Promise<bigint> {
    return this.contract.previewDeposit(assets);
  }

  previewRedeem(shares: bigint): Promise<bigint> {
    return this.contract.previewRedeem(shares);
  }

  previewWithdraw(assets: bigint): Promise<bigint> {
    return this.contract.previewWithdraw(assets);
  }

  balanceOf(account: string): Promise<bigint> {
    return this.contract.balanceOf(account);
  }
}
