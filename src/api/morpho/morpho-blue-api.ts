import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';
import {
  MorphoBlueContract,
  MorphoBluePosition,
} from '../../contract/morpho/morpho-blue-contract';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import {
  MarketParams,
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
    const loanDecimals = await this.decimalsOf(
      params.market.loanToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      loanToken: params.market.loanToken,
      loanDecimals,
      repayAssets: params.repayAssets,
      onBehalf,
    };
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
