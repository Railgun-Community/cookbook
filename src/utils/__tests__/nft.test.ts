import chai from 'chai';
import { NFTTokenType } from '@railgun-community/shared-models';
import { nftIdentityKey, normalizeTokenSubID } from '../nft';

const { expect } = chai;

const ADDRESS = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'; // pragma: allowlist secret
const PADDED =
  '0x000000000000000000000000000000000000000000000000000000000000076f';

describe('nft-identity-key', () => {
  it('Should normalize a zero-padded tokenSubID to its unpadded form', () => {
    expect(normalizeTokenSubID(PADDED)).to.equal('0x76f');
    expect(normalizeTokenSubID('0x76f')).to.equal('0x76f');
    expect(normalizeTokenSubID('0x0')).to.equal('0x0');
  });

  it('Should fall back to the lowercased raw value for a non-numeric subID', () => {
    expect(normalizeTokenSubID('NotAHexValue')).to.equal('notahexvalue');
    expect(normalizeTokenSubID('')).to.equal('');
  });

  it('Should key the same NFT identically across checksum case and padding', () => {
    const a = nftIdentityKey({
      nftAddress: ADDRESS,
      tokenSubID: '0x76f',
      nftTokenType: NFTTokenType.ERC721,
    });
    const b = nftIdentityKey({
      nftAddress: ADDRESS.toLowerCase(),
      tokenSubID: PADDED,
      nftTokenType: NFTTokenType.ERC721,
    });
    expect(a).to.equal(b);
  });

  it('Should distinguish different token ids, contracts, and token types', () => {
    const base = {
      nftAddress: ADDRESS,
      tokenSubID: '0x76f',
      nftTokenType: NFTTokenType.ERC721,
    };
    expect(nftIdentityKey(base)).to.not.equal(
      nftIdentityKey({ ...base, tokenSubID: '0x770' }),
    );
    expect(nftIdentityKey(base)).to.not.equal(
      nftIdentityKey({
        ...base,
        nftAddress: '0x1111111111111111111111111111111111111111',
      }),
    );
    expect(nftIdentityKey(base)).to.not.equal(
      nftIdentityKey({ ...base, nftTokenType: NFTTokenType.ERC1155 }),
    );
  });
});
