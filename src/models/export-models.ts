import {
  NFTTokenType,
  NetworkName,
  RailgunNFTAmount,
} from '@railgun-community/shared-models';
import { ContractTransaction } from 'ethers';

export type CookbookDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};

export type RecipeERC20Info = {
  tokenAddress: string;
  decimals: bigint;
  isBaseToken?: boolean;
};

export type RecipeERC20Amount = RecipeERC20Info & {
  amount: bigint;
  recipient?: string;
};

export type RecipeERC20AmountRecipient = RecipeERC20Amount & {
  recipient: string;
  // Worst-case (minimum) balance for a non-deterministic output, carried so a
  // ComboMeal seam can feed a downstream recipe a conservative amount instead of
  // the optimistic `amount` (= expectedBalance). Optional; unset ⇒ `amount` is
  // the deterministic value.
  minBalance?: bigint;
};

export type RecipeNFTInfo = RailgunNFTAmount & {
  owns?: string;
  recipient?: string;
};

export type RecipeNFTRecipient = RailgunNFTAmount & {
  recipient: string;
};

// =============================================================================
// Positions — a fourth output channel.
//
// The other channels can only describe things the *executing account* holds or
// parts with. A Morpho Blue position is neither: it is un-tokenized state keyed
// by an address inside the Blue singleton. So `MorphoBlueSupplyCollateralStep`
// could only report its collateral as "spent to" the literal string
// `'Morpho Blue Market'`, and the position it created was invisible in the
// recipe output — a consumer had to know out of band that one now exists.
//
// The rule that keeps this channel coherent:
//
//   the ERC-20 / NFT channels describe what the CALLER sees;
//   a position record describes what the POSITION sees.
//
// The two differ wherever a protocol charges a fee on one side only, and f(x)
// is the worked example: borrowing `targetDebt` adds exactly `targetDebt` to
// the position's debt but pays the caller `targetDebt - borrowFee`; supplying
// `X` costs the caller exactly `X` but credits the position `X - supplyFee`.
// Reusing the caller-facing figure in either direction misreports the position
// by the fee — 0.5% and 0.3% respectively on the pools that charge them.
//
// **Records are deltas, not balances.** A step knows what it changes; it reads
// no chain state, so it cannot know the resulting total. For the ordinary 7702
// flow — a fresh ephemeral executor supplying collateral and borrowing against
// it in one batch — the delta IS the resulting position, which is what this
// channel exists to make renderable. Against a pre-existing position it is not,
// and a consumer must apply it to what it already knows (or read the position
// back; `MorphoBlueAPI.getPositionRisk` is the reader for that).
// =============================================================================

/**
 * Protocol a position lives in.
 *
 * A closed union rather than a free-form string: these values are join keys — a
 * rediscovery reader, a risk panel and a portfolio roll-up all match on them —
 * and a typo in a free string yields a second protocol that silently matches
 * nothing. Widen it here when adding one.
 */
export type RecipePositionProtocol = 'morpho-blue' | 'fx';

/**
 * Which leg of a position the record describes.
 *
 * - `collateral` — assets pledged to back a borrow.
 * - `debt` — assets owed.
 * - `supply` — assets lent out to earn. Deliberately distinct from
 *   `collateral`: Morpho Blue tracks the two in separate words of the same
 *   position (`supplyShares` vs `collateral`) and only `collateral` backs a
 *   borrow, so collapsing them would let a UI show lent assets as
 *   liquidation-protecting. No shipped step emits `supply` yet — the Blue lend
 *   side does not exist — but naming it here means that side arrives as a new
 *   producer rather than as a change to this type.
 */
export type RecipePositionKind = 'collateral' | 'debt' | 'supply';

/**
 * Sign of the change.
 *
 * Carried as a discriminator rather than as a signed `amount`, because every
 * other amount in this file is an unsigned magnitude and one signed field among
 * them would eventually be read as unsigned.
 */
export type RecipePositionDirection = 'increase' | 'decrease';

type RecipePositionBase = {
  protocol: RecipePositionProtocol;
  /**
   * The venue the position lives in, in whatever form that protocol addresses
   * it: a Morpho Blue market id (`bytes32`), or an f(x) pool address (which is
   * also that pool's position-NFT contract).
   *
   * Case is NOT normalised across protocols — a Blue market id comes back from
   * `keccak256` lowercased, an f(x) pool address is checksummed — so compare
   * case-insensitively.
   */
  marketOrPoolId: string;
  kind: RecipePositionKind;
  direction: RecipePositionDirection;
  /**
   * Token this leg is denominated in.
   *
   * Spelled out rather than reusing {@link RecipeERC20Info}, whose optional
   * `isBaseToken` has no meaning here: both shipped protocols take ERC-20s
   * only, so a position denominated in the chain's native asset is not a state
   * either can produce, and admitting the flag would invite a consumer to
   * branch on it.
   */
  tokenAddress: string;
  decimals: bigint;
  /**
   * Magnitude of the change, in native `decimals` units. Always `>= 0` — the
   * sign lives in {@link RecipePositionDirection}.
   */
  amount: bigint;
  /**
   * Share-denominated magnitude, for an operation the protocol expresses in
   * shares rather than assets (`Morpho.repay(0, shares)`).
   *
   * Present only when the protocol tracks the leg in shares. It does not by
   * itself say which of the two figures is exact — read `estimateReason`, which
   * names the approximate one. For the one producer today (a shares-mode Blue
   * repay) `shares` is exact and `amount` is the expected asset equivalent.
   */
  shares?: bigint;
  /**
   * Present only when `amount` is not the exact on-chain delta, stating why and
   * which way it errs. Absence means exact.
   *
   * A reason string rather than a boolean on purpose: a producer that cannot be
   * exact has to say what it does not know, and a consumer can surface that
   * verbatim beside the number instead of inventing its own caveat.
   */
  estimateReason?: string;
};

/**
 * A position whose owner is an account address — Morpho Blue's `onBehalf`.
 *
 * Nothing is minted: the account IS the handle, and it must be the identical
 * account in every later batch that touches the position.
 */
export type RecipeAddressBoundPosition = RecipePositionBase & {
  custody: 'address-bound';
  /**
   * Account the position is booked against.
   *
   * This is the OWNER, not the receiver. Morpho's `borrow` debits `onBehalf`
   * while paying `receiver`, and the two are the same address only because the
   * shipped builders collapse them; when they diverge, this field must keep
   * tracking `onBehalf`.
   *
   * A plain, already-resolved, checksummed address string. Note this is NOT the
   * `PositionOwner` type from `utils/7702`: that one is an INPUT-boundary alias
   * (`EphemeralExecutor | string`) for what a builder will accept, and a
   * resolved output must not be re-widened to admit a wrapper object. Revisit
   * only if a nominal brand for an already-resolved owner ever appears.
   */
  owner: string;
};

/**
 * A position held by whoever holds a token — f(x), where each `Pool` is itself
 * the ERC-721 contract and the position id is the token id.
 *
 * There is deliberately no `owner`. The f(x) steps do not have one to give:
 * `operate()` mints to `msg.sender` (the ephemeral EOA under 7702), and unlike
 * the Morpho builders no f(x) step or recipe is ever handed that address — the
 * family is provider-free and never names an executor. The durable handle is
 * the NFT, which the step also declares in `outputNFTs`/`spentNFTs`; the step
 * validator checks the two agree.
 */
export type RecipeBearerPosition = RecipePositionBase & {
  custody: 'bearer';
  nftAddress: string;
  tokenSubID: string;
  nftTokenType: NFTTokenType;
};

/**
 * One change a step makes to a protocol position.
 *
 * A union rather than a flat record with two optional handles: an address-bound
 * position always has an owner and a bearer position never does, so
 * `owner?: string` would let a consumer write `p.owner!` and get `undefined`
 * for every f(x) position. The fields both variants share — protocol, venue,
 * kind, direction, token, amount — need no narrowing, which is the uniformity
 * this channel is for; only reaching for the *handle* makes a caller say which
 * kind of handle it wants, because an account and a bearer token are genuinely
 * different objects.
 */
export type RecipePositionInfo =
  | RecipeAddressBoundPosition
  | RecipeBearerPosition;

export type RecipeInput = {
  networkName: NetworkName;
  railgunAddress: string;
  erc20Amounts: RecipeERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type StepInput = {
  networkName: NetworkName;
  erc20Amounts: StepOutputERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type RecipeOutput = {
  name: string;
  stepOutputs: StepOutput[];
  crossContractCalls: ContractTransaction[];
  erc20AmountRecipients: RecipeERC20AmountRecipient[];
  nftRecipients: RecipeNFTRecipient[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
  /**
   * Every position change the recipe's steps make, in step order.
   *
   * Always present (empty for a recipe that touches no position) so a consumer
   * never has to write `?? []`. There is deliberately no counterpart on
   * {@link RecipeInput}: positions are an output-only channel — no step
   * *consumes* one, and threading them in would create a second, unreconciled
   * source of truth alongside the on-chain reader.
   */
  outputPositions: RecipePositionInfo[];
  minGasLimit: bigint;
};

export type StepOutputERC20Amount = RecipeERC20Info & {
  expectedBalance: bigint;
  minBalance: bigint;
  approvedSpender: Optional<string>;
  recipient?: string;
};

export type UnvalidatedStepOutput = {
  crossContractCalls: ContractTransaction[];
  outputERC20Amounts: StepOutputERC20Amount[];
  spentERC20Amounts?: RecipeERC20AmountRecipient[];
  spentNFTs?: RecipeNFTInfo[];
  outputNFTs: RecipeNFTInfo[];
  feeERC20AmountRecipients?: RecipeERC20AmountRecipient[];
  /**
   * Position changes this step makes. Optional, like the other channels a step
   * may legitimately have nothing to say about — the great majority of steps
   * (swaps, approvals, wraps, shields) touch no position at all.
   */
  outputPositions?: RecipePositionInfo[];
};

export type StepOutput = UnvalidatedStepOutput & {
  name: string;
  description: string;
};

export type StepConfig = {
  name: string;
  description: string;
  hasNonDeterministicOutput?: boolean;
};

export type RecipeConfig = {
  name: string;
  description: string;
  minGasLimit: bigint;
};

export type ComboMealConfig = {
  name: string;
  description: string;
  minGasLimit: bigint;
};

export type SwapQuoteData = {
  price: bigint;
  guaranteedPrice: bigint;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: bigint;
  spender: Optional<string>;
  crossContractCall: ContractTransaction;
  slippageBasisPoints: bigint;
  sellTokenAddress: string;
  sellTokenValue: string;
};

export type SwapQuoteDataV2 = SwapQuoteData & {
  zid: string;
};

export type SwapQuoteParamsV2 = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: number;
  isRailgun: boolean;
  /**
   * On-chain recipient of the swap output (0x `taker`/`txOrigin`). Under
   * EIP-7702 the cross-contract batch executes as the ephemeral EOA, so this
   * must be that account; the legacy relay-adapt contract is no longer used.
   */
  recipient: string;
};

export type GetSwapQuoteV2 = (
  swapQuoteParams: SwapQuoteParamsV2,
) => Promise<SwapQuoteDataV2>;

export type RecipeAddLiquidityData = {
  erc20AmountA: RecipeERC20Amount;
  erc20AmountB: RecipeERC20Amount;
  expectedLPAmount: RecipeERC20Amount;
  slippageBasisPoints: bigint;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export type RecipeRemoveLiquidityData = {
  lpERC20Amount: RecipeERC20Amount;
  expectedERC20AmountA: RecipeERC20Amount;
  expectedERC20AmountB: RecipeERC20Amount;
  slippageBasisPoints: bigint;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export enum UniswapV2Fork {
  Uniswap = 'Uniswap',
  SushiSwap = 'SushiSwap',
  PancakeSwap = 'PancakeSwap',
  Quickswap = 'Quickswap',
}


// ZeroXV2 
export type BaseAPIParamsV2 = {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
};

export type QuoteParamsV2 = BaseAPIParamsV2 & {
  taker: string;
  txOrigin: string; // The contract address of the external account that started the transaction. This is only needed if taker is a smart contract.
  slippageBps?: number; //Default: 100 - The maximum acceptable slippage of the buyToken in Bps. If this parameter is set to 0, no slippage will be tolerated. If not provided, the default slippage tolerance is 100Bps
  excludedSources: "0x_RFQ,Uniswap_V3"
};

export type ZeroXV2Transaction = {
  to: string;
  data: string;
  value: string;
  gasPrice: string;
  gas: string;
};

export type ZeroXV2Allowance = {
  actual: string; //The taker's current allowance of the spender
  spender: string; //The address to set the allowance on
};

export type ZeroXV2Balance = {
  token: string; // The contract address of the sellToken
  actual: string; // The current balance of the sellToken in the taker address
  expected: string; // The balance of the sellToken required for the swap to execute successfully
};

export type ZeroXV2Issues = {
  allowance: ZeroXV2Allowance;
  balance: ZeroXV2Balance;
  simulationIncomplete: boolean; //This is set to true when 0x cannot validate the transaction. This happens when the taker has an insufficient balance of the sellToken and 0x is unable to peform ehanced quote validation with the low balance. Note that this does not necessarily mean that the trade will revert
  invalidSourcesPassed: string[]; // A list of invalid sources present in excludedSources request. See https://api.0x.org/sources?chainId= with the desired chain's ID for the list of valid sources
};

export type ZeroXV2PriceData = {
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  sellToken: string;
  transaction: ZeroXV2Transaction;
  liquidityAvailable: boolean; // This validates the availability of liquidity for the quote requested. The rest of the fields will only be returned if true
  zid: string; // The unique ZeroEx identifier of the request
  issues: ZeroXV2Issues;
};

export type ZeroXAPIErrorData = {
  name: string;
  message: string;
  data?: {
    details?: Array<{
      field: string;
      reason: string;
    }>;
  };
}