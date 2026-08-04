import chai from 'chai';
import {
  NFTTokenType,
  RailgunERC20Recipient,
  RailgunNFTAmountRecipient,
} from '@railgun-community/shared-models';
import {
  RecipeERC20AmountRecipient,
  RecipeNFTRecipient,
  RecipeOutput,
} from '../../models/export-models';
import {
  createShieldERC20Recipients,
  createShieldNFTRecipients,
  createShieldRecipients,
} from '../shield-recipients';

const { expect } = chai;

const RAILGUN_ADDRESS =
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts';
const PUBLIC_ADDRESS = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'; // pragma: allowlist secret
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const NFT_ADDRESS = '0xEd5AF388653567Af2F388E6224dC7C4b3241C544'; // pragma: allowlist secret

/**
 * The SDK's field names, pinned as a *type-checked* list.
 *
 * A rename in `@railgun-community/shared-models` breaks compilation here rather
 * than silently producing an object the SDK ignores — `compareERC20RecipientArrays`
 * matches on `tokenAddress`/`recipientAddress` only, so a mismatched field name
 * degrades to "recipient not found" at proof-validation time, not a type error.
 */
const ERC20_RECIPIENT_KEYS: Array<keyof RailgunERC20Recipient> = [
  'tokenAddress',
  'recipientAddress',
];
const NFT_RECIPIENT_KEYS: Array<keyof RailgunNFTAmountRecipient> = [
  'nftAddress',
  'nftTokenType',
  'tokenSubID',
  'amount',
  'recipientAddress',
];

const sortedKeys = (obj: object): string[] => Object.keys(obj).sort();

describe('shield-recipients', () => {
  it('Should map ERC20 recipients field-by-field onto RailgunERC20Recipient', () => {
    const erc20AmountRecipients: RecipeERC20AmountRecipient[] = [
      {
        tokenAddress: USDC,
        decimals: 6n,
        amount: 1_000_000n,
        minBalance: 990_000n,
        recipient: RAILGUN_ADDRESS,
      },
    ];

    const shieldERC20Recipients = createShieldERC20Recipients(
      erc20AmountRecipients,
    );

    expect(shieldERC20Recipients).to.deep.equal([
      {
        tokenAddress: USDC,
        recipientAddress: RAILGUN_ADDRESS,
      },
    ]);
  });

  it('Should emit exactly the SDK ERC20 keys, dropping cookbook-side metadata', () => {
    // `amount` is validation-only on the cookbook side — relay-adapt re-shields
    // the whole executor balance — and `decimals`/`isBaseToken`/`minBalance`
    // have no SDK counterpart. Leaking any of them into the arg bundle would
    // put cookbook state into what the SDK caches and later compares in
    // `validateCachedProvedTransaction`.
    const [shieldERC20Recipient] = createShieldERC20Recipients([
      {
        tokenAddress: USDC,
        decimals: 6n,
        isBaseToken: false,
        amount: 1_000_000n,
        minBalance: 990_000n,
        recipient: RAILGUN_ADDRESS,
      },
    ]);

    expect(sortedKeys(shieldERC20Recipient)).to.deep.equal(
      [...ERC20_RECIPIENT_KEYS].sort(),
    );
    expect(shieldERC20Recipient).to.not.have.property('recipient');
    expect(shieldERC20Recipient).to.not.have.property('amount');
    expect(shieldERC20Recipient).to.not.have.property('decimals');
    expect(shieldERC20Recipient).to.not.have.property('minBalance');
    expect(shieldERC20Recipient).to.not.have.property('isBaseToken');
  });

  it('Should map NFT recipients field-by-field onto RailgunNFTAmountRecipient', () => {
    // The NFT divergence is narrower than the ERC20 one: `RecipeNFTRecipient`
    // already extends `RailgunNFTAmount`, so only `recipient` is renamed — and
    // unlike ERC20, `amount` IS carried (an NFT shield is per-token-id).
    const nftRecipients: RecipeNFTRecipient[] = [
      {
        nftAddress: NFT_ADDRESS,
        nftTokenType: NFTTokenType.ERC1155,
        tokenSubID: '0x76f',
        amount: 3n,
        recipient: RAILGUN_ADDRESS,
      },
    ];

    const shieldNFTRecipients = createShieldNFTRecipients(nftRecipients);

    expect(shieldNFTRecipients).to.deep.equal([
      {
        nftAddress: NFT_ADDRESS,
        nftTokenType: NFTTokenType.ERC1155,
        tokenSubID: '0x76f',
        amount: 3n,
        recipientAddress: RAILGUN_ADDRESS,
      },
    ]);
    expect(sortedKeys(shieldNFTRecipients[0])).to.deep.equal(
      [...NFT_RECIPIENT_KEYS].sort(),
    );
    expect(shieldNFTRecipients[0]).to.not.have.property('recipient');
    expect(shieldNFTRecipients[0].amount).to.equal(3n);
  });

  it('Should pass the recipient value through verbatim, 0zk or 0x', () => {
    // The adapter renames; it does not validate, checksum or normalize. A
    // designate-shield recipe puts a public `0x` address on
    // `erc20AmountRecipients`, while the default is the wallet's `0zk` address,
    // and both must survive byte-for-byte: the SDK compares the populate args
    // against the generate args by string equality.
    const shieldERC20Recipients = createShieldERC20Recipients([
      {
        tokenAddress: USDC,
        decimals: 6n,
        amount: 0n,
        recipient: RAILGUN_ADDRESS,
      },
      {
        tokenAddress: USDC,
        decimals: 6n,
        amount: 0n,
        recipient: PUBLIC_ADDRESS,
      },
    ]);

    expect(shieldERC20Recipients[0].recipientAddress).to.equal(RAILGUN_ADDRESS);
    expect(shieldERC20Recipients[1].recipientAddress).to.equal(PUBLIC_ADDRESS);
  });

  it('Should read only the address-bearing arrays of a RecipeOutput', () => {
    // `RecipeERC20AmountRecipient.recipient` is polymorphic. On
    // `erc20AmountRecipients` it is an address; on `feeERC20AmountRecipients`
    // and step `spentERC20Amounts` the SAME type carries a human-readable label
    // ('Morpho Blue Market', '0x V2 Exchange', `${vaultName} Vault Deposit Fee`).
    // That is why the field is not renamed at the source — and why the adapter
    // must never widen to the fee/spent arrays. If it did, a label would be
    // shielded to as if it were an address.
    const recipeOutput: Pick<
      RecipeOutput,
      'erc20AmountRecipients' | 'nftRecipients' | 'feeERC20AmountRecipients'
    > = {
      erc20AmountRecipients: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          amount: 1_000n,
          recipient: RAILGUN_ADDRESS,
        },
      ],
      nftRecipients: [
        {
          nftAddress: NFT_ADDRESS,
          nftTokenType: NFTTokenType.ERC721,
          tokenSubID: '0x76f',
          amount: 1n,
          recipient: RAILGUN_ADDRESS,
        },
      ],
      feeERC20AmountRecipients: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          amount: 25n,
          recipient: 'RAILGUN Shield Fee',
        },
      ],
    };

    const { shieldERC20Recipients, shieldNFTRecipients } =
      createShieldRecipients(recipeOutput);

    expect(shieldERC20Recipients).to.deep.equal([
      { tokenAddress: USDC, recipientAddress: RAILGUN_ADDRESS },
    ]);
    expect(shieldNFTRecipients).to.deep.equal([
      {
        nftAddress: NFT_ADDRESS,
        nftTokenType: NFTTokenType.ERC721,
        tokenSubID: '0x76f',
        amount: 1n,
        recipientAddress: RAILGUN_ADDRESS,
      },
    ]);
    expect(
      shieldERC20Recipients.map(({ recipientAddress }) => recipientAddress),
    ).to.not.include('RAILGUN Shield Fee');
  });

  it('Should agree with the granular mappers and handle empty arrays', () => {
    const empty = createShieldRecipients({
      erc20AmountRecipients: [],
      nftRecipients: [],
    });
    expect(empty).to.deep.equal({
      shieldERC20Recipients: [],
      shieldNFTRecipients: [],
    });

    const erc20AmountRecipients: RecipeERC20AmountRecipient[] = [
      {
        tokenAddress: USDC,
        decimals: 6n,
        amount: 1n,
        recipient: RAILGUN_ADDRESS,
      },
    ];
    const nftRecipients: RecipeNFTRecipient[] = [
      {
        nftAddress: NFT_ADDRESS,
        nftTokenType: NFTTokenType.ERC721,
        tokenSubID: '0x1',
        amount: 1n,
        recipient: PUBLIC_ADDRESS,
      },
    ];

    expect(
      createShieldRecipients({ erc20AmountRecipients, nftRecipients }),
    ).to.deep.equal({
      shieldERC20Recipients: createShieldERC20Recipients(erc20AmountRecipients),
      shieldNFTRecipients: createShieldNFTRecipients(nftRecipients),
    });
  });
});
