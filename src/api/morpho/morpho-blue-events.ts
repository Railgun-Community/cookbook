import { Interface, InterfaceAbi, Log, getAddress, zeroPadValue } from 'ethers';
import { RecipePositionKind } from '../../models/export-models';

// =============================================================================
// Morpho Blue event fragments — the on-chain trail a rediscovery scan follows.
//
// ## Why this file exists
//
// A Blue position is not tokenized. The `onBehalf` address IS the handle, so a
// consumer that loses its local record of which ephemeral account holds what has
// lost the position — it is still there, still accruing interest, still
// liquidatable, and unfindable. The bundled ABI (`src/abi/morpho/MorphoBlue.json`)
// carries **13 entries, all `type: "function"`, zero events**, so nothing in this
// package could decode or filter that trail. These fragments are that missing
// half.
//
// Transcribed from `morpho-org/morpho-blue` `src/libraries/EventsLib.sol` and
// verified against the deployed mainnet singleton
// (`0xBBBB…FFCb`): every log in a 7,899-log window decoded with these fragments
// with zero topic-count or data-length mismatches, and the position-holder field
// of each was confirmed *semantically* by reading `position(id, addr)` either
// side of the emitting block and checking which candidate account's words
// actually moved.
//
// ## The indexed layout is NOT uniform, and that is the whole cost story
//
// The EVM allows three indexed params. Blue spends them differently per event,
// so **`onBehalf` is not always at the same topic index**:
//
// | event                | topic1 | topic2     | topic3     | in data              |
// |----------------------|--------|------------|------------|----------------------|
// | `Supply`             | id     | caller     | **onBehalf** | assets, shares     |
// | `Repay`              | id     | caller     | **onBehalf** | assets, shares     |
// | `SupplyCollateral`   | id     | caller     | **onBehalf** | assets             |
// | `Liquidate`          | id     | caller     | **borrower** | 5 × uint256        |
// | `Withdraw`           | id     | **onBehalf** | receiver   | caller, assets, shares |
// | `Borrow`             | id     | **onBehalf** | receiver   | caller, assets, shares |
// | `WithdrawCollateral` | id     | **onBehalf** | receiver   | caller, assets     |
//
// Every field a scan needs to filter on IS indexed, so this is **not** a full log
// sweep — but it is also not one query. Because `eth_getLogs` ANDs across topic
// positions and only ORs within one, keying by holder costs exactly **two**
// server-filtered queries per block range:
//
//   A: topics = [[Supply, Repay, SupplyCollateral, Liquidate], null, null, owners]
//   B: topics = [[Withdraw, Borrow, WithdrawCollateral],       null, owners, null]
//
// Measured: 3,596 blocks × 5 owners returned 874 logs in 260 ms, exactly equal to
// the client-side filtered set.
//
// ## The trap this table exists to prevent
//
// Collapsing the two into one query with all seven topic0s and `owners` at a
// single position is wrong in **both** directions, and quietly so. Filtering at
// topic2 over all seven, on the same measured window: 440 false positives (rows
// where the account was merely the `caller`) and 440 missed rows (every genuine
// holder sighting that sits at topic3).
//
// The false positives are the dangerous half. Under EIP-7702 self-custody the
// executor is both `caller` and `onBehalf`, so the bug is invisible — but that is
// exactly the case the owner/receiver split (`utils/7702/position-owner.ts`)
// exists to stop being the only one. The moment an executor acts for a durable
// owner, a topic2 filter attributes the *owner's* position to the *executor*.
//
// ## What these logs can and cannot tell you
//
// They answer **which (market, account) pairs exist**. They do NOT give current
// balances: interest accrues with no per-position event (only a market-wide
// `AccrueInterest`), liquidation and bad-debt socialisation move a holder's words
// from a transaction the holder never sent, and any activity before `fromBlock`
// is invisible. Replaying log deltas as a balance therefore produces a number
// that is wrong by an unbounded amount. Discovery is the log layer's job;
// `position(id, owner)` is the authority — see `morpho-blue-rediscovery.ts`,
// which does exactly that hand-off.
// =============================================================================

/**
 * Human-readable fragments for the seven events that move a position, plus
 * `SetAuthorization`.
 *
 * Named `bytes32 id` rather than Solidity's `Id` (a `type Id is bytes32`
 * user-defined value type) because the ABI encoding is `bytes32` and ethers has
 * no notion of the alias — the topic hashes are computed over the canonical
 * signature, which uses `bytes32`.
 */
export const MORPHO_BLUE_EVENTS_ABI = [
  'event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)',
  'event Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
  'event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
  'event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)',
  'event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)',
  'event WithdrawCollateral(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets)',
  'event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)',
  'event SetAuthorization(address indexed caller, address indexed authorizer, address indexed authorized, bool newIsAuthorized)',
] as const;

/** Shared `Interface` over {@link MORPHO_BLUE_EVENTS_ABI}. */
export const MORPHO_BLUE_EVENTS_INTERFACE = new Interface(
  MORPHO_BLUE_EVENTS_ABI as unknown as InterfaceAbi,
);

/** The seven events that move a position's words. */
export type MorphoBluePositionEventName =
  | 'Supply'
  | 'Withdraw'
  | 'Borrow'
  | 'Repay'
  | 'SupplyCollateral'
  | 'WithdrawCollateral'
  | 'Liquidate';

/**
 * Where the position holder sits, per event.
 *
 * `holderTopicIndex` is an index into `log.topics`, so `1` is the first indexed
 * param. It is **2 or 3 depending on the event** — see the table at the top of
 * this file. Nothing here should be inferred from the event name.
 */
export type MorphoBluePositionEventDescriptor = {
  name: MorphoBluePositionEventName;
  /** `topics[0]`. */
  topic0: string;
  /** Index into `log.topics` of the account whose position moved. */
  holderTopicIndex: 2 | 3;
  /**
   * The parameter's name in `EventsLib.sol`. `Liquidate` calls it `borrower`;
   * every other event calls it `onBehalf`. Same role either way.
   */
  holderField: 'onBehalf' | 'borrower';
  /**
   * Which legs of the position this event moves. `Liquidate` moves two — it
   * burns borrow shares and seizes collateral in one log.
   */
  kinds: readonly RecipePositionKind[];
  /**
   * Whether `receiver` is an indexed param of this event, i.e. whether value
   * left the position toward a *different* account than the holder. Present on
   * exactly the three events whose holder sits at topic2.
   */
  hasIndexedReceiver: boolean;
};

const topic0Of = (name: string): string => {
  const fragment = MORPHO_BLUE_EVENTS_INTERFACE.getEvent(name);
  if (fragment === null) {
    throw new Error(`morpho: no event fragment named ${name}`);
  }
  return fragment.topicHash;
};

/**
 * The verified layout table. Every filter and decoder in this package reads it
 * rather than hardcoding a topic index.
 */
export const MORPHO_BLUE_POSITION_EVENTS: readonly MorphoBluePositionEventDescriptor[] =
  [
    {
      name: 'Supply',
      topic0: topic0Of('Supply'),
      holderTopicIndex: 3,
      holderField: 'onBehalf',
      kinds: ['supply'],
      hasIndexedReceiver: false,
    },
    {
      name: 'Repay',
      topic0: topic0Of('Repay'),
      holderTopicIndex: 3,
      holderField: 'onBehalf',
      kinds: ['debt'],
      hasIndexedReceiver: false,
    },
    {
      name: 'SupplyCollateral',
      topic0: topic0Of('SupplyCollateral'),
      holderTopicIndex: 3,
      holderField: 'onBehalf',
      kinds: ['collateral'],
      hasIndexedReceiver: false,
    },
    {
      name: 'Liquidate',
      topic0: topic0Of('Liquidate'),
      holderTopicIndex: 3,
      holderField: 'borrower',
      // One log, two legs: `Morpho.liquidate` burns borrow shares AND seizes
      // collateral. A reader that maps event -> single kind loses one of them.
      kinds: ['debt', 'collateral'],
      hasIndexedReceiver: false,
    },
    {
      name: 'Withdraw',
      topic0: topic0Of('Withdraw'),
      holderTopicIndex: 2,
      holderField: 'onBehalf',
      kinds: ['supply'],
      hasIndexedReceiver: true,
    },
    {
      name: 'Borrow',
      topic0: topic0Of('Borrow'),
      holderTopicIndex: 2,
      holderField: 'onBehalf',
      kinds: ['debt'],
      hasIndexedReceiver: true,
    },
    {
      name: 'WithdrawCollateral',
      topic0: topic0Of('WithdrawCollateral'),
      holderTopicIndex: 2,
      holderField: 'onBehalf',
      kinds: ['collateral'],
      hasIndexedReceiver: true,
    },
  ] as const;

const DESCRIPTOR_BY_TOPIC0 = new Map<string, MorphoBluePositionEventDescriptor>(
  MORPHO_BLUE_POSITION_EVENTS.map(d => [d.topic0, d]),
);

/** `topics[0]` of `SetAuthorization`. All three of its addresses are indexed. */
export const MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0 =
  topic0Of('SetAuthorization');

/** Look up the layout descriptor for a log's `topics[0]`, or `undefined`. */
export const morphoBluePositionEventByTopic0 = (
  topic0: string,
): MorphoBluePositionEventDescriptor | undefined =>
  DESCRIPTOR_BY_TOPIC0.get(topic0.toLowerCase());

/**
 * The `topics` array of the two `eth_getLogs` filters that, together, return
 * every position-moving log for `owners` and nothing else.
 *
 * Two rather than one because `onBehalf` sits at topic3 on four of the seven
 * events and topic2 on the other three, and `eth_getLogs` ORs only *within* a
 * topic position. Both are fully server-filtered — this is two cheap queries,
 * not a log sweep.
 *
 * **Do not merge them.** See the trap section at the top of this file: a single
 * query filtering one position over all seven topic0s produced 440 false
 * positives and 440 misses on a measured window, and the false positives
 * attribute an owner's position to whichever executor happened to call.
 *
 * @param owners Already-resolved addresses. Pass them through
 *   `resolvePositionOwnerAddressForRead` first — the read-path validator, which
 *   deliberately allows the relay-adapt address, because refusing to look at an
 *   already-stranded position is how it stays invisible.
 */
export const morphoBluePositionLogTopicFilters = (
  owners: readonly string[],
): readonly (readonly (string | readonly string[] | null)[])[] => {
  if (owners.length === 0) {
    throw new Error(
      'morpho: cannot build a position log filter for an empty owner set — an unfiltered scan would return every Morpho Blue log on the chain',
    );
  }
  const paddedOwners = owners.map(owner => zeroPadValue(getAddress(owner), 32));
  const atTopic3 = MORPHO_BLUE_POSITION_EVENTS.filter(
    d => d.holderTopicIndex === 3,
  ).map(d => d.topic0);
  const atTopic2 = MORPHO_BLUE_POSITION_EVENTS.filter(
    d => d.holderTopicIndex === 2,
  ).map(d => d.topic0);
  return [
    [atTopic3, null, null, paddedOwners],
    [atTopic2, null, paddedOwners, null],
  ];
};

/**
 * One decoded position-moving log.
 *
 * `amount`/`shares` are the figures the event reports for *that operation*. They
 * are deliberately NOT summed into a balance anywhere in this package: interest
 * accrues silently and a scan window has a start, so a replayed sum is wrong by
 * an unbounded amount. Use them for a history view; use
 * `MorphoBlueContract.position` for state.
 */
export type MorphoBluePositionEvent = {
  name: MorphoBluePositionEventName;
  /** The market, `bytes32`, lowercase as it comes off the topic. */
  marketId: string;
  /** The account whose position moved, checksummed. */
  owner: string;
  /** Legs this event moved. `Liquidate` moves two. */
  kinds: readonly RecipePositionKind[];
  /** `msg.sender` on the Blue call. Indexed on four events, in data on three. */
  caller: string;
  /** Present only on `Withdraw` / `Borrow` / `WithdrawCollateral`. */
  receiver?: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
};

/**
 * Decode one log into a {@link MorphoBluePositionEvent}.
 *
 * Returns `undefined` for a log this module does not model, rather than
 * throwing: a scan reads whatever the node returns, and an unmodelled topic0 is
 * a fact about the filter, not a corrupt log. It DOES throw when a log claims to
 * be a modelled event but does not decode — that is a genuine inconsistency
 * (wrong chain, wrong address, a node returning malformed data) and swallowing
 * it would drop a real position sighting.
 *
 * **This does not and cannot check the emitting contract.** It takes only the
 * decodable parts of a log, so a log from some unrelated contract that happens
 * to share a topic0 would decode into a plausible-looking position. Constraining
 * `address` to the Blue singleton is the caller's job; `scanMorphoBluePositionLogs`
 * does it in the `eth_getLogs` filter.
 */
export const decodeMorphoBluePositionLog = (
  log: Pick<
    Log,
    'topics' | 'data' | 'blockNumber' | 'transactionHash' | 'index'
  >,
): MorphoBluePositionEvent | undefined => {
  const topic0 = log.topics[0];
  if (topic0 === undefined) {
    return undefined;
  }
  const descriptor = morphoBluePositionEventByTopic0(topic0);
  if (descriptor === undefined) {
    return undefined;
  }
  // ethers returns `null` when no fragment matches topic0 (unreachable here —
  // the descriptor lookup above already matched) and THROWS when a fragment
  // matches but the payload will not decode. Both are re-raised with the event
  // named: a bare `data out-of-bounds` gives a caller no way to tell which
  // position sighting was lost, and losing one silently is how a held position
  // gets reported as non-existent.
  let parsed;
  try {
    parsed = MORPHO_BLUE_EVENTS_INTERFACE.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
  } catch (cause: unknown) {
    throw new Error(
      `morpho: log with topic0 ${topic0} matches ${
        descriptor.name
      } but did not decode (${
        cause instanceof Error ? cause.message : String(cause)
      }) — refusing to drop a position sighting`,
      { cause },
    );
  }
  if (parsed === null) {
    throw new Error(
      `morpho: log with topic0 ${topic0} matches ${descriptor.name} but did not decode — refusing to drop a position sighting`,
    );
  }
  const holderRaw = parsed.args[descriptor.holderField] as string;
  const receiverRaw = descriptor.hasIndexedReceiver
    ? (parsed.args.receiver as string)
    : undefined;
  return {
    name: descriptor.name,
    marketId: (parsed.args.id as string).toLowerCase(),
    owner: getAddress(holderRaw),
    kinds: descriptor.kinds,
    caller: getAddress(parsed.args.caller as string),
    ...(receiverRaw === undefined ? {} : { receiver: getAddress(receiverRaw) }),
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,
  };
};
