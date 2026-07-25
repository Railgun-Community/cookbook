import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';
import {
  MorphoBlueContract,
  MorphoBluePosition,
} from '../../contract/morpho/morpho-blue-contract';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import {
  MarketParams,
  borrowAssetsForShares,
  getMarketId,
} from '../../steps/morpho/morpho-blue-util';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

export type MorphoSupplyCollateralQuote = {
  params: MarketParams;
  marketId: string;
  collateralToken: string;
  collateralDecimals: bigint;
  collateralAssets: bigint;
  onBehalf: string;
};

export type MorphoBorrowQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  borrowAssets: bigint;
  onBehalf: string;
  receiver: string;
};

export type MorphoRepayQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  repayAssets: bigint;
  onBehalf: string;
};

/**
 * A shares-mode repay quote (`repay(shares)`), for a clean (full or partial)
 * close that avoids debt growth between build and inclusion. The exact loan
 * pulled drifts with interest, so `maxRepaidAssets` is a conservative upper
 * bound the caller must unshield; the remainder reshields.
 */
export type MorphoRepaySharesQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  repayShares: bigint;
  expectedRepaidAssets: bigint;
  maxRepaidAssets: bigint;
  slippageBasisPoints: bigint;
  onBehalf: string;
};

export type MorphoWithdrawCollateralQuote = {
  params: MarketParams;
  marketId: string;
  collateralToken: string;
  collateralDecimals: bigint;
  withdrawAssets: bigint;
  onBehalf: string;
  receiver: string;
};

/**
 * Self-contained data layer for Morpho Blue market recipes — reads market
 * params + token decimals on-chain and validates the 7702 executor, so callers
 * pass only the market (or its id), an amount, the executor, and a provider.
 *
 * Positions are un-tokenized: `onBehalf` == `receiver` == the ephemeral EOA (also
 * `msg.sender`, always authorised for its own position). The EOA identity is the
 * only handle to the position across non-atomic batches.
 */
export class MorphoBlueAPI {
  static supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  static async getMarketParamsFromId(
    marketId: string,
    provider: Provider,
  ): Promise<MarketParams> {
    return new MorphoBlueContract(undefined, provider).idToMarketParams(
      marketId,
    );
  }

  static async getPosition(
    marketId: string,
    user: string,
    provider: Provider,
  ): Promise<MorphoBluePosition> {
    return new MorphoBlueContract(undefined, provider).position(marketId, user);
  }

  private static async decimalsOf(
    tokenAddress: string,
    provider: Provider,
  ): Promise<bigint> {
    return new ERC20Contract(tokenAddress, provider).decimals();
  }

  static async getSupplyCollateralQuote(params: {
    market: MarketParams;
    collateralAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoSupplyCollateralQuote> {
    if (params.collateralAssets <= 0n) {
      throw new Error('morpho: supply collateral assets must be > 0');
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho supply-collateral onBehalf',
    );
    const collateralDecimals = await this.decimalsOf(
      params.market.collateralToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      collateralToken: params.market.collateralToken,
      collateralDecimals,
      collateralAssets: params.collateralAssets,
      onBehalf,
    };
  }

  static async getBorrowQuote(params: {
    market: MarketParams;
    borrowAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoBorrowQuote> {
    if (params.borrowAssets <= 0n) {
      throw new Error('morpho: borrow assets must be > 0');
    }
    // onBehalf == receiver == ephemeral EOA.
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho borrow receiver',
    );
    const loanDecimals = await this.decimalsOf(
      params.market.loanToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      loanToken: params.market.loanToken,
      loanDecimals,
      borrowAssets: params.borrowAssets,
      onBehalf: executor,
      receiver: executor,
    };
  }

  static async getRepayQuote(params: {
    market: MarketParams;
    repayAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoRepayQuote> {
    if (params.repayAssets <= 0n) {
      throw new Error('morpho: repay assets must be > 0');
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho repay onBehalf',
    );
    const marketId = getMarketId(params.market);
    const blue = new MorphoBlueContract(undefined, params.provider);
    const [position, marketState, loanDecimals] = await Promise.all([
      blue.position(marketId, onBehalf),
      blue.market(marketId),
      this.decimalsOf(params.market.loanToken, params.provider),
    ]);
    // Cap the assets-denominated repay to the position's current debt. Morpho's
    // repay(assets) reverts on over-repay (borrow-share underflow); on the
    // broadcaster path that revert is swallowed (requireSuccess=false), silently
    // no-op'ing the repay while still charging fees. Debt only grows with accrual
    // between build and inclusion, so a build-time cap never over-repays; any
    // excess unshielded loan reshields via the relay-adapt balance sweep.
    const owedAssets = borrowAssetsForShares(
      position.borrowShares,
      marketState.totalBorrowAssets,
      marketState.totalBorrowShares,
    );
    if (owedAssets <= 0n) {
      throw new Error('morpho: no debt to repay');
    }
    const repayAssets =
      params.repayAssets < owedAssets ? params.repayAssets : owedAssets;
    return {
      params: params.market,
      marketId,
      loanToken: params.market.loanToken,
      loanDecimals,
      repayAssets,
      onBehalf,
    };
  }

  /**
   * Build a shares-mode repay quote for the ephemeral EOA's position. If
   * `repayShares` is omitted, the full `borrowShares` is read on-chain (full
   * close). Reads market state to size a conservative loan budget.
   */
  static async getRepaySharesQuote(params: {
    market: MarketParams;
    recipient: EphemeralExecutor | string;
    provider: Provider;
    slippageBasisPoints: bigint;
    repayShares?: bigint;
  }): Promise<MorphoRepaySharesQuote> {
    const { market, provider, slippageBasisPoints } = params;
    if (slippageBasisPoints < 1n || slippageBasisPoints > 10000n) {
      throw new Error(
        `morpho: slippageBasisPoints must be 1..10000 — a non-zero buffer is ` +
          `required to absorb interest/oracle drift (got ${slippageBasisPoints})`,
      );
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho repay-shares onBehalf',
    );
    const marketId = getMarketId(market);
    const blue = new MorphoBlueContract(undefined, provider);
    const [position, marketState, loanDecimals] = await Promise.all([
      blue.position(marketId, onBehalf),
      blue.market(marketId),
      this.decimalsOf(market.loanToken, provider),
    ]);
    const repayShares = params.repayShares ?? position.borrowShares;
    if (repayShares <= 0n) {
      throw new Error('morpho: no borrow shares to repay');
    }
    if (repayShares > position.borrowShares) {
      throw new Error(
        `morpho: repayShares ${repayShares} exceeds position borrowShares ${position.borrowShares}`,
      );
    }
    const expectedRepaidAssets = borrowAssetsForShares(
      repayShares,
      marketState.totalBorrowAssets,
      marketState.totalBorrowShares,
    );
    const maxRepaidAssets =
      expectedRepaidAssets +
      (expectedRepaidAssets * slippageBasisPoints) / 10000n;
    return {
      params: market,
      marketId,
      loanToken: market.loanToken,
      loanDecimals,
      repayShares,
      expectedRepaidAssets,
      maxRepaidAssets,
      slippageBasisPoints,
      onBehalf,
    };
  }

  /**
   * Build a withdraw-collateral quote for the FULL collateral the ephemeral EOA
   * holds in the market (reads `position(id, EOA).collateral`).
   */
  static async getWithdrawAllCollateralQuote(params: {
    market: MarketParams;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoWithdrawCollateralQuote> {
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho withdraw-all receiver',
    );
    const position = await this.getPosition(
      getMarketId(params.market),
      executor,
      params.provider,
    );
    if (position.collateral <= 0n) {
      throw new Error('morpho: no collateral to withdraw');
    }
    return this.getWithdrawCollateralQuote({
      market: params.market,
      withdrawAssets: position.collateral,
      recipient: executor,
      provider: params.provider,
    });
  }

  static async getWithdrawCollateralQuote(params: {
    market: MarketParams;
    withdrawAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoWithdrawCollateralQuote> {
    if (params.withdrawAssets <= 0n) {
      throw new Error('morpho: withdraw collateral assets must be > 0');
    }
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho withdraw-collateral receiver',
    );
    const collateralDecimals = await this.decimalsOf(
      params.market.collateralToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      collateralToken: params.market.collateralToken,
      collateralDecimals,
      withdrawAssets: params.withdrawAssets,
      onBehalf: executor,
      receiver: executor,
    };
  }
}
