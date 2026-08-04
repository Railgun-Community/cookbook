import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ContractTransaction, Interface, Provider } from 'ethers';
import {
  NETWORK_CONFIG,
  NFTTokenType,
  NetworkName,
} from '@railgun-community/shared-models';
import {
  RecipeInput,
  RecipeOutput,
  StepOutput,
} from '../../../models/export-models';
import { setRailgunFees } from '../../../init';
import { FxMintOpenRecipe } from '../../../recipes/borrow/fx/fx-mint-open-recipe';
import {
  FX_ADDRESSES,
  resolvePool,
} from '../../../steps/borrow/fx/fx-mint-util';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import {
  ExecutorResidueError,
  ObservedExecutorResidue,
  ResidueChainReader,
  UNBOUNDED_ALLOWANCE,
  assertExecutorResidue,
  collectExecutorResidueSurface,
  ethersResidueChainReader,
  findExecutorResidueViolations,
  readExecutorResidue,
} from '../executor-residue';

chai.use(chaiAsPromised);
const { expect } = chai;

const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SPENDER = '0x1111111254EEB25477B68fb85Ed929f73A960582';
const OTHER_SPENDER = '0x22222222AA2C5EA7B8dE6b2AB88bbfedF9F0D0C1';
const NFT = '0x3333333333333333333333333333333333333333';

const ERC20_IFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
]);

const approveCall = (tokenAddress: string, spender: string, amount: bigint) => ({
  to: tokenAddress,
  data: ERC20_IFACE.encodeFunctionData('approve', [spender, amount]),
  value: 0n,
});

const setApprovalForAllCall = (nftAddress: string, operator: string) => ({
  to: nftAddress,
  data: ERC20_IFACE.encodeFunctionData('setApprovalForAll', [operator, true]),
  value: 0n,
});

const stepOutput = (overrides: Partial<StepOutput> = {}): StepOutput => ({
  name: 'Test Step',
  description: 'test',
  crossContractCalls: [],
  outputERC20Amounts: [],
  outputNFTs: [],
  ...overrides,
});

const recipeInput = (
  overrides: Partial<RecipeInput> = {},
): RecipeInput => ({
  networkName: NetworkName.Ethereum,
  railgunAddress: '0zk-test',
  erc20Amounts: [],
  nfts: [],
  ...overrides,
});

const recipeOutput = (
  overrides: Partial<RecipeOutput> = {},
): RecipeOutput => ({
  name: 'Test Recipe',
  stepOutputs: [],
  crossContractCalls: [],
  erc20AmountRecipients: [],
  nftRecipients: [],
  feeERC20AmountRecipients: [],
  outputPositions: [],
  minGasLimit: 0n,
  ...overrides,
});

/**
 * In-memory {@link ResidueChainReader}. The whole reason the reader is a narrow
 * interface rather than a `Provider`: the assertion's logic is verified here,
 * with no fork node, no anvil, and no serialisation against other agents' runs.
 */
const fakeReader = (state: {
  native?: bigint;
  allowances?: Record<string, bigint>;
  balances?: Record<string, bigint>;
  erc721Owners?: Record<string, string>;
  erc1155Balances?: Record<string, bigint>;
  operators?: Record<string, boolean>;
}): ResidueChainReader => {
  const key = (...parts: string[]) => parts.map(p => p.toLowerCase()).join('|');
  return {
    getNativeBalance: () => Promise.resolve(state.native ?? 0n),
    getERC20Allowance: (tokenAddress, _owner, spender) =>
      Promise.resolve((state.allowances ?? {})[key(tokenAddress, spender)] ?? 0n),
    getERC20Balance: tokenAddress =>
      Promise.resolve((state.balances ?? {})[tokenAddress.toLowerCase()] ?? 0n),
    getERC721Owner: (nftAddress, tokenSubID) =>
      Promise.resolve(
        (state.erc721Owners ?? {})[key(nftAddress, tokenSubID)] ?? undefined,
      ),
    getERC1155Balance: (nftAddress, _owner, tokenSubID) =>
      Promise.resolve(
        (state.erc1155Balances ?? {})[key(nftAddress, tokenSubID)] ?? 0n,
      ),
    isApprovedForAll: (nftAddress, _owner, operator) =>
      Promise.resolve((state.operators ?? {})[key(nftAddress, operator)] === true),
  };
};

const cleanObservation = (
  overrides: Partial<ObservedExecutorResidue> = {},
): ObservedExecutorResidue => ({
  executor: EXECUTOR,
  nativeBalance: 0n,
  allowances: [],
  balances: [],
  nfts: [],
  operatorApprovals: [],
  ...overrides,
});

describe('7702 executor-residue surface', () => {
  it('Should decode an exact ERC20 approval out of crossContractCalls', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [approveCall(WETH, SPENDER, 1000n)],
      }),
    );
    expect(surface.allowances).to.deep.equal([
      {
        tokenAddress: WETH,
        spender: SPENDER,
        encodedApproval: 1000n,
        declaredBySteps: [],
      },
    ]);
  });

  it('Should keep the LAST approval for a pair (the USDT clear-then-set pattern)', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [
          approveCall(WETH, SPENDER, 0n),
          approveCall(WETH, SPENDER, 500n),
        ],
      }),
    );
    expect(surface.allowances.length).to.equal(1);
    expect(surface.allowances[0].encodedApproval).to.equal(500n);
  });

  it('Should surface a max approval as UNBOUNDED_ALLOWANCE', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [
          approveCall(WETH, SPENDER, UNBOUNDED_ALLOWANCE),
        ],
      }),
    );
    expect(surface.allowances[0].encodedApproval).to.equal(UNBOUNDED_ALLOWANCE);
  });

  it('Should union the decoded approvals with the step model approvedSpender', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [approveCall(WETH, SPENDER, 1000n)],
        stepOutputs: [
          stepOutput({
            name: 'Approve ERC20 Spender',
            outputERC20Amounts: [
              {
                tokenAddress: WETH,
                decimals: 18n,
                expectedBalance: 1000n,
                minBalance: 1000n,
                approvedSpender: SPENDER,
              },
              // Declared but never approved by THIS batch — an allowance
              // inherited from an earlier one. Must still be checked.
              {
                tokenAddress: USDC,
                decimals: 6n,
                expectedBalance: 5n,
                minBalance: 5n,
                approvedSpender: OTHER_SPENDER,
              },
            ],
          }),
        ],
      }),
    );
    expect(
      surface.allowances.map(a => [a.tokenAddress, a.spender, a.encodedApproval]),
    ).to.deep.equal([
      [WETH, SPENDER, 1000n],
      [USDC, OTHER_SPENDER, undefined],
    ]);
    expect(surface.allowances[0].declaredBySteps).to.deep.equal([
      'Approve ERC20 Spender',
    ]);
    expect(surface.allowances[1].declaredBySteps).to.deep.equal([
      'Approve ERC20 Spender',
    ]);
  });

  it('Should NOT read an ERC721 approve() as an ERC20 allowance', () => {
    // approve(address,uint256) is selector-identical across ERC20 and ERC721.
    // Decoding the ERC721 form as an allowance would report a token id as an
    // approved amount — here, an "allowance" of 7.
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [approveCall(NFT, SPENDER, 7n)],
        nftRecipients: [
          {
            nftAddress: NFT,
            tokenSubID: '0x7',
            nftTokenType: NFTTokenType.ERC721,
            amount: 1n,
            recipient: '0zk-test',
          },
        ],
      }),
    );
    expect(surface.allowances).to.deep.equal([]);
    expect(surface.undecodedApprovals.length).to.equal(1);
    expect(surface.undecodedApprovals[0].to).to.equal(NFT);
  });

  it('Should surface setApprovalForAll(operator, true) and ignore (operator, false)', () => {
    const granted = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [setApprovalForAllCall(NFT, SPENDER)],
      }),
    );
    expect(granted.operatorApprovals).to.deep.equal([
      { nftAddress: NFT, operator: SPENDER },
    ]);

    const revoked = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [
          {
            to: NFT,
            data: ERC20_IFACE.encodeFunctionData('setApprovalForAll', [
              SPENDER,
              false,
            ]),
            value: 0n,
          },
        ],
      }),
    );
    expect(revoked.operatorApprovals).to.deep.equal([]);
  });

  it('Should collect assets the recipe never took as input', () => {
    // A swap buys an asset that was never unshielded. It still passes through
    // the executor, so it still has to leave.
    const surface = collectExecutorResidueSurface(
      recipeInput({
        erc20Amounts: [
          { tokenAddress: WETH.toLowerCase(), decimals: 18n, amount: 1000n },
        ],
      }),
      recipeOutput({
        stepOutputs: [
          stepOutput({
            name: 'Swap',
            outputERC20Amounts: [
              {
                tokenAddress: USDC,
                decimals: 6n,
                expectedBalance: 5n,
                minBalance: 5n,
                approvedSpender: undefined,
              },
            ],
          }),
        ],
      }),
    );
    // Checksummed and deduped across spellings.
    expect(surface.tokenAddresses).to.deep.equal([WETH, USDC]);
  });

  it('Should collect a bearer position NFT from outputPositions', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        outputPositions: [
          {
            custody: 'bearer',
            protocol: 'fx',
            marketOrPoolId: NFT,
            kind: 'debt',
            direction: 'increase',
            tokenAddress: USDC,
            decimals: 6n,
            amount: 100n,
            nftAddress: NFT,
            tokenSubID: '0x2a',
            nftTokenType: NFTTokenType.ERC721,
          },
        ],
      }),
    );
    expect(surface.nfts).to.deep.equal([
      { nftAddress: NFT, tokenSubID: '0x2a', nftTokenType: NFTTokenType.ERC721 },
    ]);
    // The position's denomination asset is also a balance the executor could
    // still be holding.
    expect(surface.tokenAddresses).to.deep.equal([USDC]);
  });

  it('Should dedupe an NFT declared in several channels, across tokenSubID padding', () => {
    const padded = `0x${'0'.repeat(63)}7`;
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        stepOutputs: [
          stepOutput({
            outputNFTs: [
              {
                nftAddress: NFT,
                tokenSubID: '0x7',
                nftTokenType: NFTTokenType.ERC721,
                amount: 1n,
              },
            ],
          }),
        ],
        nftRecipients: [
          {
            nftAddress: NFT.toLowerCase(),
            tokenSubID: padded,
            nftTokenType: NFTTokenType.ERC721,
            amount: 1n,
            recipient: '0zk-test',
          },
        ],
      }),
    );
    expect(surface.nfts.length).to.equal(1);
  });

  it('Should ignore non-approval calls and malformed call data', () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        crossContractCalls: [
          {
            to: WETH,
            data: ERC20_IFACE.encodeFunctionData('transfer', [SPENDER, 1n]),
            value: 0n,
          },
          { to: WETH, data: '0x', value: 0n },
          // `ContractTransaction` types `to`/`data` as required, so this shape
          // is only reachable from a JS caller. The guard exists for that case;
          // the cast is how it gets exercised.
          { value: 0n } as unknown as ContractTransaction,
        ],
      }),
    );
    expect(surface.allowances).to.deep.equal([]);
    expect(surface.operatorApprovals).to.deep.equal([]);
  });

  it('Should throw rather than silently drop an unparseable address', () => {
    // Skipping it would shrink the surface and let the assertion report "clean"
    // over a slot it never checked.
    expect(() =>
      collectExecutorResidueSurface(
        recipeInput(),
        recipeOutput({
          stepOutputs: [
            stepOutput({
              name: 'Approve ERC20 Spender',
              outputERC20Amounts: [
                {
                  tokenAddress: WETH,
                  decimals: 18n,
                  expectedBalance: 1n,
                  minBalance: 1n,
                  approvedSpender: '0xnot-an-address',
                },
              ],
            }),
          ],
        }),
      ),
    ).to.throw(/approvedSpender is not a usable address/);
  });
});

describe('7702 executor-residue violations', () => {
  it('Should pass a clean executor with no policy', () => {
    expect(findExecutorResidueViolations(cleanObservation())).to.deep.equal([]);
  });

  it('Should flag a surviving native balance', () => {
    const violations = findExecutorResidueViolations(
      cleanObservation({ nativeBalance: 1n }),
    );
    expect(violations.map(v => v.kind)).to.deep.equal(['native-balance']);
  });

  it('Should permit a native balance only up to the stated cap', () => {
    const observed = cleanObservation({ nativeBalance: 5n });
    expect(
      findExecutorResidueViolations(observed, { maxNativeBalance: 5n }),
    ).to.deep.equal([]);
    expect(
      findExecutorResidueViolations(observed, { maxNativeBalance: 4n }).length,
    ).to.equal(1);
  });

  it('Should flag a surviving allowance and name the approval that caused it', () => {
    const violations = findExecutorResidueViolations(
      cleanObservation({
        allowances: [
          {
            tokenAddress: WETH,
            spender: SPENDER,
            encodedApproval: UNBOUNDED_ALLOWANCE,
            declaredBySteps: [],
            allowance: UNBOUNDED_ALLOWANCE,
          },
        ],
      }),
    );
    expect(violations.length).to.equal(1);
    expect(violations[0].kind).to.equal('allowance');
    expect(violations[0].message).to.contain('type(uint256).max');
    expect(violations[0].message).to.contain('The batch approved');
  });

  it('Should say when a surviving allowance was inherited rather than approved here', () => {
    const violations = findExecutorResidueViolations(
      cleanObservation({
        allowances: [
          {
            tokenAddress: WETH,
            spender: SPENDER,
            declaredBySteps: ['Approve ERC20 Spender'],
            allowance: 5n,
          },
        ],
      }),
    );
    expect(violations[0].message).to.contain('inherited from an earlier batch');
  });

  it('Should permit a bounded allowance at the bound and reject one above it', () => {
    const observedAt = cleanObservation({
      allowances: [
        {
          tokenAddress: WETH,
          spender: SPENDER,
          encodedApproval: 100n,
          declaredBySteps: [],
          allowance: 10n,
        },
      ],
    });
    const policy = {
      allowances: [
        {
          tokenAddress: WETH,
          spender: SPENDER,
          max: 10n,
          reason: 'shares-mode repay approves an upper bound',
        },
      ],
    };
    expect(findExecutorResidueViolations(observedAt, policy)).to.deep.equal([]);

    const observedOver = cleanObservation({
      allowances: [{ ...observedAt.allowances[0], allowance: 11n }],
    });
    const violations = findExecutorResidueViolations(observedOver, policy);
    expect(violations.map(v => v.kind)).to.deep.equal(['allowance']);
    expect(violations[0].message).to.contain('shares-mode repay');
  });

  it('Should reject an exemption with no reason', () => {
    const violations = findExecutorResidueViolations(cleanObservation(), {
      allowances: [
        { tokenAddress: WETH, spender: SPENDER, max: 1n, reason: '   ' },
      ],
      allowUnusedAllowanceExemptions: true,
    });
    expect(violations.map(v => v.kind)).to.deep.equal([
      'exemption-without-reason',
    ]);
  });

  it('Should reject an allowance exemption that matches nothing in the surface', () => {
    const violations = findExecutorResidueViolations(cleanObservation(), {
      allowances: [
        {
          tokenAddress: WETH,
          spender: SPENDER,
          max: 1n,
          reason: 'left over from a refactor',
        },
      ],
    });
    expect(violations.map(v => v.kind)).to.deep.equal([
      'unused-allowance-exemption',
    ]);
  });

  it('Should allow an unused allowance exemption when explicitly opted in', () => {
    expect(
      findExecutorResidueViolations(cleanObservation(), {
        allowances: [
          {
            tokenAddress: WETH,
            spender: SPENDER,
            max: 1n,
            reason: 'set only on the USDT branch',
          },
        ],
        allowUnusedAllowanceExemptions: true,
      }),
    ).to.deep.equal([]);
  });

  it('Should flag a surviving asset balance and permit stated dust', () => {
    const observed = cleanObservation({
      balances: [{ tokenAddress: WETH, balance: 2n, sweptByShield: true }],
    });
    expect(findExecutorResidueViolations(observed).map(v => v.kind)).to.deep.equal([
      'token-balance',
    ]);
    expect(
      findExecutorResidueViolations(observed, {
        balances: [
          { tokenAddress: WETH, max: 2n, reason: 'integer-division rounding' },
        ],
      }),
    ).to.deep.equal([]);
  });

  it('Should distinguish an unswept balance from a stranded one', () => {
    // erc20AmountRecipients IS the shield request list, and a request sweeps
    // balanceOf. So an asset on the list comes back even after a mid-batch
    // failure; an asset the recipe names only as spent/fee has nothing asking
    // for it and stays on the executor for good. Same symptom, different bug.
    const unswept = findExecutorResidueViolations(
      cleanObservation({
        balances: [{ tokenAddress: WETH, balance: 1n, sweptByShield: true }],
      }),
    );
    expect(unswept[0].message).to.contain('shield epilogue requests this asset');

    const stranded = findExecutorResidueViolations(
      cleanObservation({
        balances: [{ tokenAddress: WETH, balance: 1n, sweptByShield: false }],
      }),
    );
    expect(stranded[0].message).to.contain('STRANDED');
  });

  it('Should mark an asset named only as spent as NOT swept by the shield', async () => {
    const surface = collectExecutorResidueSurface(
      recipeInput(),
      recipeOutput({
        stepOutputs: [
          stepOutput({
            outputERC20Amounts: [
              {
                tokenAddress: WETH,
                decimals: 18n,
                expectedBalance: 1n,
                minBalance: 1n,
                approvedSpender: undefined,
              },
            ],
            spentERC20Amounts: [
              {
                tokenAddress: USDC,
                decimals: 6n,
                amount: 1n,
                recipient: 'Morpho Blue Market',
              },
            ],
          }),
        ],
        // Only WETH reaches the shield request list.
        erc20AmountRecipients: [
          {
            tokenAddress: WETH.toLowerCase(),
            decimals: 18n,
            amount: 1n,
            recipient: '0zk-test',
          },
        ],
      }),
    );
    expect(surface.tokenAddresses).to.deep.equal([WETH, USDC]);

    const observed = await readExecutorResidue(
      fakeReader({ balances: { [USDC.toLowerCase()]: 4n } }),
      EXECUTOR,
      surface,
    );
    expect(observed.balances.map(b => [b.tokenAddress, b.sweptByShield])).to.deep.equal(
      [
        [WETH, true],
        [USDC, false],
      ],
    );
    expect(
      findExecutorResidueViolations(observed)[0].message,
    ).to.contain('STRANDED');
  });

  it('Should flag an NFT still held, and permit one the policy names', () => {
    const observed = cleanObservation({
      nfts: [
        {
          nftAddress: NFT,
          tokenSubID: '0x7',
          nftTokenType: NFTTokenType.ERC721,
          heldAmount: 1n,
        },
      ],
    });
    expect(findExecutorResidueViolations(observed).map(v => v.kind)).to.deep.equal(
      ['nft-held'],
    );
    // tokenSubID padding must not defeat the exemption.
    expect(
      findExecutorResidueViolations(observed, {
        nfts: [
          {
            nftAddress: NFT,
            tokenSubID: `0x${'0'.repeat(63)}7`,
            reason: 'partial close deliberately keeps the position NFT',
          },
        ],
      }),
    ).to.deep.equal([]);
  });

  it('Should flag a surviving operator approval', () => {
    const violations = findExecutorResidueViolations(
      cleanObservation({
        operatorApprovals: [
          { nftAddress: NFT, operator: SPENDER, approved: true },
        ],
      }),
    );
    expect(violations.map(v => v.kind)).to.deep.equal(['operator-approval']);
  });

  it('Should report EVERY violation, not just the first', () => {
    // The shape of a batch that failed inside requireSuccess = false: the
    // approval was never consumed, the input asset never moved, and the NFT
    // was never burned. Reporting one of the three would hide the diagnosis.
    const violations = findExecutorResidueViolations(
      cleanObservation({
        nativeBalance: 1n,
        allowances: [
          {
            tokenAddress: WETH,
            spender: SPENDER,
            encodedApproval: 1000n,
            declaredBySteps: [],
            allowance: 1000n,
          },
        ],
        balances: [{ tokenAddress: WETH, balance: 1000n, sweptByShield: true }],
        nfts: [
          {
            nftAddress: NFT,
            tokenSubID: '0x7',
            nftTokenType: NFTTokenType.ERC721,
            heldAmount: 1n,
          },
        ],
      }),
    );
    expect(violations.map(v => v.kind)).to.deep.equal([
      'native-balance',
      'token-balance',
      'allowance',
      'nft-held',
    ]);
  });
});

describe('7702 executor-residue reads', () => {
  it('Should treat a reverting ownerOf as not held', async () => {
    const observed = await readExecutorResidue(
      fakeReader({}),
      EXECUTOR,
      collectExecutorResidueSurface(
        recipeInput(),
        recipeOutput({
          stepOutputs: [
            stepOutput({
              spentNFTs: [
                {
                  nftAddress: NFT,
                  tokenSubID: '0x7',
                  nftTokenType: NFTTokenType.ERC721,
                  amount: 1n,
                },
              ],
              outputNFTs: [],
            }),
          ],
        }),
      ),
    );
    expect(observed.nfts[0].heldAmount).to.equal(0n);
  });

  it('Should read an ERC1155 by balance rather than ownerOf', async () => {
    const observed = await readExecutorResidue(
      fakeReader({ erc1155Balances: { [`${NFT.toLowerCase()}|0x7`]: 3n } }),
      EXECUTOR,
      collectExecutorResidueSurface(
        recipeInput({
          nfts: [
            {
              nftAddress: NFT,
              tokenSubID: '0x7',
              nftTokenType: NFTTokenType.ERC1155,
              amount: 3n,
            },
          ],
        }),
        recipeOutput(),
      ),
    );
    expect(observed.nfts[0].heldAmount).to.equal(3n);
  });
});

describe('7702 ethersResidueChainReader', () => {
  const RESULT_IFACE = new Interface([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function allowance(address owner, address spender) view returns (uint256)',
  ]);

  const stubProvider = (call: () => Promise<string>): Provider =>
    ({
      call,
      getBalance: () => Promise.resolve(0n),
    }) as unknown as Provider;

  it('Should decode an allowance', async () => {
    const reader = ethersResidueChainReader(
      stubProvider(() =>
        Promise.resolve(
          RESULT_IFACE.encodeFunctionResult('allowance', [
            UNBOUNDED_ALLOWANCE,
          ]),
        ),
      ),
    );
    expect(await reader.getERC20Allowance(WETH, EXECUTOR, SPENDER)).to.equal(
      UNBOUNDED_ALLOWANCE,
    );
  });

  it('Should read a reverting ownerOf as "not held" (the burned-position case)', async () => {
    const reader = ethersResidueChainReader(
      stubProvider(() =>
        Promise.reject(
          Object.assign(new Error('execution reverted'), {
            code: 'CALL_EXCEPTION',
          }),
        ),
      ),
    );
    expect(await reader.getERC721Owner(NFT, '0x7')).to.equal(undefined);
  });

  it('Should NOT launder a transport failure into "not held"', async () => {
    // An unreachable node is not evidence that the executor is clean. Swallowing
    // it here would turn every RPC hiccup into a silently passing assertion.
    const reader = ethersResidueChainReader(
      stubProvider(() => Promise.reject(new Error('socket hang up'))),
    );
    await expect(reader.getERC721Owner(NFT, '0x7')).to.be.rejectedWith(
      /is unknown — which is not the same as clean/,
    );
  });

  it('Should name the contract and method when a read fails', async () => {
    const reader = ethersResidueChainReader(
      stubProvider(() => Promise.reject(new Error('boom'))),
    );
    await expect(
      reader.getERC20Balance(WETH, EXECUTOR),
    ).to.be.rejectedWith(new RegExp(`balanceOf\\(address\\) on ${WETH}`));
  });
});

describe('7702 assertExecutorResidue', () => {
  const exactApprovalRecipe = () =>
    recipeOutput({
      crossContractCalls: [approveCall(WETH, SPENDER, 1000n)],
    });

  it('Should pass when the spender consumed the whole approval', async () => {
    const report = await assertExecutorResidue({
      name: 'test',
      executor: EXECUTOR,
      recipeInput: recipeInput(),
      recipeOutput: exactApprovalRecipe(),
      reader: fakeReader({}),
    });
    expect(report.violations).to.deep.equal([]);
    expect(report.executor).to.equal(EXECUTOR);
    expect(report.surface.allowances.length).to.equal(1);
  });

  it('Should throw ExecutorResidueError naming every violation', async () => {
    const promise = assertExecutorResidue({
      name: 'Blue Supply + Borrow',
      executor: EXECUTOR,
      recipeInput: recipeInput(),
      recipeOutput: exactApprovalRecipe(),
      reader: fakeReader({
        native: 3n,
        allowances: { [`${WETH.toLowerCase()}|${SPENDER.toLowerCase()}`]: 1000n },
      }),
    });
    await expect(promise).to.be.rejectedWith(
      /Blue Supply \+ Borrow: ephemeral executor .* did not end the batch clean \(2 violations\)/s,
    );
    const error = await promise.catch((err: unknown) => err);
    expect(error).to.be.instanceOf(ExecutorResidueError);
    expect((error as ExecutorResidueError).report.violations.map(v => v.kind))
      .to.deep.equal(['native-balance', 'allowance']);
  });

  /**
   * Fixtures prove the logic; a real recipe proves the shapes. `FxMintOpenRecipe`
   * is provider-free and constructs synchronously, so a real `RecipeOutput` is
   * available without a fork — and it happens to be one of the recipes that
   * grants an infinite allowance, so it exercises the finding as well as the
   * plumbing.
   */
  describe('against a real recipe output', () => {
    before(() => {
      setRailgunFees(
        NetworkName.Ethereum,
        MOCK_SHIELD_FEE_BASIS_POINTS,
        MOCK_UNSHIELD_FEE_BASIS_POINTS,
      );
    });

    const buildFxOpenOutput = async () => {
      const pool = resolvePool('wstETH-Long');
      const recipe = new FxMintOpenRecipe({
        pool: 'wstETH-Long',
        targetDebt: 5_000_000_000_000_000_000n,
        predictedPositionId: 1903n,
        borrowFeeRatio: 5_000_000n,
      });
      const input: RecipeInput = {
        railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
        networkName: NetworkName.Ethereum,
        erc20Amounts: [
          {
            tokenAddress: pool.collateralToken,
            decimals: pool.collateralDecimals,
            amount: 1_000_000n,
          },
        ],
        nfts: [],
      };
      return { pool, input, output: await recipe.getRecipeOutput(input) };
    };

    it('Should find the infinite collateral approval fx-mint-open really encodes', async () => {
      const { pool, input, output } = await buildFxOpenOutput();
      const surface = collectExecutorResidueSurface(input, output);

      const collateralAllowance = surface.allowances.find(
        a =>
          a.tokenAddress.toLowerCase() === pool.collateralToken.toLowerCase() &&
          a.spender.toLowerCase() === pool.poolManager.toLowerCase(),
      );
      expect(collateralAllowance).to.not.equal(undefined);
      expect(collateralAllowance?.encodedApproval).to.equal(
        UNBOUNDED_ALLOWANCE,
        'fx-mint-open passes no amount to ApproveERC20SpenderStep, so it approves max',
      );
      expect(collateralAllowance?.declaredBySteps).to.contain(
        'Approve ERC20 Spender',
      );

      // The position NFT the batch mints is in the surface too — an f(x) open
      // that failed leaves it on the executor rather than shielding it.
      expect(
        surface.nfts.map(nft => [nft.nftAddress, nft.tokenSubID]),
      ).to.deep.contain([pool.address, '0x76f']);

      // fxUSD is borrowed, never unshielded: an asset the recipe did not take
      // as input but which still passes through the executor.
      expect(
        surface.tokenAddresses.map(a => a.toLowerCase()),
      ).to.contain(FX_ADDRESSES.fxUSD.toLowerCase());
    });

    it('Should fail the batch when the max approval survives, and pass only with a stated exemption', async () => {
      const { pool, input, output } = await buildFxOpenOutput();
      const reader = fakeReader({
        allowances: {
          [`${pool.collateralToken.toLowerCase()}|${pool.poolManager.toLowerCase()}`]:
            UNBOUNDED_ALLOWANCE,
        },
      });

      await expect(
        assertExecutorResidue({
          name: 'fx open',
          executor: EXECUTOR,
          recipeInput: input,
          recipeOutput: output,
          reader,
        }),
      ).to.be.rejectedWith(/standing withdrawal right/);

      const report = await assertExecutorResidue({
        name: 'fx open',
        executor: EXECUTOR,
        recipeInput: input,
        recipeOutput: output,
        reader,
        policy: {
          allowances: [
            {
              tokenAddress: pool.collateralToken,
              spender: pool.poolManager,
              max: UNBOUNDED_ALLOWANCE,
              reason:
                'known defect: fx-mint-open-recipe omits the approve amount — see SHIPPED_APPROVAL_RESIDUE_POLICY',
            },
          ],
        },
      });
      expect(report.violations).to.deep.equal([]);
    });
  });

  it('Should reject a relay-adapt address as the executor', async () => {
    await expect(
      assertExecutorResidue({
        name: 'test',
        executor: NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract,
        recipeInput: recipeInput(),
        recipeOutput: recipeOutput(),
        reader: fakeReader({}),
      }),
    ).to.be.rejectedWith(/relay-adapt/i);
  });
});
