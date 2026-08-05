import chai from 'chai';
import { Interface, JsonRpcProvider, keccak256 } from 'ethers';
import {
  Bundler3CallInput,
  buildBundler3MorphoBundle,
  deriveBundler3Callbacks,
} from '../bundler3-bundle-builder';
import {
  Bundler3Call,
  NO_CALLBACK_HASH,
  bundler3ReenterHash,
  encodeBundler3CallbackBundle,
} from '../bundler3-encoder';
import { BUNDLER3_ADDRESS, MorphoTokenPull } from '../morpho-compiler';

const { expect } = chai;

// ---------------------------------------------------------------------------
// Fixtures below that are labelled MEASURED were run against mainnet with
// eth_call at block 25689563 and the observed result is recorded next to them.
// Bundler3 is 0x6566194141eefa99af43bb5aa71460ca2dc90245; GeneralAdapter1 is
// 0x4a6c312ec70e8747a587ee860a0353cd42be0ae0.
//
// The load-bearing fixture is MAINNET_EXECUTED_FLASHLOAN_ENVELOPE: the exact
// multicall calldata that returned successfully on mainnet. The builder is
// asserted to reproduce it byte-for-byte from plain `{ to, data }` input, which
// is what ties this module's encoding to bytes that are known to execute rather
// than to its own assumptions.
// ---------------------------------------------------------------------------

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret
const GENERAL_ADAPTER1 = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0'; // pragma: allowlist secret
const EXECUTOR = '0x1111111111111111111111111111111111111111'; // pragma: allowlist secret
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'; // pragma: allowlist secret

const MAX_UINT256 = 2n ** 256n - 1n;

const adapter = new Interface([
  'function erc20TransferFrom(address token, address receiver, uint256 amount)',
  'function erc20Transfer(address token, address receiver, uint256 amount)',
  'function morphoFlashLoan(address,uint256,bytes)',
  'function morphoSupply((address,address,address,address,uint256),uint256,uint256,uint256,address,bytes)',
  'function morphoSupplyCollateral((address,address,address,address,uint256),uint256,address,bytes)',
]);

/** `balanceOf(address(0))` — benign, and enough to clear `reenterHash`. */
const BENIGN_CALLDATA = new Interface([
  'function balanceOf(address) view returns (uint256)',
]).encodeFunctionData('balanceOf', [ZERO_ADDRESS]);

const benignCallbackBundle: Bundler3Call[] = [
  {
    to: WETH,
    data: BENIGN_CALLDATA,
    value: 0n,
    skipRevert: false,
    callbackHash: NO_CALLBACK_HASH,
  },
];
const BENIGN_CALLBACK_BLOB = encodeBundler3CallbackBundle(benignCallbackBundle);

const flashLoanCalldata = (blob: string, assets = 10n ** 18n): string =>
  adapter.encodeFunctionData('morphoFlashLoan', [WETH, assets, blob]);

const pullCalldata = (amount: bigint, receiver = GENERAL_ADAPTER1): string =>
  adapter.encodeFunctionData('erc20TransferFrom', [WETH, receiver, amount]);

const wethPull = (amount: bigint, spender = GENERAL_ADAPTER1): MorphoTokenPull => ({
  tokenAddress: WETH,
  decimals: 18n,
  amount,
  spender,
});

/**
 * MEASURED: this exact calldata, sent to Bundler3 with `eth_call`, returned
 * `0x` (success) on mainnet. It is a 1 WETH Morpho Blue flash loan routed
 * Bundler3 -> GeneralAdapter1 -> Blue -> onMorphoFlashLoan -> reenter.
 */
const MAINNET_EXECUTED_FLASHLOAN_ENVELOPE =
  '0x374f435d0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b08547ed299ca1e0be031bc9a19df9a32a663bc3f7f349dc44c13b030c7f7c800000000000000000000000000000000000000000000000000000000000001e4e2975912000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002470a0823100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

const build = (
  calls: readonly Bundler3CallInput[],
  pulls: readonly MorphoTokenPull[] = [],
  allowNonAtomicCalls?: boolean,
  // Most fixtures here use adapter selectors the builder cannot decode, which
  // the builder now refuses by default. Defaulting the opt-out ON keeps those
  // fixtures testing what they were written to test; the two tests that care
  // about the refusal pass it explicitly.
  allowUndecodedCalls = true,
) =>
  buildBundler3MorphoBundle({
    initiator: EXECUTOR,
    calls,
    pulls,
    outputs: [],
    allowNonAtomicCalls,
    allowUndecodedCalls,
  });

describe('bundler3-bundle-builder', () => {
  // -------------------------------------------------------------------------
  // Envelope shape
  // -------------------------------------------------------------------------

  it('Should compile a composition into exactly one relay-adapt call', () => {
    const bundle = build(
      [
        { to: GENERAL_ADAPTER1, data: pullCalldata(10n ** 18n) },
        {
          to: GENERAL_ADAPTER1,
          data: adapter.encodeFunctionData('erc20Transfer', [
            WETH,
            EXECUTOR,
            MAX_UINT256,
          ]),
        },
      ],
      [wethPull(10n ** 18n)],
    );

    // The whole point of the envelope: N Morpho calls reach relay-adapt as ONE
    // entry, so `requireSuccess = false` can only record one CallError and the
    // composition is all-or-nothing again.
    expect(bundle.calls).to.have.lengthOf(1);
    expect(bundle.calls[0].to.toLowerCase()).to.equal(
      BUNDLER3_ADDRESS.toLowerCase(),
    );
    expect(bundle.calls[0].value).to.equal(0n);
    expect(bundle.calls[0].data.slice(0, 10)).to.equal('0x374f435d');
  });

  it('Should reproduce, byte-for-byte, an envelope mainnet executed', () => {
    // Non-vacuous: the builder is fed plain `{ to, data }` and must derive the
    // callbackHash, the zero value and skipRevert=false such that the encoding
    // lands on calldata measured to return successfully on chain. Any drift in
    // struct layout, field order or hash derivation breaks this.
    const bundle = build([
      { to: GENERAL_ADAPTER1, data: flashLoanCalldata(BENIGN_CALLBACK_BLOB) },
    ]);
    expect(bundle.calls[0].data).to.equal(MAINNET_EXECUTED_FLASHLOAN_ENVELOPE);
  });

  it('Should bind the bundle to the resolved executor', () => {
    const bundle = build([
      { to: GENERAL_ADAPTER1, data: flashLoanCalldata(BENIGN_CALLBACK_BLOB) },
    ]);
    expect(bundle.initiator).to.equal(EXECUTOR);
  });

  it('Should reject an empty bundle', () => {
    // MEASURED: multicall([]) reverts 0x558c44fc EmptyBundle().
    expect(() => build([])).to.throw(/no calls/);
  });

  it('Should reject a call that targets Bundler3 itself', () => {
    // MEASURED: a nested multicall reverts 0x36d80ace AlreadyInitiated().
    expect(() =>
      build([{ to: BUNDLER3_ADDRESS, data: BENIGN_CALLDATA }]),
    ).to.throw(/targets Bundler3 itself/);
  });

  it('Should reject a call carrying native value', () => {
    // MEASURED: an inner call with value 1 wei reverts (Bundler3 holds 0 ETH).
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: BENIGN_CALLDATA, value: 1n }]),
    ).to.throw(/carries native value/);
  });

  it('Should reject a call with no selector', () => {
    expect(() => build([{ to: GENERAL_ADAPTER1, data: '0x' }])).to.throw(
      /carries no selector/,
    );
  });

  // -------------------------------------------------------------------------
  // Callback derivation
  // -------------------------------------------------------------------------

  it('Should derive the callbackHash from the embedded wire bytes', () => {
    // MEASURED: the adapter forwards the callback blob to `reenter` VERBATIM.
    // A deliberately non-canonical (but decodable) blob succeeds on chain when
    // the hash is taken over the wire bytes and reverts 0x1a60d856
    // IncorrectReenterHash() when taken over a canonical re-encoding. So the
    // hash must follow the wire, which is what the builder does.
    const derivation = deriveBundler3Callbacks([
      { to: GENERAL_ADAPTER1, data: flashLoanCalldata(BENIGN_CALLBACK_BLOB) },
    ]);
    expect(derivation.calls[0].callbackHash).to.equal(
      keccak256(BENIGN_CALLBACK_BLOB),
    );
    expect(derivation.derived).to.deep.equal([[0]]);
  });

  it('Should derive the callbackHash of a NON-canonically encoded blob from the wire', () => {
    // Same blob, head offset moved 0x20 -> 0x40 with padding. abi.decode still
    // accepts it; the on-chain hash follows these bytes, not their re-encoding.
    const canonical = BENIGN_CALLBACK_BLOB;
    const nonCanonical =
      '0x' +
      '40'.padStart(64, '0') +
      '00'.repeat(32) +
      canonical.slice(2 + 64);
    expect(nonCanonical).to.not.equal(canonical);

    const derivation = deriveBundler3Callbacks([
      { to: GENERAL_ADAPTER1, data: flashLoanCalldata(nonCanonical) },
    ]);
    expect(derivation.calls[0].callbackHash).to.equal(keccak256(nonCanonical));
    expect(derivation.calls[0].callbackHash).to.not.equal(
      keccak256(canonical),
      'a re-encoding would revert IncorrectReenterHash() on chain',
    );
  });

  it('Should reject morphoFlashLoan with an empty callback bundle', () => {
    // MEASURED: morphoFlashLoan with 0x trailing bytes reverts on chain. Under
    // requireSuccess=false that revert is swallowed, so it must be a build-time
    // rejection or it is never surfaced at all.
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: flashLoanCalldata('0x') }]),
    ).to.throw(/empty callback bundle/);
  });

  it('Should reject a callback bundle with zero calls', () => {
    // MEASURED: reenter([]) reverts 0x558c44fc EmptyBundle().
    const emptyBlob = encodeBundler3CallbackBundle([]);
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: flashLoanCalldata(emptyBlob) }]),
    ).to.throw(/EmptyBundle/);
  });

  it('Should reject a caller-supplied callbackHash that disagrees with the wire', () => {
    expect(() =>
      build([
        {
          to: GENERAL_ADAPTER1,
          data: flashLoanCalldata(BENIGN_CALLBACK_BLOB),
          callbackHash: '0x' + 'ab'.repeat(32),
        },
      ]),
    ).to.throw(/does not match its embedded callback bundle/);
  });

  it('Should reject a callbackHash on an entrypoint that takes no callback', () => {
    // MEASURED: a nonzero callbackHash whose target never re-enters reverts
    // 0xe2eea516 MissingExpectedReenter().
    expect(() =>
      build(
        [
          {
            to: GENERAL_ADAPTER1,
            data: pullCalldata(10n ** 18n),
            callbackHash: '0x' + 'ab'.repeat(32),
          },
        ],
        [wethPull(10n ** 18n)],
      ),
    ).to.throw(/takes no callback bundle/);
  });

  it('Should treat empty data on supply/repay as no callback rather than an error', () => {
    // Morpho Blue gates those callbacks on data.length > 0, so empty bytes is a
    // legitimate "no callback" — unlike flashLoan, which always calls back.
    const supply = adapter.encodeFunctionData('morphoSupplyCollateral', [
      [WETH, WETH, ZERO_ADDRESS, ZERO_ADDRESS, 0n],
      1n,
      EXECUTOR,
      '0x',
    ]);
    const derivation = deriveBundler3Callbacks([
      { to: GENERAL_ADAPTER1, data: supply },
    ]);
    expect(derivation.calls[0].callbackHash).to.equal(NO_CALLBACK_HASH);
    expect(derivation.complete).to.equal(true);
  });

  it('Should walk nested callback bundles and validate them too', () => {
    const nestedSkipRevert = encodeBundler3CallbackBundle([
      {
        to: WETH,
        data: BENIGN_CALLDATA,
        value: 0n,
        skipRevert: true,
        callbackHash: NO_CALLBACK_HASH,
      },
    ]);
    expect(() =>
      build([
        { to: GENERAL_ADAPTER1, data: flashLoanCalldata(nestedSkipRevert) },
      ]),
    ).to.throw(/call \[0\.0\] sets skipRevert/);
  });

  it('Should reject native value inside a nested callback bundle', () => {
    const nestedValue = encodeBundler3CallbackBundle([
      {
        to: WETH,
        data: BENIGN_CALLDATA,
        value: 1n,
        skipRevert: false,
        callbackHash: NO_CALLBACK_HASH,
      },
    ]);
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: flashLoanCalldata(nestedValue) }]),
    ).to.throw(/call \[0\.0\] carries native value/);
  });

  // -------------------------------------------------------------------------
  // Atomicity guards
  // -------------------------------------------------------------------------

  it('Should reject skipRevert unless it is opted into', () => {
    // MEASURED: skipRevert=true makes Bundler3 pop and discard the CALL success
    // flag, so a reverting inner call is swallowed — exactly the property the
    // envelope exists to restore.
    expect(() =>
      build(
        [{ to: GENERAL_ADAPTER1, data: pullCalldata(1n), skipRevert: true }],
        [wethPull(1n)],
      ),
    ).to.throw(/sets skipRevert/);
  });

  it('Should allow skipRevert when explicitly opted into', () => {
    const bundle = build(
      [{ to: GENERAL_ADAPTER1, data: pullCalldata(1n), skipRevert: true }],
      [wethPull(1n)],
      true,
    );
    expect(bundle.calls).to.have.lengthOf(1);
  });

  // -------------------------------------------------------------------------
  // Pull cross-check
  // -------------------------------------------------------------------------

  it('Should reject an erc20TransferFrom with no declared pull', () => {
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: pullCalldata(10n ** 18n) }], []),
    ).to.throw(/declares no pull for it/);
  });

  it('Should reject a declared pull that approves the wrong spender', () => {
    expect(() =>
      build(
        [{ to: GENERAL_ADAPTER1, data: pullCalldata(10n ** 18n) }],
        [wethPull(10n ** 18n, WETH)],
      ),
    ).to.throw(/but the declared pull approves/);
  });

  it('Should reject a declared pull that approves too little', () => {
    expect(() =>
      build(
        [{ to: GENERAL_ADAPTER1, data: pullCalldata(10n ** 18n) }],
        [wethPull(10n ** 18n - 1n)],
      ),
    ).to.throw(/only approves/);
  });

  it('Should accept the max-uint256 whole-balance sentinel', () => {
    const bundle = build(
      [{ to: GENERAL_ADAPTER1, data: pullCalldata(MAX_UINT256) }],
      [wethPull(10n ** 18n)],
    );
    expect(bundle.calls).to.have.lengthOf(1);
  });

  it('Should cross-check pulls nested inside a callback bundle', () => {
    // A leveraged open pulls the user's margin from INSIDE the flash-loan
    // callback. If the walk stopped at the top level this would reach the chain
    // with no approval and revert — swallowed.
    const nestedPull = encodeBundler3CallbackBundle([
      {
        to: GENERAL_ADAPTER1,
        data: pullCalldata(10n ** 18n),
        value: 0n,
        skipRevert: false,
        callbackHash: NO_CALLBACK_HASH,
      },
    ]);
    expect(() =>
      build([{ to: GENERAL_ADAPTER1, data: flashLoanCalldata(nestedPull) }], []),
    ).to.throw(/declares no pull for it/);

    // ...and passes once the pull is declared.
    const bundle = build(
      [{ to: GENERAL_ADAPTER1, data: flashLoanCalldata(nestedPull) }],
      [wethPull(10n ** 18n)],
    );
    expect(bundle.calls).to.have.lengthOf(1);
  });

  // -------------------------------------------------------------------------
  // §9: "could not determine" must not collapse into "determined to be none"
  // -------------------------------------------------------------------------

  it('Should report a call whose callback status could not be determined', () => {
    const derivation = deriveBundler3Callbacks([
      {
        to: GENERAL_ADAPTER1,
        data: adapter.encodeFunctionData('erc20Transfer', [
          WETH,
          EXECUTOR,
          1n,
        ]),
      },
    ]);
    expect(derivation.complete).to.equal(false);
    expect(derivation.undecoded).to.have.lengthOf(1);
    expect(derivation.undecoded[0].path).to.deep.equal([0]);
    expect(derivation.undecoded[0].selector).to.equal('0x3790767d');
  });

  it('Should refuse to guess a callbackHash silently', () => {
    // Written as a GAP test pinning a defect: the shipping entrypoint computed
    // the undecoded list and then dropped it, so a caller could not distinguish
    // "every call was positively determined" from "three calls were guessed at
    // a zero callbackHash". Since `NO_CALLBACK_SELECTORS` holds exactly one
    // selector, nearly every real Morpho bundle landed there. Now it throws
    // unless the caller opts in, and this asserts the fix.
    const derivation = deriveBundler3Callbacks([
      {
        to: GENERAL_ADAPTER1,
        data: adapter.encodeFunctionData('erc20Transfer', [WETH, EXECUTOR, 1n]),
      },
    ]);
    expect(derivation.complete).to.equal(false);

    const undecodable = [
      {
        to: GENERAL_ADAPTER1,
        data: adapter.encodeFunctionData('erc20Transfer', [WETH, EXECUTOR, 1n]),
      },
    ];
    // Throws, and names both the path and the selector so the caller can decide.
    expect(() =>
      buildBundler3MorphoBundle({
        initiator: EXECUTOR,
        calls: undecodable,
        pulls: [],
        outputs: [],
      }),
    ).to.throw(/cannot decode/);

    // The opt-out is explicit, mirroring `allowNonAtomicCalls` — a caller who
    // has established that none of these re-enters Bundler3 can proceed.
    const bundle = build(undecodable, [], undefined, true);
    expect(bundle.calls).to.have.lengthOf(1);
    expect(bundle).to.not.have.property('undecoded');
    expect(bundle).to.not.have.property('complete');
  });

  it('Should reject a zero-address target rather than succeed at nothing', () => {
    // Bundler3 does not check extcodesize, so a CALL to an address with no code
    // RETURNS SUCCESS — the envelope reports success having executed nothing, at
    // full gas and both RAILGUN fees. That is the exact swallowed-failure class
    // this module exists to remove, and it is free to reject at build time.
    // Written as a GAP test pinning the permissive behaviour; now asserts the fix.
    expect(() =>
      build([{ to: ZERO_ADDRESS, data: BENIGN_CALLDATA }]),
    ).to.throw(/zero address/);
  });

  // -------------------------------------------------------------------------
  // Encoder helper correctness
  // -------------------------------------------------------------------------

  it('Should hash the reenter binding in the order the contract stores it', () => {
    // MEASURED on mainnet (publicnode AND tenderly, identical result) by
    // installing a probe contract via an eth_call state override that reads
    // Bundler3's transient `reenterHash()` from inside a live multicall and
    // reverts with it. The draft shipped these operands reversed; the reversed
    // form is also a plausible-looking 32-byte value, so only pinning it to the
    // measured word catches the mistake.
    const probeTo = '0x00000000000000000000000000000000000b0be0'; // pragma: allowlist secret
    const probeHash = `0x${'ab'.repeat(32)}`;
    const MEASURED_ON_CHAIN =
      '0x36b3cab083402b7dc966a1ff0dde8a12889a728b0b69999709bab84cc3d86371';

    expect(bundler3ReenterHash(probeHash, probeTo)).to.equal(MEASURED_ON_CHAIN);
    expect(keccak256(`0x${probeTo.slice(2)}${probeHash.slice(2)}`)).to.equal(
      MEASURED_ON_CHAIN,
    );
    expect(keccak256(`0x${probeHash.slice(2)}${probeTo.slice(2)}`)).to.not.equal(
      MEASURED_ON_CHAIN,
    );
  });

  // -------------------------------------------------------------------------
  // Executability against mainnet
  // -------------------------------------------------------------------------

  describe('mainnet execution [requires RUN_BUNDLER3_MAINNET_TESTS=1]', function () {
    this.timeout(60_000);

    // Deliberately NOT RUN_FORK_TESTS: that flag boots the anvil harness in
    // src/test/setup.test.ts, and these are plain public-RPC eth_calls.
    if (process.env.RUN_BUNDLER3_MAINNET_TESTS === undefined) {
      it.skip('skipped — set RUN_BUNDLER3_MAINNET_TESTS=1 to run', () => {});
      return;
    }

    const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com');

    it('Should produce an envelope that executes on mainnet', async () => {
      const bundle = build([
        { to: GENERAL_ADAPTER1, data: flashLoanCalldata(BENIGN_CALLBACK_BLOB) },
      ]);
      const result = await provider.send('eth_call', [
        { from: EXECUTOR, to: bundle.calls[0].to, data: bundle.calls[0].data },
        'latest',
      ]);
      expect(result).to.equal('0x');
    });

    /**
     * The load-bearing claim, measured end to end through the builder: this is
     * the ONLY reason the envelope is worth its extra hop. A doomed inner call
     * (the executor holds no WETH and has granted no allowance, so the adapter's
     * `transferFrom` reverts) must take the whole envelope down with it.
     */
    const doomedCall = { to: GENERAL_ADAPTER1, data: pullCalldata(10n ** 18n) };

    const ethCall = async (data: string) => {
      try {
        return {
          ok: true as const,
          value: (await provider.send('eth_call', [
            { from: EXECUTOR, to: BUNDLER3_ADDRESS, data },
            'latest',
          ])) as string,
        };
      } catch (err) {
        return { ok: false as const, err };
      }
    };

    it('Should propagate an inner revert out of the envelope (skipRevert=false)', async () => {
      const bundle = build([doomedCall], [wethPull(10n ** 18n)]);
      const result = await ethCall(bundle.calls[0].data);
      expect(result.ok).to.equal(
        false,
        'a failing inner call must revert the whole multicall — this is the atomicity relay-adapt strips',
      );
    });

    it('Should swallow the same inner revert when skipRevert=true', async () => {
      // The negative control. Without it the test above proves nothing: it
      // could be failing for any reason at all.
      const bundle = build(
        [{ ...doomedCall, skipRevert: true }],
        [wethPull(10n ** 18n)],
        true,
      );
      const result = await ethCall(bundle.calls[0].data);
      expect(result.ok).to.equal(
        true,
        'skipRevert=true must swallow the inner revert',
      );
      expect(result.ok && result.value).to.equal('0x');
    });
  });
});
