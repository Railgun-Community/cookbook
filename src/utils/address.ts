import { isAddress } from '@ethersproject/address';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const validateContractAddress = (address: string) => {
  return isAddress(address);
};

/**
 * Assert an EIP-7702 recipient/executor address is a well-formed, non-zero EVM
 * address before it is baked into on-chain call data (0x `taker`, a router
 * `to`, or a relay-adapt self-call target). Fails loud at build time so a
 * malformed or zero address surfaces immediately instead of silently
 * misrouting funds.
 */
export const assertValidRecipientAddress = (
  address: string,
  context: string,
): void => {
  if (!isAddress(address) || address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${context}: invalid recipient address "${address}"`);
  }
};

export const isPrefixedRailgunAddress = (address: string): boolean => {
  if (address.startsWith('0zk')) {
    return true;
  }
  if (address.startsWith('0x')) {
    return false;
  }
  throw new Error(`Invalid address: ${address}`);
};
