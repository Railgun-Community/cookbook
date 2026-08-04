export const MOCK_SHIELD_FEE_BASIS_POINTS = 25n;
export const MOCK_UNSHIELD_FEE_BASIS_POINTS = 25n;

// testRailgunWallet address
export const MOCK_RAILGUN_WALLET_ADDRESS =
  '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48tlrv7j6fe3z53lama02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5ajy990';

// testRailgunWallet2 address
export const MOCK_RAILGUN_WALLET_ADDRESS_2 =
  '0zk1qygxma3y6ljx3205z7lxreftpx47zr25z0nmt3a32zzygcyz5mg5mrv7j6fe3z53l74h5eldal4evywm297acap2thxn7c9pp8vhvmwzvz32m36a70y06gejrsw';

/**
 * ERC-20 `approve(spender, amount)` calldata, for asserting what an approval step
 * actually encodes.
 *
 * The recipe tests used to carry this as a literal hex string. That is how eight
 * call sites shipped granting `2**256-1` without anyone noticing: a 64-character
 * run of `f` reads exactly like any other opaque calldata tail. Build it from the
 * amount instead, so the assertion says what it means and a change to the
 * approved figure shows up as a number.
 */
export const mockERC20ApprovalCalldata = (
  spender: string,
  amount: bigint,
): string =>
  '0x095ea7b3' +
  spender.toLowerCase().replace('0x', '').padStart(64, '0') +
  amount.toString(16).padStart(64, '0');
