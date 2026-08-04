import chai from 'chai';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { makeEphemeralExecutor } from '../ephemeral-executor';
import {
  resolvePositionOwnerAddress,
  resolvePositionOwnerAddressForRead,
} from '../position-owner';

const { expect } = chai;

// Lowercased on purpose to prove checksum normalisation.
const RAW = '0xab5801a7d398351b8be11c439e05c5b3259aec9b';
const CHECKSUMMED = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const ZERO = '0x0000000000000000000000000000000000000000';
const RELAY_ADAPT = NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract;

describe('7702 position-owner', () => {
  it('Should validate + checksum a raw owner address', () => {
    expect(resolvePositionOwnerAddress(RAW)).to.equal(CHECKSUMMED);
    expect(resolvePositionOwnerAddressForRead(RAW)).to.equal(CHECKSUMMED);
  });

  it('Should accept an EphemeralExecutor as an owner', () => {
    // The one-way relation: every executor is a legal owner of its own
    // position. (The converse does not hold and is not expressible in the type
    // system — see the module docs.)
    const executor = makeEphemeralExecutor(RAW);
    expect(resolvePositionOwnerAddress(executor)).to.equal(CHECKSUMMED);
    expect(resolvePositionOwnerAddressForRead(executor)).to.equal(CHECKSUMMED);
  });

  it('Should reject a zero or malformed owner on both paths', () => {
    expect(() => resolvePositionOwnerAddress(ZERO)).to.throw(
      /invalid recipient/i,
    );
    expect(() => resolvePositionOwnerAddress('0xdeadbeef')).to.throw(
      /invalid recipient/i,
    );
    expect(() => resolvePositionOwnerAddressForRead(ZERO)).to.throw(
      /invalid recipient/i,
    );
    expect(() => resolvePositionOwnerAddressForRead('0xdeadbeef')).to.throw(
      /invalid recipient/i,
    );
  });

  it('Should reject the shared relay-adapt as a WRITE owner', () => {
    // Booking a position against shared custody: nothing could ever unwind it.
    expect(() => resolvePositionOwnerAddress(RELAY_ADAPT)).to.throw(
      /relay-adapt/i,
    );
  });

  it('Should ALLOW the shared relay-adapt as a READ owner', () => {
    // The deliberate divergence: refusing to look is how a position already
    // stranded on the relay-adapt stays invisible to a scanner.
    expect(resolvePositionOwnerAddressForRead(RELAY_ADAPT)).to.be.a('string');
  });

  it('Should name the role in the error context', () => {
    expect(() => resolvePositionOwnerAddress(ZERO, 'Morpho repay onBehalf')).to
      .throw(/Morpho repay onBehalf/);
  });
});
