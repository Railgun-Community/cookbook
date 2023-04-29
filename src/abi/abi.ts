import ABI_ERC20 from './json/erc20.json';
import ABI_ERC721 from './json/erc721.json';
import ABI_ERC1155 from './json/erc1155.json';

export const abi = {
  erc20: ABI_ERC20,
  erc721: ABI_ERC721,
  erc1155: ABI_ERC1155,
} as const;
