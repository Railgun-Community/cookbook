import fs from 'fs';
import path from 'path';
import chai from 'chai';
import {
  AbiCoder,
  Interface,
  Wallet,
  keccak256,
  id as keccakId,
  toBeHex,
} from 'ethers';
import { Step } from '../step';
import {
  STEP_FAILURE_MODES,
  StepFailureMode,
  getStepFailureMode,
  stepsThatCanPoisonTheShield,
  stepsWithDurableResidueOnLaterFailure,
} from '../failure-modes';

const { expect } = chai;

// =============================================================================
// Part 1 — the table is complete and internally coherent (offline)
// =============================================================================

const STEPS_ROOT = path.join(__dirname, '..');

const stepModuleFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : stepModuleFiles(full);
      }
      return entry.isFile() && entry.name.endsWith('-step.ts') ? [full] : [];
    })
    .sort();

const discoveredStepClasses = (): Map<string, string> => {
  const found = new Map<string, string>();
  stepModuleFiles(STEPS_ROOT).forEach(file => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, @typescript-eslint/no-unsafe-assignment
    const mod = require(file) as Record<string, unknown>;
    Object.entries(mod).forEach(([exportName, value]) => {
      if (typeof value !== 'function') {
        return;
      }
      if (!(value.prototype instanceof Step)) {
        return;
      }
      found.set(exportName, path.relative(STEPS_ROOT, file));
    });
  });
  return found;
};

describe('step-failure-modes', () => {
  it('Should document break-vs-continue semantics for every shipped Step', () => {
    const discovered = discoveredStepClasses();

    // Sanity: the walk found the tree, not an empty directory.
    expect(discovered.size).to.be.greaterThan(20);

    const undocumented = [...discovered.entries()]
      .filter(([name]) => !(name in STEP_FAILURE_MODES))
      .map(([name, file]) => `${name} (${file})`);
    expect(
      undocumented,
      'every Step subclass needs an entry in STEP_FAILURE_MODES — a new step ' +
        'must say what it leaves behind when the batch continues past its failure',
    ).to.deep.equal([]);

    const stale = Object.keys(STEP_FAILURE_MODES).filter(
      name => !discovered.has(name),
    );
    expect(
      stale,
      'STEP_FAILURE_MODES names a step class that no longer exists',
    ).to.deep.equal([]);
  });

  it('Should keep every row internally coherent', () => {
    Object.values(STEP_FAILURE_MODES).forEach((mode: StepFailureMode) => {
      const where = `${mode.step}`;

      [mode.onOwnFailure, mode.onLaterFailure].forEach(outcome => {
        // Prose, not hand-waving. "may fail" is not an answer.
        expect(outcome.detail.length, `${where}: detail too thin`).to.be.greaterThan(
          40,
        );
        expect(outcome.detail, `${where}: vague detail`).to.not.match(
          /\b(may|might|could|possibly) (fail|revert|be)\b/i,
        );

        // Residue and recovery have to agree about whether anything survives.
        if (outcome.residue === 'nothing') {
          expect(
            ['reshielded', 'atomic-revert'],
            `${where}: nothing survives, so recovery cannot be ${outcome.recovery}`,
          ).to.include(outcome.recovery);
        }
        if (outcome.residue === 'external') {
          expect(
            outcome.recovery,
            `${where}: value that left the batch cannot be reshielded`,
          ).to.equal('unrecoverable');
        }
        if (outcome.residue === 'protocol') {
          // A protocol residue is never swept — there is no token at the
          // executor for the shield epilogue to find. It is the direction the
          // user wanted (a repay), a public leftover, or protocol-side state
          // that only an explicit revoke removes.
          expect(
            ['reshielded', 'public-recoverable', 'revoke-required'],
            `${where}: protocol residue`,
          ).to.include(outcome.recovery);
        }

        // `revoke-required` is the one outcome holding the ephemeral key does
        // not solve, so it must never be claimed for a residue sitting at the
        // executor — that IS recoverable by sweeping.
        if (outcome.recovery === 'revoke-required') {
          expect(
            outcome.residue,
            `${where}: revoke-required means protocol-side state, not value at an address`,
          ).to.equal('protocol');
        }
      });

      // atomic-revert is a property of the leg, not of a moment: only a step
      // that emits no multicall entry can revert the whole transaction.
      if (
        mode.onOwnFailure.recovery === 'atomic-revert' ||
        mode.onLaterFailure.recovery === 'atomic-revert'
      ) {
        expect(mode.calls, `${where}: atomic-revert implies no multicall entry`).to.equal(
          0,
        );
      }

      if (mode.shieldRisk !== false) {
        expect(
          mode.shieldRisk.when.length,
          `${where}: shieldRisk must say when`,
        ).to.be.greaterThan(40);
      }
    });
  });

  it('Should name exactly the steps that can strand the whole batch', () => {
    // The shield reverts as a unit, so these three are the only steps whose
    // failure is not contained to their own tokens. Adding a fourth is a real
    // design change and should not slip in unnoticed.
    expect(stepsThatCanPoisonTheShield().map(mode => mode.step).sort()).to.deep.equal(
      [
        'FxMintOpenPositionStep',
        'MetaMorphoDepositStep',
        'ShieldDefaultStep',
      ].sort(),
    );
  });

  it('Should name the steps whose success is not undone by a later failure', () => {
    const durable = stepsWithDurableResidueOnLaterFailure().map(m => m.step);

    // Un-tokenized positions and standing authority: recoverable, not private.
    expect(durable).to.include('MorphoBlueSupplyCollateralStep');
    expect(durable).to.include('MorphoBlueBorrowStep');
    expect(durable).to.include('MorphoBlueSetAuthorizationStep');
    expect(durable).to.include('MorphoTransactStep');
    // Native ETH is the one asset the shield epilogue cannot sweep.
    expect(durable).to.include('UnwrapBaseTokenStep');
    // Value that left the batch entirely.
    expect(durable).to.include('TransferERC20Step');
    expect(durable).to.include('TransferBaseTokenStep');

    // ...and the tokenized vault/swap steps are NOT in it: their product is an
    // ERC-20 at the executor, which the epilogue re-privatises.
    expect(durable).to.not.include('ZeroXV2SwapStep');
    expect(durable).to.not.include('BeefyDepositStep');
    expect(durable).to.not.include('MetaMorphoWithdrawStep');
    expect(durable).to.not.include('FxMintAdjustPositionStep');
  });

  it('Should expose a lookup that misses cleanly', () => {
    expect(getStepFailureMode('ShieldDefaultStep')?.calls).to.equal(0);
    expect(getStepFailureMode('NotAStep')).to.equal(undefined);
  });
});

// =============================================================================
// Part 2 — the same claims, asserted against the deployed RelayAdapt7702
// =============================================================================
//
// Everything the table rests on is a property of ONE deployed contract, so it is
// asserted against that contract rather than against a local mock.
//
// No fork node. `eth_call`-family state overrides let us etch the mainnet
// RelayAdapt7702 runtime bytecode onto an address we hold the key for — which is
// what an EIP-7702 delegation designator does at execution time — and then sign
// and run a real `multicall`. Notes:
//
//   * `state: {}` (full storage replacement) is required, not just `code`. Some
//     addresses already carry a 7702 delegation and real storage on mainnet, and
//     without it slot 0 (`nonce`) reads that account's leftovers.
//   * `eth_simulateV1` is used because it returns LOGS, which is where
//     `CallError(callIndex, revertReason)` lives. `rpc.mevblocker.io` honours
//     overrides but is behind a challenge from CI here; publicnode serves both
//     overrides and `eth_simulateV1`.
//
// Set COOKBOOK_MAINNET_RPC to point these at another endpoint. If no endpoint
// answers, the block skips rather than joining the failing baseline.

const RELAY_ADAPT_7702_MAINNET = '0x05ae73c5925d843864ae6F261f3175De2ebCd963';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
// An f(x) position-NFT contract (the wstETH-Long pool is also its ERC-721).
const FX_WSTETH_LONG_POOL = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
// WETH's `balanceOf` mapping lives at storage slot 3.
const WETH_BALANCE_SLOT = 3;

const CANDIDATE_RPCS = [
  process.env.COOKBOOK_MAINNET_RPC,
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.mevblocker.io',
].filter((url): url is string => typeof url === 'string' && url.length > 0);

// A throwaway key. It only ever signs simulated calls.
const EXECUTOR_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const relayAdaptIface = new Interface([
  'function multicall(bool _requireSuccess, (address to, bytes data, uint256 value)[] _calls, uint256 _nonce, bytes _signature) payable',
  'function nonce() view returns (uint256)',
  'function shield(((bytes32 npk,(uint8 tokenType,address tokenAddress,uint256 tokenSubID) token,uint120 value) preimage,(bytes32[3] encryptedBundle,bytes32 shieldKey) ciphertext)[] _shieldRequests)',
]);
const wethIface = new Interface([
  'function deposit() payable',
  'function withdraw(uint256)',
]);

/** Hex quantity with no leading zero digits — geth rejects `0x0de0…`. */
const hexQuantity = (value: bigint | number): string =>
  `0x${BigInt(value).toString(16)}`;

const CALL_ERROR_TOPIC = keccakId('CallError(uint256,bytes)');
const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const CALL_FAILED_SELECTOR = keccakId('CallFailed(uint256,bytes)').slice(0, 10);
const ERC721_INVALID_APPROVER = keccakId('ERC721InvalidApprover(address)').slice(
  0,
  10,
);
const ERC721_NONEXISTENT_TOKEN = keccakId(
  'ERC721NonexistentToken(uint256)',
).slice(0, 10);

type Call = { to: string; data: string; value: bigint };
type SimResult = {
  status: string;
  gasUsed: number;
  callErrors: { index: number; data: string }[];
  wethLeftExecutor: bigint;
  revertData?: string;
};

type JsonRpcResponse = { result?: unknown; error?: { message?: string } };

describe('step-failure-modes-relay-adapt-semantics', function run() {
  this.timeout(90_000);

  let rpcUrl: Optional<string>;
  let relayAdaptCode: string;
  const wallet = new Wallet(EXECUTOR_KEY);
  const executor = wallet.address;

  const rpc = async (
    url: string,
    method: string,
    params: unknown[],
  ): Promise<JsonRpcResponse> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as JsonRpcResponse;
    } catch {
      return { error: { message: `non-json response: ${text.slice(0, 80)}` } };
    }
  };

  before(async () => {
    for (const url of CANDIDATE_RPCS) {
      try {
        const code = await rpc(url, 'eth_getCode', [
          RELAY_ADAPT_7702_MAINNET,
          'latest',
        ]);
        if (typeof code.result !== 'string' || code.result.length < 1000) {
          continue;
        }
        // Requires both state overrides and log-returning simulation.
        const simulate = await rpc(url, 'eth_simulateV1', [
          {
            blockStateCalls: [
              {
                stateOverrides: {
                  [executor]: { code: code.result, state: {} },
                },
                calls: [
                  {
                    to: executor,
                    data: relayAdaptIface.encodeFunctionData('nonce', []),
                  },
                ],
              },
            ],
            validation: false,
          },
          'latest',
        ]);
        if (simulate.error != null) {
          continue;
        }
        rpcUrl = url;
        relayAdaptCode = code.result;
        break;
      } catch {
        // try the next endpoint
      }
    }
  });

  beforeEach(function skipWithoutRpc() {
    if (rpcUrl == null) {
      // No endpoint served state overrides + eth_simulateV1. Do not fail the
      // suite on someone else's outage.
      this.skip();
    }
  });

  const overrides = (wethBalance?: bigint): Record<string, unknown> => {
    const result: Record<string, unknown> = {
      // `state: {}` wipes storage, so `nonce` starts at 0 even for an address
      // that is already delegated on mainnet.
      [executor]: {
        code: relayAdaptCode,
        balance: hexQuantity(10n ** 18n),
        state: {},
      },
    };
    if (wethBalance != null) {
      const slot = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256'],
          [executor, WETH_BALANCE_SLOT],
        ),
      );
      result[WETH] = { stateDiff: { [slot]: toBeHex(wethBalance, 32) } };
    }
    return result;
  };

  const multicall = async (
    requireSuccess: boolean,
    calls: Call[],
    opts: { wethBalance?: bigint; gas?: string } = {},
  ): Promise<SimResult> => {
    const stateOverrides = overrides(opts.wethBalance);
    const encodedCalls = calls.map(call => [call.to, call.data, call.value]);
    // `getMulticallPayloadHash` is `keccak256(abi.encode(requireSuccess, calls, nonce))`.
    const payloadHash = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bool', 'tuple(address to, bytes data, uint256 value)[]', 'uint256'],
        [requireSuccess, encodedCalls, 0n],
      ),
    );
    const signature = await wallet.signTypedData(
      {
        name: 'RelayAdapt7702',
        version: '1',
        chainId: 1,
        verifyingContract: executor,
      },
      { Multicall: [{ name: 'payloadHash', type: 'bytes32' }] },
      { payloadHash },
    );
    const data = relayAdaptIface.encodeFunctionData('multicall', [
      requireSuccess,
      calls,
      0n,
      signature,
    ]);

    const simulated = await rpc(rpcUrl as string, 'eth_simulateV1', [
      {
        blockStateCalls: [
          {
            stateOverrides,
            calls: [
              {
                from: '0x0000000000000000000000000000000000000001',
                to: executor,
                data,
                gas: opts.gas ?? hexQuantity(2_000_000),
              },
            ],
          },
        ],
        validation: false,
      },
      'latest',
    ]);
    expect(simulated.error, `eth_simulateV1: ${simulated.error?.message}`).to.equal(
      undefined,
    );

    const block = (simulated.result as { calls: Record<string, never>[] }[])[0];
    const result = block.calls[0] as unknown as {
      status: string;
      gasUsed: string;
      error?: { data?: string };
      logs?: { address: string; topics: string[]; data: string }[];
    };
    const logs = result.logs ?? [];

    const callErrors = logs
      .filter(log => log.topics[0] === CALL_ERROR_TOPIC)
      .map(log => {
        const [index, revertData] = AbiCoder.defaultAbiCoder().decode(
          ['uint256', 'bytes'],
          log.data,
        ) as unknown as [bigint, string];
        return { index: Number(index), data: revertData };
      });

    const wethLeftExecutor = logs
      .filter(
        log =>
          log.address.toLowerCase() === WETH.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          `0x${log.topics[1].slice(26)}`.toLowerCase() ===
            executor.toLowerCase(),
      )
      .reduce((total, log) => total + BigInt(log.data), 0n);

    return {
      status: result.status,
      gasUsed: parseInt(result.gasUsed, 16),
      callErrors,
      wethLeftExecutor,
      revertData: result.error?.data,
    };
  };

  // A call that always reverts, with no revert data: WETH.withdraw() on an
  // account with no WETH is a bare `require`.
  const revertingCall = (): Call => ({
    to: WETH,
    data: wethIface.encodeFunctionData('withdraw', [2n ** 200n]),
    value: 0n,
  });
  const depositCall = (value: bigint): Call => ({
    to: WETH,
    data: wethIface.encodeFunctionData('deposit', []),
    value,
  });

  // A shield request. `value: 0n` is what the wallet SDK always builds, and it
  // means "shield the executor's entire balance of this token".
  const shieldRequest = (
    tokenType: number,
    tokenAddress: string,
    tokenSubID: bigint,
  ) => [
    [`0x${'11'.repeat(32)}`, [tokenType, tokenAddress, tokenSubID], 0n],
    [
      [`0x${'22'.repeat(32)}`, `0x${'33'.repeat(32)}`, `0x${'44'.repeat(32)}`],
      `0x${'55'.repeat(32)}`,
    ],
  ];
  const shieldCall = (requests: unknown[]): Call => ({
    to: executor, // the epilogue is an onlySelf self-call
    data: relayAdaptIface.encodeFunctionData('shield', [requests]),
    value: 0n,
  });

  it('Should CONTINUE past a failing call, not break (requireSuccess=false)', async () => {
    const result = await multicall(false, [
      depositCall(3n),
      revertingCall(),
      depositCall(9n),
    ]);

    // The batch mines. A failing cross-contract call cannot produce status 0.
    expect(result.status).to.equal('0x1');
    expect(result.callErrors).to.deep.equal([{ index: 1, data: '0x' }]);
    // Both deposits ran: the one before the failure and the one AFTER it.
    expect(result.wethLeftExecutor).to.equal(0n); // deposits are inbound
  });

  it('Should revert the whole batch when requireSuccess=true — the path the wallet never takes', async () => {
    const result = await multicall(true, [
      depositCall(3n),
      revertingCall(),
      depositCall(9n),
    ]);
    expect(result.status).to.equal('0x0');
    expect(result.revertData?.slice(0, 10)).to.equal(CALL_FAILED_SELECTOR);
    // The index is carried, which is the only diagnosis the failing path gives.
    const [failedIndex] = AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'bytes'],
      `0x${(result.revertData as string).slice(10)}`,
    ) as unknown as [bigint, string];
    expect(failedIndex).to.equal(1n);
  });

  it('Should still reshield the executor balance after a mid-batch failure', async () => {
    const balance = 10n ** 18n;

    // Control: shield alone sweeps the whole balance despite `value: 0n`.
    const control = await multicall(false, [
      shieldCall([shieldRequest(0, WETH, 0n)]),
    ], { wethBalance: balance });
    expect(control.status).to.equal('0x1');
    expect(control.callErrors).to.deep.equal([]);
    expect(control.wethLeftExecutor).to.equal(balance);

    // The claim: an earlier failure does not stop the epilogue.
    const withFailure = await multicall(
      false,
      [revertingCall(), shieldCall([shieldRequest(0, WETH, 0n)])],
      { wethBalance: balance },
    );
    expect(withFailure.status).to.equal('0x1');
    expect(withFailure.callErrors.map(e => e.index)).to.deep.equal([0]);
    expect(
      withFailure.wethLeftExecutor,
      'the shield runs after a failed step and sweeps the full balance',
    ).to.equal(balance);
  });

  it('Should no-op the shield when every requested balance is zero', async () => {
    const result = await multicall(
      false,
      [shieldCall([shieldRequest(0, WETH, 0n)])],
      { wethBalance: 0n },
    );
    // No revert: `numValidTokens == 0` returns before touching RAILGUN. This is
    // why a recipe can declare every token it ever names without a step that
    // produced nothing breaking the epilogue.
    expect(result.status).to.equal('0x1');
    expect(result.callErrors).to.deep.equal([]);
    expect(result.wethLeftExecutor).to.equal(0n);
  });

  it('Should strand every ERC20 when the shield carries an NFT the executor does not own', async () => {
    const balance = 10n ** 18n;

    // FxMintOpenPositionStep declares `predictedPositionId` in `outputNFTs`
    // unconditionally, so a failed `operate()` — or a lost id race — puts an
    // ERC-721 request here for a token the executor does not hold.
    const unowned = await multicall(
      false,
      [
        shieldCall([
          shieldRequest(0, WETH, 0n),
          shieldRequest(1, FX_WSTETH_LONG_POOL, 1981n),
        ]),
      ],
      { wethBalance: balance },
    );
    expect(unowned.status).to.equal('0x1');
    expect(unowned.callErrors).to.have.length(1);
    expect(unowned.callErrors[0].data.slice(0, 10)).to.equal(
      ERC721_INVALID_APPROVER,
    );
    expect(
      unowned.wethLeftExecutor,
      'the ERC-721 approve reverts the whole shield, taking the ERC20 leg with it',
    ).to.equal(0n);

    // Same shape for an id that was never minted at all.
    const nonexistent = await multicall(
      false,
      [
        shieldCall([
          shieldRequest(0, WETH, 0n),
          shieldRequest(1, FX_WSTETH_LONG_POOL, 999_999n),
        ]),
      ],
      { wethBalance: balance },
    );
    expect(nonexistent.callErrors[0].data.slice(0, 10)).to.equal(
      ERC721_NONEXISTENT_TOKEN,
    );
    expect(nonexistent.wethLeftExecutor).to.equal(0n);
  });

  it('Should mine successfully with an out-of-gas shield — the shape of the §4.1 mainnet loss', async () => {
    const balance = 10n ** 18n;
    const starved = await multicall(
      false,
      [shieldCall([shieldRequest(0, WETH, 0n)])],
      { wethBalance: balance, gas: hexQuantity(250_000) },
    );

    // status 1, one CallError with EMPTY revert data, and nothing shielded.
    // Empty data plus near-total gas consumption is out-of-gas, not a require —
    // and it is invisible to any caller that only checks receipt.status.
    expect(starved.status).to.equal('0x1');
    expect(starved.callErrors).to.have.length(1);
    expect(starved.callErrors[0].data).to.equal('0x');
    expect(starved.wethLeftExecutor).to.equal(0n);

    // ...and this is why eth_estimateGas is not a safe floor here: the outer
    // call succeeds at a gas value where the shield does not.
    const sufficient = await multicall(
      false,
      [shieldCall([shieldRequest(0, WETH, 0n)])],
      { wethBalance: balance },
    );
    expect(sufficient.gasUsed).to.be.greaterThan(starved.gasUsed);
    expect(sufficient.wethLeftExecutor).to.equal(balance);
  });

  it('Should treat a call to the RAILGUN contract as a failure rather than skipping it', async () => {
    // `_multicall` refuses `call.to == address(railgun)` by never making the
    // call — `success` stays false and it lands in the failure branch, with
    // revert data indistinguishable from a genuine no-data revert.
    const railgun = '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9';
    const result = await multicall(false, [
      { to: railgun, data: '0x', value: 0n },
      depositCall(1n),
    ]);
    expect(result.status).to.equal('0x1');
    expect(result.callErrors).to.deep.equal([{ index: 0, data: '0x' }]);
  });
});
