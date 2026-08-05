import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { MorphoBlue } from '../../typechain';
import { validateContractAddress } from '../../utils/address';
import {
  EMPTY_MORPHO_CALLBACK_DATA,
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';

export type MorphoBluePosition = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

export type MorphoBlueMarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

/**
 * Thin wrapper over the Morpho Blue singleton.
 *
 * Positions are NOT tokenized: the `onBehalf` address is the only handle to
 * them. Under EIP-7702 `receiver` is the executing ephemeral EOA (also
 * `msg.sender`), because the shield leg sweeps that account's balance.
 * `onBehalf` is the *owner*, which may be the same account — the ordinary
 * self-custody case, always authorised for itself — or a durable account that
 * has granted the executor `setAuthorization`. `borrow` and
 * `withdrawCollateral` require `isAuthorized[onBehalf][msg.sender]` when the
 * two differ; `supplyCollateral` and `repay` never do.
 */
export class MorphoBlueContract {
  private readonly contract: MorphoBlue;

  constructor(address: string = MORPHO_BLUE_ADDRESS, provider?: Provider) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid address for Morpho Blue contract');
    }
    this.contract = new Contract(
      address,
      abi.morpho.blue,
      provider,
    ) as unknown as MorphoBlue;
  }

  createSupplyCollateral(
    params: MarketParams,
    assets: bigint,
    onBehalf: string,
  ): Promise<ContractTransaction> {
    return this.contract.supplyCollateral.populateTransaction(
      params,
      assets,
      onBehalf,
      EMPTY_MORPHO_CALLBACK_DATA,
    );
  }

  createWithdrawCollateral(
    params: MarketParams,
    assets: bigint,
    onBehalf: string,
    receiver: string,
  ): Promise<ContractTransaction> {
    return this.contract.withdrawCollateral.populateTransaction(
      params,
      assets,
      onBehalf,
      receiver,
    );
  }

  createSupply(
    params: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: string,
  ): Promise<ContractTransaction> {
    // Blue requires EXACTLY one of assets/shares to be non-zero. Supplying is
    // assets-denominated in every sane case — you know what you are lending —
    // but the shares form is kept reachable so a caller mirroring a withdrawal
    // can round-trip without a unit conversion.
    return this.contract.supply.populateTransaction(
      params,
      assets,
      shares,
      onBehalf,
      EMPTY_MORPHO_CALLBACK_DATA,
    );
  }

  createWithdraw(
    params: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: string,
    receiver: string,
  ): Promise<ContractTransaction> {
    // Exactly one of assets/shares is non-zero. Shares are what a FULL exit
    // must use: interest accrues between quoting and execution, so an
    // assets-denominated "withdraw everything" is stale the moment it is built
    // and leaves a shares residue that no later batch is looking for.
    return this.contract.withdraw.populateTransaction(
      params,
      assets,
      shares,
      onBehalf,
      receiver,
    );
  }

  createBorrow(
    params: MarketParams,
    assets: bigint,
    onBehalf: string,
    receiver: string,
  ): Promise<ContractTransaction> {
    // assets-denominated borrow: shares = 0.
    return this.contract.borrow.populateTransaction(
      params,
      assets,
      0n,
      onBehalf,
      receiver,
    );
  }

  createRepay(
    params: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: string,
  ): Promise<ContractTransaction> {
    // Exactly one of assets/shares is non-zero (shares for a full close).
    return this.contract.repay.populateTransaction(
      params,
      assets,
      shares,
      onBehalf,
      EMPTY_MORPHO_CALLBACK_DATA,
    );
  }

  /**
   * `position[id][user]` — the authoritative state of an address-bound position.
   *
   * @param blockTag Pin the read to a specific block. Optional and defaulting to
   *   the node's latest, so every existing caller is unaffected.
   *
   *   A rediscovery scan needs it: the scan enumerates `(market, owner)` pairs
   *   over a block *range*, and confirming those pairs at whatever height the
   *   node happens to be at answers a different question than the one asked —
   *   it reports state the range never covered, and does so inconsistently
   *   across pairs when a load-balanced pool serves the reads from nodes at
   *   different heights. Passing the scan's `toBlock` makes the answer a
   *   snapshot rather than a smear.
   *
   *   Note this needs an **archive** node for any block outside the recent
   *   window; a pruning node rejects it rather than answering wrongly.
   */
  async position(
    id: string,
    user: string,
    blockTag?: number | string,
  ): Promise<MorphoBluePosition> {
    const [supplyShares, borrowShares, collateral] =
      blockTag === undefined
        ? await this.contract.position(id, user)
        : await this.contract.position(id, user, { blockTag });
    return { supplyShares, borrowShares, collateral };
  }

  async idToMarketParams(id: string): Promise<MarketParams> {
    const [loanToken, collateralToken, oracle, irm, lltv] =
      await this.contract.idToMarketParams(id);
    return { loanToken, collateralToken, oracle, irm, lltv };
  }

  async market(id: string): Promise<MorphoBlueMarketState> {
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = await this.contract.market(id);
    return {
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    };
  }

  /**
   * `isAuthorized[authorizer][authorized]` — may `authorized` manage
   * `authorizer`'s positions? Note the argument order is the mapping's, i.e.
   * (position owner, operator); Morpho's `_isSenderAuthorized(onBehalf)` reads
   * `msg.sender == onBehalf || isAuthorized[onBehalf][msg.sender]`, so this is
   * called `(owner, executor)`.
   */
  async isAuthorized(authorizer: string, authorized: string): Promise<boolean> {
    return this.contract.isAuthorized(authorizer, authorized);
  }

  createSetAuthorization(
    authorized: string,
    isAuthorized: boolean,
  ): Promise<ContractTransaction> {
    return this.contract.setAuthorization.populateTransaction(
      authorized,
      isAuthorized,
    );
  }
}
