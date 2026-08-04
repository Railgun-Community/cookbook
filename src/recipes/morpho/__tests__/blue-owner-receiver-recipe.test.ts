import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Interface,
  InterfaceAbi,
  Provider,
  TransactionRequest,
  getAddress,
} from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { abi } from '../../../abi/abi';
import { RecipeInput } from '../../../models/export-models';
import { MorphoBluePosition } from '../../../contract/morpho/morpho-blue-contract';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../../steps/morpho/morpho-blue-util';
import { MorphoBlueBorrowRecipe } from '../blue-borrow-recipe';
import { MorphoBlueClosePositionRecipe } from '../blue-close-position-recipe';
import { MorphoBlueRepayRecipe } from '../blue-repay-recipe';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// End-to-end acceptance for the owner/receiver split: assert against the actual
// calldata the recipe emits, not the intermediate quote. A quote that carries
// the two roles correctly but bakes the wrong one into `onBehalf` would pass
// the API-level tests and still strand a position.
// ---------------------------------------------------------------------------

const networkName = NetworkName.Ethereum;
const RAILGUN_ADDRESS =
  '0zk1qyql8fq0nzn87sxxeg8jg9tvmqz0nl60wxjrq7hh3kwuvpwsvzcmpv7j6fe3z53l7c0uqrz3qzsqxgp6jj7y0f9hwvkzhwmnpz6nzcmlq5h0p6yvjyhwxk8xw';

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

/** The account this batch runs as, and shields from. */
const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
/** The durable account that holds the position. */
const OWNER = '0xbCd16D361adf5E7e0dc0010756B49666b4f38eE0';

const OWNER_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 500_000_000_000_000_000n,
  collateral: 3_000_000_000_000_000_000n,
};
const EMPTY_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 0n,
  collateral: 0n,
};

const blueIface = new Interface(abi.morpho.blue as InterfaceAbi);
const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);

const makeStubProvider = (authorized = true): Provider => {
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
        return blueIface.encodeFunctionResult('market', [
          2_000_000_000n,
          2_000_000_000_000_000_000n,
          1_000_000_000n,
          1_000_000_000_000_000_000n,
          1785853583n,
          0n,
        ]);
      }
      if (selector === blueIface.getFunction('isAuthorized')?.selector) {
        return blueIface.encodeFunctionResult('isAuthorized', [authorized]);
      }
    }

    if (to === USDC.toLowerCase() || to === PAXG.toLowerCase()) {
      return erc20Iface.encodeFunctionResult('decimals', [
        to === USDC.toLowerCase() ? 6n : 18n,
      ]);
    }

    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };
  return { call } as unknown as Provider;
};

const emptyInput: RecipeInput = {
  railgunAddress: RAILGUN_ADDRESS,
  networkName,
  erc20Amounts: [],
  nfts: [],
};

/** Decode the one Blue call in the batch matching `name`. */
const decodeBlueCall = (
  calls: readonly { to?: string; data?: string }[],
  name: string,
) => {
  const fragment = blueIface.getFunction(name);
  const call = calls.find(
    candidate =>
      candidate.to?.toLowerCase() === MORPHO_BLUE_ADDRESS.toLowerCase() &&
      candidate.data?.startsWith(fragment?.selector ?? 'x') === true,
  );
  expect(call, `no ${name} call in batch`).to.not.equal(undefined);
  return blueIface.decodeFunctionData(name, call?.data ?? '0x');
};

describe('Morpho Blue recipes — owner/receiver reach the calldata', () => {
  it('borrows on behalf of a durable owner and pays a batch-local receiver', async () => {
    // The acceptance criterion, asserted on the wire bytes.
    const recipe = new MorphoBlueBorrowRecipe(
      market,
      1_000_000n,
      EXECUTOR,
      makeStubProvider(),
      OWNER,
    );
    const output = await recipe.getRecipeOutput(emptyInput, true, true);

    const borrow = decodeBlueCall(output.crossContractCalls, 'borrow');
    expect(getAddress(borrow[3] as string)).to.equal(OWNER); // onBehalf
    expect(getAddress(borrow[4] as string)).to.equal(EXECUTOR); // receiver
  });

  it('defaults to self-custody when no owner is given', async () => {
    const recipe = new MorphoBlueBorrowRecipe(
      market,
      1_000_000n,
      EXECUTOR,
      makeStubProvider(),
    );
    const output = await recipe.getRecipeOutput(emptyInput, true, true);

    const borrow = decodeBlueCall(output.crossContractCalls, 'borrow');
    expect(getAddress(borrow[3] as string)).to.equal(EXECUTOR);
    expect(getAddress(borrow[4] as string)).to.equal(EXECUTOR);
  });

  it('refuses to build a delegated borrow the owner never authorised', async () => {
    const recipe = new MorphoBlueBorrowRecipe(
      market,
      1_000_000n,
      EXECUTOR,
      makeStubProvider(false),
      OWNER,
    );
    await expect(
      recipe.getRecipeOutput(emptyInput, true, true),
    ).to.be.rejectedWith(/UNAUTHORIZED/);
  });

  it('closes a durable owner position and shields the proceeds to the executor', async () => {
    const recipe = new MorphoBlueClosePositionRecipe(
      market,
      100n,
      EXECUTOR,
      makeStubProvider(),
      OWNER,
    );
    const output = await recipe.getRecipeOutput(
      {
        railgunAddress: RAILGUN_ADDRESS,
        networkName,
        erc20Amounts: [
          { tokenAddress: USDC, decimals: 6n, amount: 1_000_000_000n },
        ],
        nfts: [],
      },
      true,
      true,
    );

    // Both legs must name the owner; only the withdraw has a receiver, and it
    // is the executor — the account the shield leg sweeps.
    const repay = decodeBlueCall(output.crossContractCalls, 'repay');
    expect(getAddress(repay[3] as string)).to.equal(OWNER); // onBehalf
    expect(repay[2]).to.equal(OWNER_POSITION.borrowShares); // shares-mode

    const withdraw = decodeBlueCall(
      output.crossContractCalls,
      'withdrawCollateral',
    );
    expect(getAddress(withdraw[2] as string)).to.equal(OWNER); // onBehalf
    expect(getAddress(withdraw[3] as string)).to.equal(EXECUTOR); // receiver
    // Sized from the OWNER's collateral, which the collapsed builder could not
    // have read.
    expect(withdraw[1]).to.equal(OWNER_POSITION.collateral);
  });

  it('repays a durable owner debt with no receiver role at all', async () => {
    // `Morpho.repay` takes no receiver, so this recipe is owner-only: the
    // executor pays and the owner's debt falls. No authorization involved.
    const recipe = new MorphoBlueRepayRecipe(market, OWNER, makeStubProvider());
    const output = await recipe.getRecipeOutput(
      {
        railgunAddress: RAILGUN_ADDRESS,
        networkName,
        erc20Amounts: [
          { tokenAddress: USDC, decimals: 6n, amount: 100_000_000n },
        ],
        nfts: [],
      },
      true,
      true,
    );

    const repay = decodeBlueCall(output.crossContractCalls, 'repay');
    expect(getAddress(repay[3] as string)).to.equal(OWNER);
    expect(repay[1]).to.equal(100_000_000n); // assets-mode, under the debt
  });
});
