import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';
import { MetaMorphoVaultContract } from '../../../contract/vault/morpho/metamorpho-vault-contract';
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

  static async getDepositQuote(params: {
    vaultAddress: string;
    depositAssets: bigint;
    slippageBasisPoints: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
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
    const data = await this.getVaultData(vaultAddress, provider);
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
    const data = await this.getVaultData(vaultAddress, provider);
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
    const data = await this.getVaultData(vaultAddress, provider);
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
