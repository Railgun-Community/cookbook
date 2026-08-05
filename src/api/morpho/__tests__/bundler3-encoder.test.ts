import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Interface, concat, dataSlice, keccak256 } from 'ethers';
import {
  BUNDLER3_CONTRACT_ADDRESS,
  BUNDLER3_ERROR_SELECTORS,
  BUNDLER3_INTERFACE,
  Bundler3Call,
  NO_CALLBACK_HASH,
  bundler3CallbackHash,
  bundler3ReenterHash,
  decodeBundler3CallbackBundle,
  describeBundler3Revert,
  encodeBundler3CallbackBundle,
  encodeBundler3Multicall,
  encodeBundler3Reenter,
} from '../bundler3-encoder';
import { BUNDLER3_ADDRESS } from '../morpho-compiler';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// Everything asserted here was read off the deployed Bundler3 at
// 0x6566194141eefa99af43bb5aa71460ca2dc90245 and then exercised with eth_call
// against mainnet at block 25688994.
//
// The load-bearing fixture is MAINNET_ACCEPTED_MULTICALL_CALLDATA: the exact
// bytes of a `multicall` that ran a 1 WETH Morpho Blue flash loan through
// GeneralAdapter1 and back out through `reenter`, and returned successfully.
// It is recorded rather than recomputed so that a change to how this module
// encodes a bundle stops matching calldata that is known to execute. Three
// corruptions of the same bundle were also measured and each reverted with a
// different Bundler3 error, so the acceptance is not vacuous:
//
//   callbackHash = 0                 -> IncorrectReenterHash()
//   callbackHash with one bit fipped -> IncorrectReenterHash()
//   callback blob replaced by junk   -> adapter's abi.decode reverts
//   callback bundle empty            -> EmptyBundle()
// ---------------------------------------------------------------------------

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret
const GENERAL_ADAPTER1 = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0'; // pragma: allowlist secret

/** `balanceOf(address(0))` — a benign call, enough to clear `reenterHash`. */
const BENIGN_CALLDATA = new Interface([
  'function balanceOf(address) view returns (uint256)',
]).encodeFunctionData('balanceOf', [
  '0x0000000000000000000000000000000000000000',
]);

const callbackBundle: Bundler3Call[] = [
  {
    to: WETH,
    data: BENIGN_CALLDATA,
    value: 0n,
    skipRevert: false,
    callbackHash: NO_CALLBACK_HASH,
  },
];

const MAINNET_ACCEPTED_CALLBACK_HASH =
  '0x0b08547ed299ca1e0be031bc9a19df9a32a663bc3f7f349dc44c13b030c7f7c8';

const MAINNET_ACCEPTED_MULTICALL_CALLDATA =
  '0x374f435d0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b08547ed299ca1e0be031bc9a19df9a32a663bc3f7f349dc44c13b030c7f7c800000000000000000000000000000000000000000000000000000000000001e4e2975912000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002470a0823100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

const flashLoanCalldata = new Interface([
  'function morphoFlashLoan(address,uint256,bytes)',
]).encodeFunctionData('morphoFlashLoan', [
  WETH,
  10n ** 18n,
  encodeBundler3CallbackBundle(callbackBundle),
]);

const outerBundle: Bundler3Call[] = [
  {
    to: GENERAL_ADAPTER1,
    data: flashLoanCalldata,
    value: 0n,
    skipRevert: false,
    callbackHash: MAINNET_ACCEPTED_CALLBACK_HASH,
  },
];

describe('bundler3-encoder', () => {
  it('Should match the deployed dispatch table', () => {
    // Exactly these four selectors appear in the deployed bytecode's dispatch.
    expect(BUNDLER3_INTERFACE.getFunction('multicall')?.selector).to.equal(
      '0x374f435d',
    );
    expect(BUNDLER3_INTERFACE.getFunction('reenter')?.selector).to.equal(
      '0x803a7fba',
    );
    expect(BUNDLER3_INTERFACE.getFunction('initiator')?.selector).to.equal(
      '0x5c39fcc1',
    );
    expect(BUNDLER3_INTERFACE.getFunction('reenterHash')?.selector).to.equal(
      '0xe69fe134',
    );
  });

  it('Should agree with the compiler on the Bundler3 address', () => {
    expect(BUNDLER3_CONTRACT_ADDRESS.toLowerCase()).to.equal(
      BUNDLER3_ADDRESS.toLowerCase(),
    );
  });

  it('Should hash the callback bundle to the value mainnet accepted', () => {
    const blob = encodeBundler3CallbackBundle(callbackBundle);
    expect(bundler3CallbackHash(blob)).to.equal(MAINNET_ACCEPTED_CALLBACK_HASH);
    // The hash is over the wire bytes, which is what `reenter` re-derives from
    // its own `msg.data[4:]`.
    expect(bundler3CallbackHash(blob)).to.equal(keccak256(blob));
  });

  it('Should encode the exact multicall calldata mainnet executed', () => {
    expect(encodeBundler3Multicall(outerBundle)).to.equal(
      MAINNET_ACCEPTED_MULTICALL_CALLDATA,
    );
  });

  it('Should encode a callback bundle identically to reenter calldata', () => {
    // `reenter`'s msg.data[4:] IS the blob embedded in the adapter call — the
    // contract hashes one and compares against a hash of the other, so any
    // divergence between these two encodings is an on-chain revert.
    const blob = encodeBundler3CallbackBundle(callbackBundle);
    const reenterCalldata = encodeBundler3Reenter(callbackBundle);
    expect(reenterCalldata.slice(0, 10)).to.equal('0x803a7fba');
    expect(`0x${reenterCalldata.slice(10)}`).to.equal(blob);
  });

  it('Should round-trip a callback bundle', () => {
    const decoded = decodeBundler3CallbackBundle(
      encodeBundler3CallbackBundle(outerBundle),
    );
    expect(decoded).to.deep.equal(outerBundle);
  });

  it('Should reject a callback blob that is not a Call[]', () => {
    // Measured: a morphoFlashLoan carrying 0xdeadbeef as its callback blob
    // reverts inside the adapter's own abi.decode.
    expect(() => decodeBundler3CallbackBundle('0xdeadbeef')).to.throw();
  });

  it('Should reproduce the reenter hash the contract actually stores', () => {
    // MEASURED, not inferred. A probe contract installed with an eth_call state
    // override was driven as a Bundler3 `to` with callbackHash 0xabab..ab; from
    // inside the live multicall it read the transient `reenterHash()` and
    // reverted with it. publicnode and tenderly returned the same word:
    const PROBE_TO = '0x00000000000000000000000000000000000b0be0'; // pragma: allowlist secret
    const PROBE_CALLBACK_HASH = `0x${'ab'.repeat(32)}`;
    const MEASURED_REENTER_HASH =
      '0x36b3cab083402b7dc966a1ff0dde8a12889a728b0b69999709bab84cc3d86371';

    expect(bundler3ReenterHash(PROBE_CALLBACK_HASH, PROBE_TO)).to.equal(
      MEASURED_REENTER_HASH,
    );

    // The address is hashed FIRST. Pinning the byte order matters because the
    // reversed concatenation is also a well-formed 32-byte value that still
    // differs per target — so "two targets hash differently" is not evidence of
    // anything, and was the previous (vacuous) form of this test.
    expect(keccak256(concat([dataSlice(PROBE_TO, 0, 20), PROBE_CALLBACK_HASH])))
      .to.equal(MEASURED_REENTER_HASH);
    expect(keccak256(concat([PROBE_CALLBACK_HASH, dataSlice(PROBE_TO, 0, 20)])))
      .to.not.equal(MEASURED_REENTER_HASH);
  });

  it('Should bind the reenter hash to the call target', () => {
    // The stored reenterHash commits to `to`, so only that address can satisfy
    // it. This is why a callback bundle cannot be replayed against a different
    // adapter.
    const boundToAdapter = bundler3ReenterHash(
      MAINNET_ACCEPTED_CALLBACK_HASH,
      GENERAL_ADAPTER1,
    );
    const boundToWeth = bundler3ReenterHash(
      MAINNET_ACCEPTED_CALLBACK_HASH,
      WETH,
    );
    expect(boundToAdapter).to.not.equal(boundToWeth);
    expect(boundToAdapter).to.have.lengthOf(66);
  });

  it('Should name Bundler3 revert payloads and only those', () => {
    expect(BUNDLER3_ERROR_SELECTORS['0x36d80ace']).to.equal(
      'AlreadyInitiated()',
    );
    expect(describeBundler3Revert('0x1a60d856')).to.equal(
      'IncorrectReenterHash()',
    );
    expect(describeBundler3Revert('0xe2eea516')).to.equal(
      'MissingExpectedReenter()',
    );
    expect(describeBundler3Revert('0x558c44fc')).to.equal('EmptyBundle()');
    // Not-a-Bundler3-error must stay distinguishable from no-error: an adapter
    // or token revert is still a revert.
    expect(describeBundler3Revert('0x08094908')).to.equal(undefined);
    expect(describeBundler3Revert('0x')).to.equal(undefined);
  });
});
