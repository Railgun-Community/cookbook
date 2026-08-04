import { expect } from 'chai';
import { getAddress, id as keccakId } from 'ethers';
import {
  MORPHO_BLUE_EVENTS_INTERFACE,
  MORPHO_BLUE_POSITION_EVENTS,
  MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0,
  MorphoBluePositionEventName,
  decodeMorphoBluePositionLog,
  morphoBluePositionEventByTopic0,
  morphoBluePositionLogTopicFilters,
} from '../morpho-blue-events';

// ---------------------------------------------------------------------------
// Every log below is a REAL mainnet log, captured verbatim from the Morpho Blue
// singleton (0xBBBB…FFCb) over blocks 25,680,938–25,684,537. They are the whole
// point of this file: a fixture the test author invented would encode the same
// belief the code encodes, and prove nothing about the chain.
//
// For each event the fixture was chosen so that the account at topic2 DIFFERS
// from the account at topic3 wherever such a log exists — the only shape that
// can distinguish `caller` from `onBehalf`. Where the two coincide (a
// self-custody operation) the log proves nothing about ordering, which is
// exactly the blind spot that makes this bug survive testing under EIP-7702
// self-custody.
//
// The position-holder assignment below was additionally confirmed *semantically*
// against chain state: `position(id, addr)` was read at the emitting block and
// the block before, and the account whose words actually moved is the one
// asserted here.
// ---------------------------------------------------------------------------

type RawLog = {
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  index: number;
};

/**
 * `Supply` — caller `0x4095…0077` (a router contract), holder `0x9d3c…d623`.
 * Holder at topic3.
 */
const SUPPLY_LOG: RawLog = {
  topics: [
    '0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0',
    '0x973e9dd45799efe8775417bcc420a3ab84a583587b2108985746e2fe201d0c83',
    '0x0000000000000000000000004095f064b8d3c3548a3bebfd0bbfd04750e30077',
    '0x0000000000000000000000009d3c73222f2a4c0f9ced848d669393340db7d623',
  ],
  data: '0x000000000000000000000000000000000000000000000000000000012a05dc010000000000000000000000000000000000000000000000000010bc0b394bc8d2',
  blockNumber: 25684347,
  transactionHash:
    '0x1743e315fe543f5e49d19f0a4a78a067b5864716915f611dfc55d60a5a9f8099',
  index: 120,
};

/**
 * `Withdraw` — caller `0x4095…0077` sits in DATA, holder `0xf7c0…ae1a` at
 * topic2. The decisive fixture: the same router that occupies topic2 on a
 * `Supply` occupies the first data word here.
 */
const WITHDRAW_LOG: RawLog = {
  topics: [
    '0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf',
    '0x43e925e52d7873fa8acac90dd5f246087d55b3a34c344b71884a6352491ff459',
    '0x000000000000000000000000f7c04a39e47c7ea9d6888f9389ea85846e22ae1a',
    '0x000000000000000000000000f7c04a39e47c7ea9d6888f9389ea85846e22ae1a',
  ],
  data: '0x0000000000000000000000004095f064b8d3c3548a3bebfd0bbfd04750e30077000000000000000000000000000000000000000000000000000000025e74b8ef000000000000000000000000000000000000000000000000002099077d4dad75',
  blockNumber: 25684525,
  transactionHash:
    '0x55117f3be586f24dc44d368fbd233ef9427042a71caf3b2e7f813f0fc6e299c9',
  index: 1317,
};

/** `Borrow` — holder `0x4f03…e130` at topic2, receiver `0x4a6c…0ae0` at topic3. */
const BORROW_LOG: RawLog = {
  topics: [
    '0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43',
    '0x975c6e8b71073a82216ae464bc44f67d71988450d2542d635d88bc78fca344b1',
    '0x0000000000000000000000004f034986471dfeeeae26d10bc758a9b51a0de130',
    '0x0000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae0',
  ],
  data: '0x0000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae0000000000000000000000000000000000000000000000000000000012376b0fe00000000000000000000000000000000000000000000000000115975d723ca5e',
  blockNumber: 25683703,
  transactionHash:
    '0xe751da70b693eabd66c3e201767e54e3385fb06a2d9b39a3753fa4f9de8617e7',
  index: 1134,
};

/** `Repay` — caller `0x4a6c…0ae0` at topic2, holder `0x9048…6c55` at topic3. */
const REPAY_LOG: RawLog = {
  topics: [
    '0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09',
    '0xbf0432567b44ef5ce013ffcd7dd756c522252503f7986a406e780715b32c74fc',
    '0x0000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae0',
    '0x00000000000000000000000090489a1f557fba381660192836446db659186c55',
  ],
  data: '0x000000000000000000000000000000000000000000000000000000072158006e000000000000000000000000000000000000000000000000006b0b8594542b95',
  blockNumber: 25684288,
  transactionHash:
    '0xed3f1d3b82f938a800bc3d0c0dcb096c982c36caafcaba7c58cf5e5b8ea1c26a',
  index: 134,
};

/**
 * `SupplyCollateral` — caller `0x4a6c…0ae0` at topic2, holder `0x1f46…94f7` at
 * topic3. This is the delegated shape the owner/receiver split exists for.
 */
const SUPPLY_COLLATERAL_LOG: RawLog = {
  topics: [
    '0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184',
    '0x3f5ae84a3b35a3533114b30e6e8c61a3d6469828f237a55e13e4c6a187391574',
    '0x0000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae0',
    '0x0000000000000000000000001f46f4d2ba8506411a28e95dfd55a1cf7f5994f7',
  ],
  data: '0x00000000000000000000000000000000000000000000000000000000000f4240',
  blockNumber: 25684324,
  transactionHash:
    '0xdc75dc6c21566a677c78e60ab5f700cf4d0a37e3fb89200e7de9cd2d617a54b5',
  index: 50,
};

/**
 * `WithdrawCollateral` — holder `0x637a…6903` at topic2, receiver `0x950f…a86f`
 * at topic3, caller `0x4c24…e07f` in data. All three roles distinct: the single
 * best fixture in the set.
 */
const WITHDRAW_COLLATERAL_LOG: RawLog = {
  topics: [
    '0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142',
    '0xf78b7d3a62437f78097745a5e3117a50c56a02ec5f072cba8d988a129c6d4fb6',
    '0x000000000000000000000000637a8f99acbd43f89b6afca840f629f125996903',
    '0x000000000000000000000000950fd558f47e234a2fde23b7d61f7ccdbcb4a86f',
  ],
  data: '0x0000000000000000000000004c2401b490cec2ac30f54c9c4f3c65c2677ae07f0000000000000000000000000000000000000000000000000002b90cdf75bfdd',
  blockNumber: 25684489,
  transactionHash:
    '0x5f31521c0c250198cb04c2036f2034c6d64c11443282b0ea921cf9a472af8984',
  index: 665,
};

/**
 * `Liquidate` — liquidator `0xa8b7…47fc` at topic2, borrower `0xf0cc…7997` at
 * topic3. Confirmed on chain: only the topic3 account's `borrowShares` and
 * `collateral` moved.
 */
const LIQUIDATE_LOG: RawLog = {
  topics: [
    '0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41',
    '0xba761af4134efb0855adfba638945f454f0a704af11fc93439e20c7c5ebab942',
    '0x000000000000000000000000a8b7643a8331fe18fb35642646aea7e993a747fc',
    '0x000000000000000000000000f0cc0353004560afe58751e3f088951b06ac7997',
  ],
  data: '0x00000000000000000000000000000000000000000000000000242b00ef24f4eb0000000000000000000000000000000000000000000001d6140abef6a36f4001000000000000000000000000000000000000000000000000002222eb35ef46ae00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  blockNumber: 25681179,
  transactionHash:
    '0xf917657130dc4c09b25cbeec8030a2aa7b6e7bd4b8b0301958ebf03f2a823ab1',
  index: 514,
};

/** A real `AccrueInterest` log — an event this module deliberately does not model. */
const ACCRUE_INTEREST_TOPIC0 =
  '0x9d9bd501d0657d7dfe415f779a620a62b78bc508ddc0891fbbd8b7ac0f8fce87';

const ROUTER = getAddress('0x4095f064b8d3c3548a3bebfd0bbfd04750e30077');
const BUNDLER = getAddress('0x4a6c312ec70e8747a587ee860a0353cd42be0ae0');

describe('Morpho Blue event fragments — topic layout', () => {
  it('matches the deployed singleton topic0 for every modelled event', () => {
    // Computed from the canonical signature, so a transcription slip in the
    // fragment strings changes the hash and fails here rather than silently
    // producing a filter that matches nothing.
    const expected: Record<MorphoBluePositionEventName, string> = {
      Supply: keccakId('Supply(bytes32,address,address,uint256,uint256)'),
      Withdraw: keccakId(
        'Withdraw(bytes32,address,address,address,uint256,uint256)',
      ),
      Borrow: keccakId(
        'Borrow(bytes32,address,address,address,uint256,uint256)',
      ),
      Repay: keccakId('Repay(bytes32,address,address,uint256,uint256)'),
      SupplyCollateral: keccakId(
        'SupplyCollateral(bytes32,address,address,uint256)',
      ),
      WithdrawCollateral: keccakId(
        'WithdrawCollateral(bytes32,address,address,address,uint256)',
      ),
      Liquidate: keccakId(
        'Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)',
      ),
    };
    for (const descriptor of MORPHO_BLUE_POSITION_EVENTS) {
      expect(descriptor.topic0, descriptor.name).to.equal(
        expected[descriptor.name],
      );
    }
    expect(MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0).to.equal(
      keccakId('SetAuthorization(address,address,address,bool)'),
    );
  });

  it('records the position holder at topic3 on four events and topic2 on three', () => {
    // The finding this whole module turns on. If Morpho ever redeploys with a
    // uniform layout this test is the thing that says so.
    const byName = new Map(
      MORPHO_BLUE_POSITION_EVENTS.map(d => [d.name, d.holderTopicIndex]),
    );
    expect(byName.get('Supply')).to.equal(3);
    expect(byName.get('Repay')).to.equal(3);
    expect(byName.get('SupplyCollateral')).to.equal(3);
    expect(byName.get('Liquidate')).to.equal(3);
    expect(byName.get('Withdraw')).to.equal(2);
    expect(byName.get('Borrow')).to.equal(2);
    expect(byName.get('WithdrawCollateral')).to.equal(2);
  });

  it('agrees with the fragment ABI about which params are indexed', () => {
    // Guards against the table and the fragments drifting apart: the table is
    // what the filters read, the fragments are what the decoder reads, and a
    // disagreement would filter on one layout and decode with another.
    for (const descriptor of MORPHO_BLUE_POSITION_EVENTS) {
      const fragment = MORPHO_BLUE_EVENTS_INTERFACE.getEvent(descriptor.name);
      expect(fragment, descriptor.name).to.not.equal(null);
      if (fragment === null) {
        continue;
      }
      const indexed = fragment.inputs.filter(input => input.indexed);
      const holderIndex = indexed.findIndex(
        input => input.name === descriptor.holderField,
      );
      expect(holderIndex + 1, `${descriptor.name} holder topic index`).to.equal(
        descriptor.holderTopicIndex,
      );
      const receiver = fragment.inputs.find(input => input.name === 'receiver');
      expect(
        receiver !== undefined && receiver.indexed === true,
        `${descriptor.name} hasIndexedReceiver`,
      ).to.equal(descriptor.hasIndexedReceiver);
    }
  });

  it('maps Liquidate to BOTH legs it moves', () => {
    const liquidate = MORPHO_BLUE_POSITION_EVENTS.find(
      d => d.name === 'Liquidate',
    );
    expect(liquidate?.kinds).to.have.members(['debt', 'collateral']);
  });
});

describe('Morpho Blue event fragments — decoding real mainnet logs', () => {
  it('reads the holder off topic3 for Supply / Repay / SupplyCollateral', () => {
    const supply = decodeMorphoBluePositionLog(SUPPLY_LOG);
    expect(supply?.name).to.equal('Supply');
    expect(supply?.owner).to.equal(
      getAddress('0x9d3c73222f2a4c0f9ced848d669393340db7d623'),
    );
    expect(supply?.caller).to.equal(ROUTER);
    expect(supply?.kinds).to.deep.equal(['supply']);
    expect(supply?.receiver).to.equal(undefined);

    const repay = decodeMorphoBluePositionLog(REPAY_LOG);
    expect(repay?.owner).to.equal(
      getAddress('0x90489a1f557fba381660192836446db659186c55'),
    );
    expect(repay?.caller).to.equal(BUNDLER);
    expect(repay?.kinds).to.deep.equal(['debt']);

    const supplyCollateral = decodeMorphoBluePositionLog(SUPPLY_COLLATERAL_LOG);
    expect(supplyCollateral?.owner).to.equal(
      getAddress('0x1f46f4d2ba8506411a28e95dfd55a1cf7f5994f7'),
    );
    expect(supplyCollateral?.caller).to.equal(BUNDLER);
    expect(supplyCollateral?.kinds).to.deep.equal(['collateral']);
  });

  it('reads the holder off topic2, and the caller out of DATA, for Withdraw / Borrow / WithdrawCollateral', () => {
    const withdraw = decodeMorphoBluePositionLog(WITHDRAW_LOG);
    expect(withdraw?.owner).to.equal(
      getAddress('0xf7c04a39e47c7ea9d6888f9389ea85846e22ae1a'),
    );
    // The decisive assertion. `0x4095…0077` is the router; it sits at topic2 on
    // the Supply fixture above and in the first data word here. A reader that
    // assumed a uniform layout would report the router as the position holder.
    expect(withdraw?.caller).to.equal(ROUTER);
    expect(withdraw?.receiver).to.equal(
      getAddress('0xf7c04a39e47c7ea9d6888f9389ea85846e22ae1a'),
    );

    const borrow = decodeMorphoBluePositionLog(BORROW_LOG);
    expect(borrow?.owner).to.equal(
      getAddress('0x4f034986471dfeeeae26d10bc758a9b51a0de130'),
    );
    expect(borrow?.receiver).to.equal(BUNDLER);
    expect(borrow?.kinds).to.deep.equal(['debt']);

    const withdrawCollateral = decodeMorphoBluePositionLog(
      WITHDRAW_COLLATERAL_LOG,
    );
    // Three distinct roles in one log: holder, receiver, caller.
    expect(withdrawCollateral?.owner).to.equal(
      getAddress('0x637a8f99acbd43f89b6afca840f629f125996903'),
    );
    expect(withdrawCollateral?.receiver).to.equal(
      getAddress('0x950fd558f47e234a2fde23b7d61f7ccdbcb4a86f'),
    );
    expect(withdrawCollateral?.caller).to.equal(
      getAddress('0x4c2401b490cec2ac30f54c9c4f3c65c2677ae07f'),
    );
  });

  it('reads the BORROWER, not the liquidator, off a Liquidate', () => {
    const liquidate = decodeMorphoBluePositionLog(LIQUIDATE_LOG);
    // Confirmed on chain: only this account's position words moved.
    expect(liquidate?.owner).to.equal(
      getAddress('0xf0cc0353004560afe58751e3f088951b06ac7997'),
    );
    expect(liquidate?.caller).to.equal(
      getAddress('0xa8b7643a8331fe18fb35642646aea7e993a747fc'),
    );
    expect(liquidate?.kinds).to.have.members(['debt', 'collateral']);
  });

  it('lowercases the market id and checksums every address', () => {
    const decoded = decodeMorphoBluePositionLog(SUPPLY_COLLATERAL_LOG);
    expect(decoded?.marketId).to.equal(
      '0x3f5ae84a3b35a3533114b30e6e8c61a3d6469828f237a55e13e4c6a187391574',
    );
    expect(decoded?.owner).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(decoded?.owner).to.not.equal(decoded?.owner.toLowerCase());
  });

  it('returns undefined for an event it does not model, rather than guessing', () => {
    expect(
      decodeMorphoBluePositionLog({
        ...SUPPLY_LOG,
        topics: [ACCRUE_INTEREST_TOPIC0, SUPPLY_LOG.topics[1]],
        data: '0x'.padEnd(2 + 3 * 64, '0'),
      }),
    ).to.equal(undefined);
    expect(morphoBluePositionEventByTopic0(ACCRUE_INTEREST_TOPIC0)).to.equal(
      undefined,
    );
  });

  it('throws rather than dropping a log that claims a modelled topic0 but will not decode', () => {
    // A dropped sighting is a position a scanner reports as non-existent.
    expect(() =>
      decodeMorphoBluePositionLog({
        ...SUPPLY_LOG,
        // topic0 says Supply; the rest is truncated.
        topics: [SUPPLY_LOG.topics[0]],
        data: '0x',
      }),
    ).to.throw(/did not decode/);
  });
});

describe('Morpho Blue position log filters', () => {
  const OWNER_A = getAddress('0x1f46f4d2ba8506411a28e95dfd55a1cf7f5994f7');
  const OWNER_B = getAddress('0x637a8f99acbd43f89b6afca840f629f125996903');

  it('produces exactly two filters, splitting the events by holder topic index', () => {
    const filters = morphoBluePositionLogTopicFilters([OWNER_A, OWNER_B]);
    expect(filters.length).to.equal(2);

    const [atTopic3, atTopic2] = filters;
    // Filter A: holder at topic3 -> positions 1 and 2 are wildcards.
    expect(atTopic3[1]).to.equal(null);
    expect(atTopic3[2]).to.equal(null);
    expect(atTopic3[3]).to.deep.equal([
      `0x000000000000000000000000${OWNER_A.slice(2).toLowerCase()}`,
      `0x000000000000000000000000${OWNER_B.slice(2).toLowerCase()}`,
    ]);
    expect(atTopic3[0]).to.have.members([
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'Supply')?.topic0,
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'Repay')?.topic0,
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'SupplyCollateral')
        ?.topic0,
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'Liquidate')?.topic0,
    ]);

    // Filter B: holder at topic2 -> position 3 is a wildcard (it is `receiver`).
    expect(atTopic2[1]).to.equal(null);
    expect(atTopic2[3]).to.equal(null);
    expect(atTopic2[2]).to.deep.equal(atTopic3[3]);
    expect(atTopic2[0]).to.have.members([
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'Withdraw')?.topic0,
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'Borrow')?.topic0,
      MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === 'WithdrawCollateral')
        ?.topic0,
    ]);
  });

  it('partitions the seven events with no overlap and no omission', () => {
    const [atTopic3, atTopic2] = morphoBluePositionLogTopicFilters([OWNER_A]);
    const a = new Set(atTopic3[0] as readonly string[]);
    const b = new Set(atTopic2[0] as readonly string[]);
    expect(a.size + b.size).to.equal(MORPHO_BLUE_POSITION_EVENTS.length);
    for (const topic of a) {
      expect(b.has(topic), 'no event may appear in both filters').to.equal(
        false,
      );
    }
    for (const descriptor of MORPHO_BLUE_POSITION_EVENTS) {
      expect(
        a.has(descriptor.topic0) || b.has(descriptor.topic0),
        `${descriptor.name} must appear in one filter`,
      ).to.equal(true);
    }
  });

  it('refuses an empty owner set instead of building an unfiltered chain-wide scan', () => {
    expect(() => morphoBluePositionLogTopicFilters([])).to.throw(
      /empty owner set/,
    );
  });

  // -------------------------------------------------------------------------
  // The control that must fail: this is what the naive single-query design does.
  // -------------------------------------------------------------------------
  it('would misattribute in both directions if the two filters were merged', () => {
    const [atTopic3, atTopic2] = morphoBluePositionLogTopicFilters([BUNDLER]);
    const merged = new Set([
      ...(atTopic3[0] as readonly string[]),
      ...(atTopic2[0] as readonly string[]),
    ]);
    const bundlerPadded = `0x000000000000000000000000${BUNDLER.slice(
      2,
    ).toLowerCase()}`;

    // A merged filter matching the bundler at topic2 over all seven topic0s
    // WOULD match this real SupplyCollateral log — in which the bundler is only
    // the caller and `0x1f46…94f7` is the holder. Under EIP-7702 self-custody
    // the two coincide and the bug is invisible; the moment an executor acts
    // for a durable owner it credits the executor with the owner's position.
    expect(merged.has(SUPPLY_COLLATERAL_LOG.topics[0])).to.equal(true);
    expect(SUPPLY_COLLATERAL_LOG.topics[2]).to.equal(bundlerPadded);
    const decoded = decodeMorphoBluePositionLog(SUPPLY_COLLATERAL_LOG);
    expect(decoded?.owner).to.not.equal(BUNDLER);
    expect(decoded?.caller).to.equal(BUNDLER);

    // And the shipped two-filter design does NOT match it, because
    // SupplyCollateral only ever appears in the topic3 filter.
    expect(atTopic2[0] as readonly string[]).to.not.include(
      SUPPLY_COLLATERAL_LOG.topics[0],
    );
  });
});
