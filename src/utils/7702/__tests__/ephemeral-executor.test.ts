import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  makeEphemeralExecutor,
  resolveExecutorAddress,
  assertValidExecutorAddress,
} from '../ephemeral-executor';
import { spentToExecutor } from '../route-to-executor';

chai.use(chaiAsPromised);
const { expect } = chai;

// Lowercased on purpose to prove checksum normalisation.
const RAW = '0xab5801a7d398351b8be11c439e05c5b3259aec9b';
const CHECKSUMMED = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('7702 ephemeral-executor', () => {
  it('Should validate + checksum a raw address', () => {
    const executor = makeEphemeralExecutor(RAW);
    expect(executor.address).to.equal(CHECKSUMMED);
    expect(executor.__brand).to.equal('EphemeralExecutor');
  });

  it('Should reject a zero address', () => {
    expect(() => makeEphemeralExecutor(ZERO)).to.throw(/invalid recipient/i);
  });

  it('Should reject a malformed address', () => {
    expect(() => makeEphemeralExecutor('0xdeadbeef')).to.throw(
      /invalid recipient/i,
    );
  });

  it('Should resolve both a string and an EphemeralExecutor to a checksummed string', () => {
    expect(resolveExecutorAddress(RAW)).to.equal(CHECKSUMMED);
    expect(resolveExecutorAddress(makeEphemeralExecutor(RAW))).to.equal(
      CHECKSUMMED,
    );
  });

  it('Should reject an invalid string in resolveExecutorAddress', () => {
    expect(() => resolveExecutorAddress(ZERO)).to.throw(/invalid recipient/i);
  });

  it('Should expose the canonical validator under the executor alias', () => {
    expect(() => assertValidExecutorAddress(RAW, 'test')).to.not.throw();
    expect(() => assertValidExecutorAddress(ZERO, 'test')).to.throw(
      /invalid recipient/i,
    );
  });

  it('Should route a spent amount to the resolved executor address', () => {
    const spent = spentToExecutor(
      { tokenAddress: RAW, decimals: 18n },
      123n,
      RAW,
    );
    expect(spent.recipient).to.equal(CHECKSUMMED);
    expect(spent.amount).to.equal(123n);
  });
});
