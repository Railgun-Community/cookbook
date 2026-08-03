import chai from 'chai';
import * as minGasLimits from '../min-gas-limits';
import { MIN_GAS_LIMIT_EMPTY } from '../min-gas-limits';
import { FxMintOpenRecipe } from '../../recipes/borrow/fx/fx-mint-open-recipe';
import { FxMintTopupRecipe } from '../../recipes/borrow/fx/fx-mint-topup-recipe';
import { FxMintTopupAndBorrowRecipe } from '../../recipes/borrow/fx/fx-mint-topup-and-borrow-recipe';
import { FxMintBorrowMoreRecipe } from '../../recipes/borrow/fx/fx-mint-borrow-more-recipe';
import { FxMintRepayDebtRecipe } from '../../recipes/borrow/fx/fx-mint-repay-debt-recipe';
import { FxMintCloseRecipe } from '../../recipes/borrow/fx/fx-mint-close-recipe';

const { expect } = chai;

/**
 * `minGasLimit` is a FLOOR, not a cap.
 *
 * RelayAdapt bakes it into `actionData` —
 * `tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, calls[])` —
 * and enforces it as a `gasleft()` require. Setting it low does not save gas; it
 * under-provisions the batch, and an under-provisioned batch reverts at the
 * shield epilogue with the value stranded at the executor.
 *
 * `MIN_GAS_LIMIT_EMPTY` is the one measured value in the module (1.783M, rounded
 * to 1.8M): a recipe that does nothing but unshield and shield. Every other
 * recipe strictly contains that work and therefore cannot be cheaper.
 *
 * Two fx recipes shipped floors below it — borrow-more at 1.0M and repay-debt
 * at 1.5M — because they kept v0.1 per-recipe hardcodes when the shared
 * constants were re-anchored. The constants were correct; the call sites never
 * read them. These tests assert the invariant at BOTH levels, because checking
 * only the constants is what let that through.
 */
describe('min-gas-limits', () => {
  it('every exported MIN_GAS_LIMIT_* is at least MIN_GAS_LIMIT_EMPTY', () => {
    const entries = Object.entries(minGasLimits).filter(
      ([name, value]) =>
        name.startsWith('MIN_GAS_LIMIT_') && typeof value === 'bigint',
    ) as [string, bigint][];

    // Guard the guard: if the module is ever restructured so this picks up
    // nothing, the loop below would pass vacuously.
    expect(entries.length).to.be.greaterThan(10);

    const tooLow = entries.filter(([, value]) => value < MIN_GAS_LIMIT_EMPTY);
    expect(
      tooLow.map(([name, value]) => `${name}=${value}`),
      'constants below the measured empty-recipe floor',
    ).to.deep.equal([]);
  });

  it('every fx recipe declares a floor at least MIN_GAS_LIMIT_EMPTY', () => {
    // Every fx recipe is unshield + (approve) + operate() + shield, so each
    // strictly contains the empty case these are compared against.
    const recipes = [
      new FxMintOpenRecipe({
        pool: 'wstETH-Long',
        targetDebt: 5_000_000_000_000_000_000n,
        predictedPositionId: 1903n,
        borrowFeeRatio: 5_000_000n,
      }),
      new FxMintTopupRecipe({ pool: 'wstETH-Long', positionId: 1903n }),
      new FxMintTopupAndBorrowRecipe({
        pool: 'wstETH-Long',
        positionId: 1903n,
        additionalDebt: 5_000_000_000_000_000_000n,
        borrowFeeRatio: 5_000_000n,
      }),
      new FxMintBorrowMoreRecipe({
        pool: 'wstETH-Long',
        positionId: 1903n,
        additionalDebt: 5_000_000_000_000_000_000n,
        borrowFeeRatio: 5_000_000n,
      }),
      new FxMintRepayDebtRecipe({
        pool: 'wstETH-Long',
        positionId: 1903n,
        repayAmount: 3_000_000_000_000_000_000n,
        approveAmount: 3_006_000_000_000_000_000n,
        repayFeeRatio: 2_000_000n,
      }),
      new FxMintCloseRecipe({
        pool: 'wstETH-Long',
        positionId: 1903n,
        repayAmount: 3_000_000_000_000_000_000n,
        withdrawColl: 1_000_000_000_000_000_000n,
        approveAmount: 3_006_000_000_000_000_000n,
        withdrawFeeRatio: 0n,
        partialClose: true,
      }),
    ];

    const tooLow = recipes
      .filter(r => r.config.minGasLimit < MIN_GAS_LIMIT_EMPTY)
      .map(r => `${r.config.name}=${r.config.minGasLimit}`);

    expect(tooLow, 'fx recipes below the measured empty-recipe floor').to.deep.equal(
      [],
    );
  });

  it('the two recipes that regressed read the shared adjust constant', () => {
    // Pinned specifically, not just via the >= sweep above: a future edit that
    // reintroduces a hardcode at some value happening to exceed EMPTY would
    // pass the sweep while re-detaching these from the shared floor.
    const borrowMore = new FxMintBorrowMoreRecipe({
      pool: 'wstETH-Long',
      positionId: 1903n,
      additionalDebt: 5_000_000_000_000_000_000n,
      borrowFeeRatio: 5_000_000n,
    });
    const repayDebt = new FxMintRepayDebtRecipe({
      pool: 'wstETH-Long',
      positionId: 1903n,
      repayAmount: 3_000_000_000_000_000_000n,
      approveAmount: 3_006_000_000_000_000_000n,
      repayFeeRatio: 2_000_000n,
    });

    expect(borrowMore.config.minGasLimit).to.equal(
      minGasLimits.MIN_GAS_LIMIT_FXMINT_ADJUST,
    );
    expect(repayDebt.config.minGasLimit).to.equal(
      minGasLimits.MIN_GAS_LIMIT_FXMINT_ADJUST,
    );
  });
});
