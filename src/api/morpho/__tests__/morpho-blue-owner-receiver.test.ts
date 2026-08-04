import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Interface,
  InterfaceAbi,
  Provider,
  TransactionRequest,
  getAddress,
} from 'ethers';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { abi } from '../../../abi/abi';
import { MorphoBlueAPI } from '../morpho-blue-api';
import { MorphoBluePosition } from '../../../contract/morpho/morpho-blue-contract';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
  borrowAssetsForShares,
  getMarketId,
} from '../../../steps/morpho/morpho-blue-util';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// The unit under test is the INPUT boundary of the quote builders: `onBehalf`
// (the durable account holding the position) and `receiver` (the account this
// batch runs as and shields from) used to be one collapsed `recipient`.
//
// Every assertion below is about which of the two a given address lands on, and
// about the authorization Morpho requires when they differ.
// ---------------------------------------------------------------------------

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'; // pragma: allowlist secret
const ORACLE = '0xDd1778F71a4a1C6A0eFebd8AE9f8848634CE1101'; // pragma: allowlist secret
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC'; // pragma: allowlist secret

const market: MarketParams = {
  loanToken: USDC,
  collateralToken: PAXG,
  oracle: ORACLE,
  irm: IRM,
  lltv: 915000000000000000n,
};
const MARKET_ID = getMarketId(market);

/** The account this batch runs as. Holds no position of its own. */
const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
/** The durable account that HOLDS the position. */
const OWNER = '0xbCd16D361adf5E7e0dc0010756B49666b4f38eE0';
/** A third account that has authorised nobody. */
const STRANGER = '0x1111111111111111111111111111111111111111';
const RELAY_ADAPT = NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract;

const OWNER_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 500_000_000_000_000_000n, // 0.5e18 -> 500 USDC owed
  collateral: 3_000_000_000_000_000_000n, // 3 PAXG
};
const EMPTY_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 0n,
  collateral: 0n,
};

const MARKET_TOTALS = {
  totalSupplyAssets: 2_000_000_000n,
  totalSupplyShares: 2_000_000_000_000_000_000n,
  totalBorrowAssets: 1_000_000_000n,
  totalBorrowShares: 1_000_000_000_000_000_000n,
  lastUpdate: 1785853583n,
  fee: 0n,
};

/**
 * What the owner owes, derived with the same conversion the builder uses rather
 * than hardcoded — Morpho's share math carries virtual assets/shares, so a
 * literal here would encode an off-by-one instead of an expectation.
 */
const OWNER_OWED_ASSETS = borrowAssetsForShares(
  OWNER_POSITION.borrowShares,
  MARKET_TOTALS.totalBorrowAssets,
  MARKET_TOTALS.totalBorrowShares,
);

const blueIface = new Interface(abi.morpho.blue as InterfaceAbi);
const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);

type StubOptions = {
  /** `${authorizer}:${authorized}` pairs, lowercased, that return true. */
  authorizations?: ReadonlySet<string>;
  /** Every read the stub served, in order — used to prove reads are skipped. */
  reads?: string[];
};

const authKey = (authorizer: string, authorized: string): string =>
  `${authorizer.toLowerCase()}:${authorized.toLowerCase()}`;

const makeStubProvider = (options: StubOptions = {}): Provider => {
  const record = (label: string) => options.reads?.push(label);

  const call = async (tx: TransactionRequest): Promise<string> => {
    const to = (tx.to as string).toLowerCase();
    const data = tx.data as string;
    const selector = data.slice(0, 10);

    if (to === MORPHO_BLUE_ADDRESS.toLowerCase()) {
      if (selector === blueIface.getFunction('position')?.selector) {
        const account = blueIface.decodeFunctionData(
          'position',
          data,
        )[1] as string;
        record(`position(${getAddress(account)})`);
        const position =
          account.toLowerCase() === OWNER.toLowerCase()
            ? OWNER_POSITION
            : EMPTY_POSITION;
        return blueIface.encodeFunctionResult('position', [
          position.supplyShares,
          position.borrowShares,
          position.collateral,
        ]);
      }
      if (selector === blueIface.getFunction('market')?.selector) {
        record('market');
        return blueIface.encodeFunctionResult('market', [
          MARKET_TOTALS.totalSupplyAssets,
          MARKET_TOTALS.totalSupplyShares,
          MARKET_TOTALS.totalBorrowAssets,
          MARKET_TOTALS.totalBorrowShares,
          MARKET_TOTALS.lastUpdate,
          MARKET_TOTALS.fee,
        ]);
      }
      if (selector === blueIface.getFunction('isAuthorized')?.selector) {
        const [authorizer, authorized] = blueIface.decodeFunctionData(
          'isAuthorized',
          data,
        ) as unknown as [string, string];
        record(
          `isAuthorized(${getAddress(authorizer)}, ${getAddress(authorized)})`,
        );
        return blueIface.encodeFunctionResult('isAuthorized', [
          options.authorizations?.has(authKey(authorizer, authorized)) === true,
        ]);
      }
    }

    if (to === USDC.toLowerCase() || to === PAXG.toLowerCase()) {
      record('decimals');
      return erc20Iface.encodeFunctionResult('decimals', [
        to === USDC.toLowerCase() ? 6n : 18n,
      ]);
    }

    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };

  return { call } as unknown as Provider;
};

const authorized = (owner: string, executor: string) =>
  new Set([authKey(owner, executor)]);

describe('MorphoBlueAPI owner/receiver — authorization preflight', () => {
  it('short-circuits the self case without an isAuthorized read', async () => {
    const reads: string[] = [];
    const authorization = await MorphoBlueAPI.getAuthorization({
      owner: EXECUTOR,
      executor: EXECUTOR,
      provider: makeStubProvider({ reads }),
    });
    expect(authorization.isSelf).to.equal(true);
    expect(authorization.isAuthorized).to.equal(true);
    expect(authorization.blocksOwnerWrites).to.equal(false);
    expect(reads).to.deep.equal([]);
  });

  it('reports a missing authorization without throwing', async () => {
    const authorization = await MorphoBlueAPI.getAuthorization({
      owner: OWNER,
      executor: EXECUTOR,
      provider: makeStubProvider(),
    });
    expect(authorization.isSelf).to.equal(false);
    expect(authorization.isAuthorized).to.equal(false);
    expect(authorization.blocksOwnerWrites).to.equal(true);
  });

  it('reads the mapping as isAuthorized[owner][executor], not the reverse', async () => {
    const reads: string[] = [];
    await MorphoBlueAPI.getAuthorization({
      owner: OWNER,
      executor: EXECUTOR,
      provider: makeStubProvider({ reads }),
    });
    expect(reads).to.deep.equal([`isAuthorized(${OWNER}, ${EXECUTOR})`]);

    // The reversed grant must NOT satisfy it.
    const reversed = await MorphoBlueAPI.getAuthorization({
      owner: OWNER,
      executor: EXECUTOR,
      provider: makeStubProvider({
        authorizations: authorized(EXECUTOR, OWNER),
      }),
    });
    expect(reversed.blocksOwnerWrites).to.equal(true);
  });
});

describe('MorphoBlueAPI owner/receiver — borrow', () => {
  it('credits a batch-local receiver while charging a durable owner', async () => {
    // The acceptance case for this unit.
    const quote = await MorphoBlueAPI.getBorrowQuote({
      market,
      borrowAssets: 1_000_000n,
      owner: OWNER,
      receiver: EXECUTOR,
      provider: makeStubProvider({
        authorizations: authorized(OWNER, EXECUTOR),
      }),
    });
    expect(quote.onBehalf).to.equal(OWNER);
    expect(quote.receiver).to.equal(EXECUTOR);
    expect(quote.onBehalf).to.not.equal(quote.receiver);
  });

  it('still collapses to one account when owner === receiver, with no extra read', async () => {
    const reads: string[] = [];
    const quote = await MorphoBlueAPI.getBorrowQuote({
      market,
      borrowAssets: 1_000_000n,
      owner: EXECUTOR,
      receiver: EXECUTOR,
      provider: makeStubProvider({ reads }),
    });
    expect(quote.onBehalf).to.equal(EXECUTOR);
    expect(quote.receiver).to.equal(EXECUTOR);
    expect(reads).to.deep.equal(['decimals']);
  });

  it('refuses to build an unauthorised delegated borrow', async () => {
    // Without this the batch mines with status 1 having done nothing.
    await expect(
      MorphoBlueAPI.getBorrowQuote({
        market,
        borrowAssets: 1_000_000n,
        owner: OWNER,
        receiver: EXECUTOR,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/UNAUTHORIZED/);

    await expect(
      MorphoBlueAPI.getBorrowQuote({
        market,
        borrowAssets: 1_000_000n,
        owner: OWNER,
        receiver: EXECUTOR,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/requireSuccess=false/);
  });

  it('checksums both roles independently', async () => {
    const quote = await MorphoBlueAPI.getBorrowQuote({
      market,
      borrowAssets: 1_000_000n,
      owner: OWNER.toLowerCase(),
      receiver: EXECUTOR.toLowerCase(),
      provider: makeStubProvider({
        authorizations: authorized(OWNER, EXECUTOR),
      }),
    });
    expect(quote.onBehalf).to.equal(OWNER);
    expect(quote.receiver).to.equal(EXECUTOR);
  });

  it('rejects a relay-adapt in either role, naming the role', async () => {
    await expect(
      MorphoBlueAPI.getBorrowQuote({
        market,
        borrowAssets: 1_000_000n,
        owner: OWNER,
        receiver: RELAY_ADAPT,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/borrow receiver.*relay-adapt/is);

    await expect(
      MorphoBlueAPI.getBorrowQuote({
        market,
        borrowAssets: 1_000_000n,
        owner: RELAY_ADAPT,
        receiver: EXECUTOR,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/position owner.*shared custody/is);
  });
});

describe('MorphoBlueAPI owner/receiver — legs with no receiver', () => {
  it('supplies collateral to the owner, with no authorization read', async () => {
    const reads: string[] = [];
    const quote = await MorphoBlueAPI.getSupplyCollateralQuote({
      market,
      collateralAssets: 1_000_000_000_000_000_000n,
      owner: OWNER,
      provider: makeStubProvider({ reads }),
    });
    // Morpho lets anyone supply on anyone's behalf.
    expect(quote.onBehalf).to.equal(OWNER);
    expect(reads).to.deep.equal(['decimals']);
  });

  it('caps a repay against the OWNER debt, not the executor', async () => {
    const reads: string[] = [];
    const quote = await MorphoBlueAPI.getRepayQuote({
      market,
      repayAssets: 1_000_000_000n, // more than owed
      owner: OWNER,
      provider: makeStubProvider({ reads }),
    });
    expect(quote.onBehalf).to.equal(OWNER);
    expect(quote.repayAssets).to.equal(OWNER_OWED_ASSETS);
    expect(reads).to.include(`position(${OWNER})`);
    expect(reads.some(read => read.startsWith('isAuthorized'))).to.equal(false);
  });

  it('sizes a shares-mode close from the OWNER borrow shares', async () => {
    // Keyed on the executor (as the collapsed builder did) this position is
    // empty and the close would throw against a funded owner.
    const quote = await MorphoBlueAPI.getRepaySharesQuote({
      market,
      owner: OWNER,
      slippageBasisPoints: 100n,
      provider: makeStubProvider(),
    });
    expect(quote.onBehalf).to.equal(OWNER);
    expect(quote.repayShares).to.equal(OWNER_POSITION.borrowShares);
    expect(quote.expectedRepaidAssets).to.equal(OWNER_OWED_ASSETS);
    expect(quote.maxRepaidAssets).to.equal(
      OWNER_OWED_ASSETS + OWNER_OWED_ASSETS / 100n,
    );
  });

  it('reports no debt when the OWNER has none', async () => {
    await expect(
      MorphoBlueAPI.getRepayQuote({
        market,
        repayAssets: 1_000n,
        owner: STRANGER,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/no debt to repay/);
  });
});

describe('MorphoBlueAPI owner/receiver — withdraw collateral', () => {
  it('withdraws the OWNER collateral to a batch-local receiver', async () => {
    const reads: string[] = [];
    const quote = await MorphoBlueAPI.getWithdrawAllCollateralQuote({
      market,
      owner: OWNER,
      receiver: EXECUTOR,
      provider: makeStubProvider({
        authorizations: authorized(OWNER, EXECUTOR),
        reads,
      }),
    });
    expect(quote.onBehalf).to.equal(OWNER);
    expect(quote.receiver).to.equal(EXECUTOR);
    // The full-collateral read must key on the owner. Keyed on the receiver it
    // would read an empty position and throw "no collateral to withdraw".
    expect(reads[0]).to.equal(`position(${OWNER})`);
    expect(quote.withdrawAssets).to.equal(OWNER_POSITION.collateral);
  });

  it('refuses an unauthorised delegated withdraw before any debt is repaid', async () => {
    await expect(
      MorphoBlueAPI.getWithdrawCollateralQuote({
        market,
        withdrawAssets: 1n,
        owner: OWNER,
        receiver: EXECUTOR,
        provider: makeStubProvider(),
      }),
    ).to.be.rejectedWith(/withdrawCollateral.*UNAUTHORIZED/is);
  });

  it('keeps the self case working', async () => {
    const quote = await MorphoBlueAPI.getWithdrawCollateralQuote({
      market,
      withdrawAssets: 1_000n,
      owner: EXECUTOR,
      receiver: EXECUTOR,
      provider: makeStubProvider(),
    });
    expect(quote.onBehalf).to.equal(EXECUTOR);
    expect(quote.receiver).to.equal(EXECUTOR);
    expect(quote.marketId).to.equal(MARKET_ID);
  });
});
