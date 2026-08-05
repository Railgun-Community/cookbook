import fs from 'fs';
import path from 'path';
import chai from 'chai';
import {
  SHIPPED_APPROVAL_RESIDUE_POLICY,
  ShippedApprovalResiduePolicy,
} from '../executor-residue';

const { expect } = chai;

const SRC_ROOT = path.resolve(__dirname, '../../..');
const RECIPES_ROOT = path.join(SRC_ROOT, 'recipes');

/** Every `new ApproveERC20SpenderStep(` in a file. */
const APPROVE_STEP_CALL = /new\s+ApproveERC20SpenderStep\s*\(/g;

const listTypeScriptFiles = (dir: string): string[] => {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // __tests__ construct recipes, they do not define new approval policy.
      return entry.name === '__tests__' ? [] : listTypeScriptFiles(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
};

/** `{ 'recipes/…': callSiteCount }` for every recipe that creates an allowance. */
const scanApprovalCallSites = (): Record<string, number> => {
  const found: Record<string, number> = {};
  listTypeScriptFiles(RECIPES_ROOT).forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    const matches = source.match(APPROVE_STEP_CALL);
    if (matches === null) {
      return;
    }
    found[path.relative(SRC_ROOT, file).split(path.sep).join('/')] =
      matches.length;
  });
  return found;
};

/**
 * Drift guard for {@link SHIPPED_APPROVAL_RESIDUE_POLICY}.
 *
 * The residue policy is prose about code, and prose about code rots. A source
 * scan is a blunt instrument, but the property it locks is exactly the one that
 * matters: **no recipe may create an ERC-20 allowance without a written
 * statement of what that allowance leaves behind.** A hand-maintained table with
 * no guard would drift on the first new recipe and be wrong silently, which is
 * the failure mode the policy exists to prevent.
 *
 * If this fails because you added or moved an approval: add or update the entry
 * in `SHIPPED_APPROVAL_RESIDUE_POLICY`, stating what survives and why.
 */
describe('7702 shipped approval residue policy', () => {
  const byFile = new Map<string, ShippedApprovalResiduePolicy>(
    SHIPPED_APPROVAL_RESIDUE_POLICY.map(entry => [entry.recipeFile, entry]),
  );

  it('Should have one entry per recipe file, with no duplicates', () => {
    expect(byFile.size).to.equal(
      SHIPPED_APPROVAL_RESIDUE_POLICY.length,
      'SHIPPED_APPROVAL_RESIDUE_POLICY has two entries for the same recipeFile',
    );
  });

  it('Should cover every recipe that creates an ERC20 allowance', () => {
    const scanned = scanApprovalCallSites();

    const undocumented = Object.keys(scanned).filter(
      file => !byFile.has(file),
    );
    expect(undocumented).to.deep.equal(
      [],
      `these recipes create an allowance but SHIPPED_APPROVAL_RESIDUE_POLICY does not say what survives it: ${undocumented.join(
        ', ',
      )}`,
    );

    const stale = [...byFile.keys()].filter(
      file => typeof scanned[file] !== 'number',
    );
    expect(stale).to.deep.equal(
      [],
      `these policy entries name a recipe that no longer creates an allowance: ${stale.join(
        ', ',
      )}`,
    );
  });

  it('Should record the right number of approval call sites per recipe', () => {
    const scanned = scanApprovalCallSites();
    const mismatched = Object.entries(scanned)
      .filter(([file, count]) => byFile.get(file)?.approvalCallSites !== count)
      .map(
        ([file, count]) =>
          `${file}: source has ${count}, policy says ${String(
            byFile.get(file)?.approvalCallSites,
          )}`,
      );
    expect(mismatched).to.deep.equal([]);
  });

  it('Should give every entry a non-empty reason', () => {
    const unexplained = SHIPPED_APPROVAL_RESIDUE_POLICY.filter(
      entry => entry.reason.trim() === '',
    ).map(entry => entry.recipeFile);
    expect(unexplained).to.deep.equal([]);
  });

  it('Should mark every unbounded approval as a defect rather than a decision', () => {
    // `unbounded` means the recipe omitted the amount argument, so the executor
    // grants type(uint256).max. Under a reused executor that is a standing
    // withdrawal right, never an intentional design. Requiring the word keeps
    // the class from quietly becoming a place to park approvals.
    const unmarked = SHIPPED_APPROVAL_RESIDUE_POLICY.filter(
      entry =>
        entry.residue === 'unbounded' && !entry.reason.startsWith('DEFECT'),
    ).map(entry => entry.recipeFile);
    expect(unmarked).to.deep.equal([]);
  });

  it('Should state, for reference, how the shipped surface splits', () => {
    const counts = SHIPPED_APPROVAL_RESIDUE_POLICY.reduce<
      Record<string, number>
    >((acc, entry) => {
      acc[entry.residue] = (acc[entry.residue] ?? 0) + entry.approvalCallSites;
      return acc;
    }, {});
    // Locks the shape of the shipped surface. The headline finding was that
    // eight of sixteen call sites passed no amount and therefore granted
    // `type(uint256).max`. Those eight are now `bounded-when-deterministic`:
    // the call sites are unchanged — they still pass no amount — but the step's
    // fallback is the matched input balance rather than max, which covers every
    // standalone use. They stay a separate class from `bounded` because putting
    // one downstream of a swap in a combo makes the balance unknowable at proof
    // time and the approval max again.
    //
    // `unbounded` is now zero and should stay there. A new entry in that class
    // is a regression, not a tally to update.
    expect(counts).to.deep.equal({
      none: 8,
      bounded: 1,
      'bounded-when-deterministic': 8,
    });
  });
});
