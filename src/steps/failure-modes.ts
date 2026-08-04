/**
 * =============================================================================
 * Break-vs-continue: what a 7702 batch leaves behind when one step fails
 * =============================================================================
 *
 * Every step's `crossContractCalls` are flattened into ONE `calls` array
 * (`Recipe.getRecipeOutput`), and the wallet SDK appends a single trailing
 * `shield(...)` self-call to it
 * (`RelayAdapt7702Contract.getOrderedCallsForCrossContractCalls`). That array is
 * handed to `RelayAdapt7702.execute` inside `ActionData`, and executed by
 * `_multicall`. So the on-chain shape of every recipe is:
 *
 *   railgun.transact(unshield)   <- atomic with the tx; reverts the whole tx
 *   call[0] ... call[n-1]        <- the steps, in order
 *   call[n] = self.shield(...)   <- the epilogue
 *
 * ## The four contract facts everything below rests on
 *
 * Source: `Railgun-Privacy/contract`, branch `zy0n/7702-relay-adapt`,
 * `contracts/adapt/RelayAdapt7702.sol`; deployed at
 * `0x05ae73c5925d843864ae6F261f3175De2ebCd963` on mainnet. All four are
 * re-asserted live against that deployed bytecode in
 * `__tests__/step-failure-modes.test.ts` using `eth_call`-family state
 * overrides — no fork node.
 *
 * 1. **`requireSuccess` is hardcoded `false`** on both 7702 paths
 *    (`wallet/src/services/transactions/tx-cross-contract-calls-7702.ts:254`
 *    for the estimate, `:423` for the proof). The engine's
 *    `shouldRequireSuccessForCrossContractCalls` never runs on this path.
 *
 * 2. **`false` means CONTINUE, not break.** `_multicall` runs every call in the
 *    array regardless of failures; a failed call emits `CallError(i, data)` and
 *    the loop proceeds to `i + 1`. There is no `break` anywhere in that
 *    function, in any revision of it. Consequences:
 *
 *    - a batch whose inner work fails still MINES, with `receipt.status === 1`;
 *      a failing cross-contract call can therefore NEVER produce `status 0`, so
 *      `status 0` excludes the entire cross-contract portion by construction
 *      (it means the unshield, the nonce, the signature, or the `minGasLimit`
 *      floor — see 4);
 *    - **the trailing shield still runs after a mid-batch failure.** This is the
 *      safety net that makes most of the table below benign;
 *    - `eth_estimateGas` converges on the cheapest gas at which the OUTER call
 *      succeeds, which is satisfied by a batch whose shield ran out of gas. It
 *      can and does return a value at which the shield fails (field evidence:
 *      mainnet `0x252155ef…`).
 *
 * 3. **The shield sweeps the executor's WHOLE balance, per token, and no-ops on
 *    zero.** Relay shield requests are always built with `preimage.value = 0n`
 *    (`RelayAdapt7702Helper.createRelayShieldRequestsERC20s`), and `value == 0`
 *    means `balanceOf(address(this))` in `RelayAdapt7702.shield`. Tokens whose
 *    balance is zero are filtered out, and if none survive the filter the whole
 *    call returns without touching RAILGUN. The request list is the union of
 *    every token appearing in ANY step's `outputERC20Amounts` plus every
 *    unhandled recipe input — so in practice every token the recipe ever names
 *    is swept back, at whatever balance the executor actually holds when the
 *    epilogue runs.
 *
 *    Hence the default outcome of a mid-batch failure: **the inputs come back
 *    shielded and whole.** `reshielded` below.
 *
 * 4. **`minGasLimit` is the only wholesale-revert guard.** `execute` checks
 *    `gasleft() > _actionData.minGasLimit` as its FIRST statement, before the
 *    nonce and signature checks. Under-gassing is the one condition that yields
 *    `status 0` with nothing spent. Everything past that check mines.
 *
 * ## The two ways the safety net fails
 *
 * The shield is one call. If it reverts, it reverts as a unit and NOTHING is
 * shielded — including tokens that were sitting there ready to be swept. Two
 * causes, both verified live:
 *
 * - **Gas.** The shield is last, so it inherits whatever the earlier calls left,
 *   minus the 63/64 reserve. A starved shield reverts with EMPTY revert data
 *   (out of gas, not a `require`) and the batch mines `status 1`. This is
 *   exactly the §4.1 mainnet loss.
 * - **An ERC-721 the executor does not own.** `shield` calls
 *   `token.approve(railgun, tokenSubID)` for every NFT request, unconditionally
 *   and before it touches any ERC-20 transfer. ERC-721 `approve` reverts for a
 *   non-owner (`ERC721InvalidApprover`) or a non-existent id
 *   (`ERC721NonexistentToken`) — and that revert takes the ERC-20 legs with it.
 *   One phantom NFT in the request list strands every token in the batch.
 *   `shieldRisk` below marks the steps that can put one there.
 *
 * ## What the shield can never bring back
 *
 * - **Native ETH.** `RelayAdapt7702.shield` handles ERC-20 and ERC-721 only, and
 *   `ShieldDefaultStep` refuses base-token outputs outright. Unwrapped ETH left
 *   at the executor is not swept by anything.
 * - **Un-tokenized positions.** A Morpho Blue collateral or debt balance is
 *   state inside the Blue singleton keyed by an address. There is no token to
 *   shield, so a position that opens and is not unwound stays attributable to a
 *   public address forever. Recoverable, not private — `public-recoverable`.
 * - **Value that left the system.** `TransferERC20Step` / `TransferBaseTokenStep`
 *   send to an external address. Once that call succeeds it is outside the
 *   batch's reach whatever happens next.
 * - **Allowances and authorizations.** Neither is value, so neither is swept.
 *   See `MorphoBlueSetAuthorizationStep` and `ApproveERC20SpenderStep`.
 *
 * ## Reading a row
 *
 * `onOwnFailure` — this step's own call(s) reverted, and the batch carried on.
 * `onLaterFailure` — this step SUCCEEDED and something after it reverted; i.e.
 * what this step's success leaves durable when the batch does not complete.
 *
 * Steps are safe to fail in proportion to how little of them survives their own
 * failure. The dangerous shape is not a step that fails — it is a step that
 * succeeds into a batch that does not finish.
 */

/** Where value or authority sits after the batch mines. */
export type StepFailureResidueLocation =
  /** The step moved nothing that outlives the batch. */
  | 'nothing'
  /** At the ephemeral EOA the batch ran as. */
  | 'executor'
  /** Inside a third-party protocol, keyed to an account (position, allowance). */
  | 'protocol'
  /** Outside the batch's reach — sent to an address the recipe named. */
  | 'external';

/** Who can get it back, and at what cost. */
export type StepFailureRecovery =
  /**
   * Cannot happen mid-batch at all: the failure reverts the whole transaction,
   * so there is no residue and nothing was spent.
   */
  | 'atomic-revert'
  /**
   * The trailing shield sweeps it back into the RAILGUN balance. The user ends
   * whole and still private. This is the default, and it is the reason
   * continue-semantics are safer than break-semantics would be.
   */
  | 'reshielded'
  /**
   * Survives at a public address (the executor, or a position keyed to one).
   * Recoverable by whoever controls that address, but the association is now
   * public and permanent. Privacy is the thing that was lost, not the value.
   */
  | 'public-recoverable'
  /**
   * Survives as protocol-side STATE rather than as value, so no sweep reaches
   * it and no re-run clears it. Removing it takes a deliberate, different
   * transaction that nothing prompts the caller to send.
   *
   * Distinct from `public-recoverable` on purpose. That one is recovered by
   * controlling the address — the wallet holds the ephemeral key, so it can
   * always collect what is sitting there. This one is not about custody at all:
   * you can control the account completely and the residue is still live.
   */
  | 'revoke-required'
  /**
   * Not recoverable by any party to the batch — the value left the system, or
   * the artifact was destroyed.
   */
  | 'unrecoverable';

export type StepFailureOutcome = {
  readonly residue: StepFailureResidueLocation;
  readonly recovery: StepFailureRecovery;
  /** What is left where, and who can move it. Concrete, not "may fail". */
  readonly detail: string;
};

export type StepFailureMode = {
  /** Step class name, exactly as exported. */
  readonly step: string;
  /** Entries this step contributes to the multicall `calls` array. */
  readonly calls: number | 'variable';
  /** This step's call reverted; the batch continued. */
  readonly onOwnFailure: StepFailureOutcome;
  /** This step succeeded; something later in the batch reverted. */
  readonly onLaterFailure: StepFailureOutcome;
  /**
   * Can this step cause the trailing `shield(...)` call itself to revert — and
   * so strand every token in the batch, not just its own?
   */
  readonly shieldRisk: false | { readonly when: string };
};

const modes: readonly StepFailureMode[] = [
  // ---------------------------------------------------------------------------
  // RAILGUN legs
  // ---------------------------------------------------------------------------
  {
    step: 'UnshieldDefaultStep',
    calls: 0,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'atomic-revert',
      detail:
        'The unshield is not in the calls array at all — it is ' +
        '`railgun.transact(_transactions)` inside `execute`, before `_multicall`. ' +
        'A failing unshield reverts the whole transaction: `status 0`, no notes ' +
        'nullified, no gas-successful mine. This is the only leg of a recipe with ' +
        'all-or-nothing semantics.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The unshielded tokens sit at the executor. Every one of them is in the ' +
        'shield request list (they are this step\'s `outputERC20Amounts`), so the ' +
        'epilogue sweeps them back in full — minus the unshield fee and the shield ' +
        'fee, which are the real cost of a failed batch.',
    },
    shieldRisk: false,
  },
  {
    step: 'ShieldDefaultStep',
    calls: 0,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        'This step emits no call of its own; the wallet SDK appends the single ' +
        '`shield(...)` self-call that it models. That call is the batch epilogue ' +
        'and its failure is the catastrophic case: it reverts as a unit, so NO ' +
        'token is shielded, and the entire balance — inputs, swap proceeds, ' +
        'borrowed tokens, everything — is left at the ephemeral EOA in the clear. ' +
        'The batch still mines `status 1` and `CallError(n, 0x)` with EMPTY revert ' +
        'data is the out-of-gas signature. Recovery requires the ephemeral key.',
    },
    onLaterFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'Nothing follows the shield; it is the last call in the array.',
    },
    shieldRisk: {
      when:
        'always — it IS the shield. It reverts on gas starvation (empty revert ' +
        'data), on any ERC-721 request the executor does not own, and on anything ' +
        'that makes `railgun.shield` revert (a share-gated ERC-4626 vault token ' +
        'is the shipped example: the gate blocks transfer to the RAILGUN proxy).',
    },
  },
  {
    step: 'DesignateShieldERC20RecipientStep',
    calls: 0,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'atomic-revert',
      detail:
        'Emits no cross-contract call. It only rewrites the `recipient` on step ' +
        'outputs, which changes which RAILGUN address the epilogue shields to. It ' +
        'cannot fail on chain; a bad recipient fails at build time.',
    },
    onLaterFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'The designation still applies: a mid-batch failure reshields the swept ' +
        'balance to the DESIGNATED address, not to the batch originator. Worth ' +
        'knowing before treating a failed batch as a no-op.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // Relay-adapt self-calls
  // ---------------------------------------------------------------------------
  {
    step: 'EmptyTransferBaseTokenStep',
    calls: 1,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'Cannot fail: a 0-value, 0-data call to the zero address always succeeds ' +
        '(codeless account, nothing to execute). Test scaffolding.',
    },
    onLaterFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'Moves nothing and holds nothing: a 0-value call to the zero address ' +
        'leaves no residue for a later failure to strand.',
    },
    shieldRisk: false,
  },
  {
    step: 'WrapBaseTokenStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        '`wrapBase(0)` wraps the executor\'s ENTIRE ETH balance; an explicit ' +
        'amount wraps that much. If it fails the ETH stays native at the ' +
        'executor — and native ETH is the one asset the shield epilogue cannot ' +
        'sweep (`shield` handles ERC-20/ERC-721 only, and `ShieldDefaultStep` ' +
        'refuses base-token outputs). Recovery needs the ephemeral key. Any ' +
        'downstream step expecting WETH also fails, but harmlessly.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The WETH is at the executor and WETH is in the shield request list, so ' +
        'the epilogue sweeps it. Wrapping is the step that makes base-token value ' +
        'recoverable at all.',
    },
    shieldRisk: false,
  },
  {
    step: 'UnwrapBaseTokenStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The WETH is untouched at the executor and is in the shield request list ' +
        '(it is this step\'s input, hence an earlier step\'s output), so it is ' +
        'swept back. Failing to unwrap is strictly safer than unwrapping.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        '`unwrapBase(0)` unwraps the ENTIRE WETH balance. Success converts a ' +
        'sweepable ERC-20 into unsweepable native ETH: if any later call fails, ' +
        'that ETH is stranded at the executor in the clear. Only ' +
        '`TransferBaseTokenStep` consumes it, so an unwrap that is not followed by ' +
        'a completed transfer is a privacy loss.',
    },
    shieldRisk: false,
  },
  {
    step: 'TransferBaseTokenStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        'The ETH stays native at the executor, unsweepable (see ' +
        '`WrapBaseTokenStep`). The base-token branch of ' +
        '`RelayAdapt7702.transfer` is a raw `.call` guarded by ' +
        '`require(success, "RelayAdapt: ETH transfer failed")`, so a recipient ' +
        'that rejects ETH — or that exhausts the forwarded gas — fails the ' +
        'whole `transfer` call rather than just its own entry.',
    },
    onLaterFailure: {
      residue: 'external',
      recovery: 'unrecoverable',
      detail:
        'The ETH is with the external recipient. `value = 0` means send the ' +
        'ENTIRE balance, which is what the step encodes when constructed without ' +
        'an amount. Nothing later in the batch can pull it back.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // ERC-20 primitives
  // ---------------------------------------------------------------------------
  {
    step: 'ApproveERC20SpenderStep',
    calls: 1,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'No allowance is set, so the protocol call that depends on it also fails ' +
        '(its `transferFrom` reverts) and the batch degrades into a no-op with ' +
        'everything reshielded. Benign, and the cascade is the intended shape. ' +
        'For USDT the step emits TWO calls (clear-to-zero then set); if only the ' +
        'clear lands, the residual allowance is 0, which is the safe direction.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'public-recoverable',
      detail:
        'The allowance survives at the executor, granted to the spender, and the ' +
        'shield cannot sweep an allowance. It is NOT always exact: ' +
        '`approveAmount = amount ?? maxBigNumberForTransaction()`, so the two ' +
        'shipped call sites that omit the amount — `ZeroXV2SwapRecipe` (0x ' +
        'spender) and the f(x) open / top-up recipes (PoolManager, collateral ' +
        'token) — leave an UNLIMITED allowance behind. On a reusable executor ' +
        'that is a standing grant, not a per-batch artifact.',
    },
    shieldRisk: false,
  },
  {
    step: 'TransferERC20Step',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The token stays at the executor and is swept by the epilogue. Note ' +
        '`RelayAdapt7702.transfer` takes an ARRAY and has no per-entry error ' +
        'handling, so a step that ever batches several entries would lose them ' +
        'all to one failure; every shipped step emits exactly one.',
    },
    onLaterFailure: {
      residue: 'external',
      recovery: 'unrecoverable',
      detail:
        'The token is with the external recipient — `value = 0` sends the entire ' +
        'balance. This is the only ERC-20 step whose success is irreversible ' +
        'relative to the rest of the batch, so it belongs last among the ' +
        'value-moving steps.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // Swap
  // ---------------------------------------------------------------------------
  {
    step: 'ZeroXV2SwapStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The sell token is untouched at the executor and is in the shield request ' +
        'list, so it comes back. The buy token never arrives, so every downstream ' +
        'step that wanted it fails too — also harmlessly. A stale or ' +
        'slippage-busted quote therefore costs the unshield + shield fees and ' +
        'nothing else.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The buy token is at the executor and is declared in this step\'s ' +
        '`outputERC20Amounts`, so it is in the request list and is swept at ' +
        'whatever amount actually filled. The unlimited allowance granted to the ' +
        '0x spender by the preceding approve survives — see ' +
        '`ApproveERC20SpenderStep`.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // Uniswap-v2-like liquidity
  // ---------------------------------------------------------------------------
  {
    step: 'UniV2LikeAddLiquidityStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Both input tokens stay at the executor and both are in the request list. ' +
        'No LP token is minted. The router\'s `deadline` and min-amounts make this ' +
        'the expected outcome of a stale quote.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'LP tokens are minted to the executor (router `to` = the executor) and ' +
        'the LP token is declared as an output, so it is swept back shielded. ' +
        'Change on either side is swept too.',
    },
    shieldRisk: false,
  },
  {
    step: 'UniV2LikeRemoveLiquidityStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The LP token is untouched at the executor and is in the request list ' +
        '(it is the recipe input), so it is reshielded. The position is unchanged.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Both underlying tokens are at the executor and both are declared ' +
        'outputs, so both are swept.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // Beefy vaults (tokenized, ERC-20 receipt)
  // ---------------------------------------------------------------------------
  {
    step: 'BeefyDepositStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        '`depositAll()` moved nothing; the deposit token is at the executor and ' +
        'in the request list. Reshielded whole.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The vault receipt token (`vaultERC20Address`) is at the executor and is ' +
        'a declared output, so the position is swept back as a token. Tokenized ' +
        'vaults are the benign case: the position IS an ERC-20, so the epilogue ' +
        'can re-privatise it.',
    },
    shieldRisk: false,
  },
  {
    step: 'BeefyWithdrawStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The vault token is untouched at the executor and in the request list. ' +
        'Reshielded.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail: 'The withdrawn deposit token is a declared output and is swept.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // MetaMorpho / ERC-4626 vaults (tokenized shares)
  // ---------------------------------------------------------------------------
  {
    step: 'MetaMorphoDepositStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'No shares minted; the asset is at the executor and in the request list. ' +
        'This is also the outcome when a Vaults-V2 `canReceiveShares` /' +
        '`canSendAssets` gate rejects the executor — `assertVaultNotGated` ' +
        'exists to turn that into a build-time diagnosis instead.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Shares are minted to the executor and the share token (the vault ' +
        'address) is a declared output, so the epilogue sweeps them back ' +
        'shielded — UNLESS the vault is share-gated, in which case the shield ' +
        'itself reverts. See `shieldRisk`.',
    },
    shieldRisk: {
      when:
        'the vault enforces a share gate. The shield leg is ' +
        '`transferFrom(executor -> RAILGUN proxy)`, gate-checked on BOTH ' +
        'endpoints (`canSendShares(from)` and `canReceiveShares(to)`), and the ' +
        'proxy is a fixed third party no curator allowlist contains. A gated ' +
        'vault therefore accepts the deposit and then makes the shield revert, ' +
        'taking every other token in the batch with it.',
    },
  },
  {
    step: 'MetaMorphoWithdrawStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Shares are untouched at the executor and in the request list, so they ' +
        'are reshielded. Typical cause is vault illiquidity, which is transient.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail: 'The redeemed asset is a declared output and is swept.',
    },
    shieldRisk: false,
  },
  {
    step: 'MetaMorphoWithdrawByAssetsStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Shares are untouched and in the request list. The step over-declares ' +
        'consumption at `maxShares`, so a failure leaves MORE than declared at ' +
        'the executor — which the sweep handles, because the sweep reads the real ' +
        'balance rather than the declared amount.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The exact asset amount plus the unburned share remainder are both at ' +
        'the executor and both are declared outputs; both are swept.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // Morpho Blue — address-bound, un-tokenized positions
  // ---------------------------------------------------------------------------
  {
    step: 'MorphoBlueSupplyCollateralStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The collateral is at the executor and in the request list; reshielded ' +
        'whole. The Blue position is unchanged, so a failed supply is a clean ' +
        'no-op — and any borrow after it fails too, for lack of collateral.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'public-recoverable',
      detail:
        'The collateral is now `position[id][onBehalf].collateral` inside the ' +
        'Blue singleton. It is NOT a token, so the epilogue cannot sweep it and ' +
        'the value cannot be re-privatised by this batch. Recovery is a second ' +
        'batch that runs as (or is authorized by) `onBehalf` and calls ' +
        '`withdrawCollateral`. The association between that address and the ' +
        'collateral is public and permanent. This is the canonical "recoverable ' +
        'but no longer private" case.',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoBlueBorrowStep',
    calls: 1,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'No debt is drawn and no token is produced. Everything else in the batch ' +
        'reshields. Safe to fail — the common causes (insufficient collateral, ' +
        'market illiquidity, an oracle move) all leave the position exactly as it ' +
        'was.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'public-recoverable',
      detail:
        'Two residues, and they are not symmetric. The borrowed loan token is at ' +
        'the executor, is a declared output, and IS swept back shielded. The DEBT ' +
        'is booked against `onBehalf` inside Blue and is not: it stays, accrues ' +
        'interest, and can be liquidated by anyone at any time with no wallet ' +
        'involvement. A batch that borrows and then fails leaves a live, public, ' +
        'liquidatable obligation — read it back with `MorphoBlueAPI.getPositionRisk`.',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoBlueRepayStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The loan token is at the executor and in the request list; reshielded. ' +
        'The debt is unchanged, so any `withdrawCollateral` after it fails its ' +
        'health check and also no-ops. A failed close is a clean close-nothing.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'reshielded',
      detail:
        'The debt reduction is real and is the direction you wanted; nothing is ' +
        'stranded. The residual Blue allowance from the preceding approve ' +
        'survives (exact-amount at every shipped call site, so it is exactly the ' +
        'unspent remainder).',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoBlueRepaySharesStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Same as the assets-mode repay, and the conservative `maxRepaidAssets` ' +
        'sizing means a failure caused by interest drift exceeding the buffer is ' +
        'a revert-safe no-op, never a partial burn: `repay(0, shares)` burns all ' +
        'the shares or none.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'reshielded',
      detail:
        'The debt is reduced by exactly `repayShares`. The unspent portion of ' +
        '`maxRepaidAssets` is at the executor and is swept.',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoBlueWithdrawCollateralStep',
    calls: 1,
    onOwnFailure: {
      residue: 'protocol',
      recovery: 'public-recoverable',
      detail:
        'The collateral stays inside Blue, keyed to `onBehalf`. Nothing is lost, ' +
        'but the position is still public and still there — the usual cause is ' +
        'the health check refusing the withdrawal, which means the debt leg of ' +
        'the same batch did not do what the quote assumed.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The collateral is at the executor (`receiver`) and is a declared output, ' +
        'so it is swept back shielded.',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoBlueSetAuthorizationStep',
    calls: 1,
    onOwnFailure: {
      residue: 'nothing',
      recovery: 'reshielded',
      detail:
        'No authorization is granted, so whatever needed it fails too. Benign — ' +
        'the fail-closed direction.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'revoke-required',
      detail:
        'The grant survives. `isAuthorized[executor][authorized] = true` inside ' +
        'Blue is standing authority over EVERY position that executor holds, now ' +
        'and in future — not value, so the shield cannot sweep it, and not ' +
        'balance, so re-running the recipe does not clear it. This is the only ' +
        'residue here that holding the ephemeral key does not solve: everything ' +
        'else left on the executor can be collected in a follow-up transaction, ' +
        'and this cannot. Wrap the grant in ' +
        '`withScopedMorphoBlueAuthorization` when it is a means to something ' +
        'else in the same batch — the trailing revoke still runs when the ' +
        'wrapped steps fail, because continue-semantics do not skip it. Use the ' +
        'step bare only when the grant is meant to outlive the batch.',
    },
    shieldRisk: false,
  },
  {
    step: 'MorphoTransactStep',
    calls: 'variable',
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'THE BUNDLE IS NOT ATOMIC. It contributes N calls to the array and ' +
        '`_multicall` continues past each failure, so calls after a failing one ' +
        'still run — against state the bundle compiler assumed would exist. A ' +
        'Morpho SDK bundle is authored under the assumption that it reverts as a ' +
        'unit; on this path it does not. Pulled tokens that were never pulled are ' +
        'at the executor and are swept, but a half-applied bundle can leave ' +
        'protocol state the bundle\'s own accounting does not model. Treat every ' +
        '`CallError` index inside a bundle as unexplained until read back on chain.',
    },
    onLaterFailure: {
      residue: 'protocol',
      recovery: 'public-recoverable',
      detail:
        'Declared `outputs` land at the executor and are swept. Anything the ' +
        'bundle did that is not an ERC-20 at the executor — a Blue position, an ' +
        'authorization, a Bundler3 side effect — is not swept and is public.',
    },
    shieldRisk: false,
  },

  // ---------------------------------------------------------------------------
  // f(x) fxMint — bearer positions (ERC-721)
  // ---------------------------------------------------------------------------
  {
    step: 'FxMintOpenPositionStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        'WORSE THAN THE ERC-20 STEPS, AND FOR A REASON THAT IS NOT ABOUT THE ' +
        'COLLATERAL. The collateral is untouched at the executor and would be ' +
        'swept — but the recipe has already declared the position NFT in ' +
        '`outputNFTs` at `predictedPositionId`, so the epilogue carries an ' +
        'ERC-721 shield request for a token that was never minted. ' +
        '`RelayAdapt7702.shield` calls `approve(railgun, id)` on it before any ' +
        'ERC-20 work, that reverts (`ERC721NonexistentToken`, or ' +
        '`ERC721InvalidApprover` if another opener took the id), and the WHOLE ' +
        'shield call reverts with it. Net result: `operate()` failed AND nothing ' +
        'was reshielded — the collateral sits at the ephemeral EOA in the clear. ' +
        'Recovery needs the ephemeral key.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'public-recoverable',
      detail:
        'The position exists and its NFT is at the executor. If the id matched ' +
        'the prediction the epilogue shields both the NFT and the borrowed debt ' +
        'token and nothing is lost. If the id did NOT match (the §4.2 race: ' +
        '`operate()` encodes positionId 0 and cannot revert on a taken id), the ' +
        'shield reverts on the phantom id and BOTH the position NFT and every ' +
        'ERC-20 in the batch stay at the executor, public.',
    },
    shieldRisk: {
      when:
        'always, unless `operate()` mints exactly `predictedPositionId`. The ' +
        'predicted id is declared in `outputNFTs` unconditionally, so both a ' +
        'failed open and a won-by-someone-else id race put an unowned ERC-721 in ' +
        'the shield request list — and one unowned NFT strands every ERC-20 in ' +
        'the batch. Read `getNextPositionId()` as late as possible.',
    },
  },
  {
    step: 'FxMintAdjustPositionStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Benign, and materially safer than open: the position NFT was unshielded ' +
        'INTO the executor, so the executor genuinely owns the id declared in ' +
        '`outputNFTs` whether or not `operate()` succeeded. The epilogue shields ' +
        'the NFT back and sweeps the untouched collateral or debt token. The ' +
        'position is unchanged.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The adjustment is applied, the NFT is re-shielded, and any withdrawn ' +
        'collateral or borrowed debt token is a declared output and is swept.',
    },
    shieldRisk: false,
  },
  {
    step: 'FxMintClosePositionStep',
    calls: 1,
    onOwnFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'Benign on both branches. The executor owns the NFT going in and still ' +
        'owns it whatever `operate()` does — f(x) does not burn on close — so ' +
        'the epilogue always has a resolvable shield request for it and the ' +
        'batch degrades to a no-op with the position and debt token reshielded. ' +
        'Until the close step declared the NFT unconditionally this was the ' +
        'worst entry in this table: the full-close branch emitted ' +
        '`outputNFTs: []` and claimed the NFT in `spentNFTs`, so a SUCCESSFUL ' +
        'full close left the position handle public at the ephemeral EOA, and a ' +
        'failed one did the same with the debt token swept back around it.',
    },
    onLaterFailure: {
      residue: 'executor',
      recovery: 'reshielded',
      detail:
        'The released collateral is a declared output and is swept, and the NFT ' +
        'is reshielded on both branches. A closed position is a live NFT ' +
        'holding nothing, so the surviving handle is NOT evidence the close ' +
        'failed — the `outputPositions` records are the only description of what ' +
        'was retired.',
    },
    shieldRisk: false,
  },
];

/**
 * Break-vs-continue semantics, per step, keyed by step class name.
 *
 * Completeness is enforced: `__tests__/step-failure-modes.test.ts` walks every
 * `*-step.ts` module under `src/steps/` and fails if a `Step` subclass has no
 * entry here (or an entry names a class that no longer exists).
 */
export const STEP_FAILURE_MODES: Readonly<Record<string, StepFailureMode>> =
  Object.freeze(
    Object.fromEntries(modes.map(mode => [mode.step, mode] as const)),
  );

/** Failure modes for a step, by class name. */
export const getStepFailureMode = (
  stepName: string,
): Optional<StepFailureMode> => STEP_FAILURE_MODES[stepName];

/**
 * Steps that can make the trailing `shield(...)` call itself revert.
 *
 * These are the only steps whose failure is not contained: the shield reverts as
 * a unit, so one of these strands every token in the batch, not just its own.
 */
export const stepsThatCanPoisonTheShield = (): readonly StepFailureMode[] =>
  modes.filter(mode => mode.shieldRisk !== false);

/**
 * Steps whose SUCCESS leaves something the shield epilogue cannot sweep, so that
 * an unfinished batch costs privacy (or the value outright) rather than fees.
 *
 * This is the list to consult when ordering a recipe: put these as late as
 * possible, because everything after them is a step that can strand them.
 */
export const stepsWithDurableResidueOnLaterFailure =
  (): readonly StepFailureMode[] =>
    modes.filter(
      mode =>
        mode.onLaterFailure.recovery === 'public-recoverable' ||
        mode.onLaterFailure.recovery === 'revoke-required' ||
        mode.onLaterFailure.recovery === 'unrecoverable',
    );
