import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, stripComments } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');

// ---------------------------------------------------------------------------
// W4 review (MAJOR 1/2) — explore-mode device-pref ratchet.
//
// "Explore with sample data" runs a THROWAWAY sample DB whose autoincrement
// ids restart at 1 — exactly like the fresh real DB the user lands on after
// exit. So any device-local key that stores a row id, a person id, or a value
// computed FROM the sample's data silently re-targets (or headlines) the
// user's own profile once they leave.
//
// The fix is one helper: `prefKey(base)` (src/lib/explore-mode.ts) namespaces
// such a key under `explore.` while the flag is set, and `clearExplorePrefs()`
// reaps the whole family on the way out.
//
// W4 SMOKE D1 widened the line (coordinator ruling, 2026-09-02). The fresh-
// profile smoke drove Explore → Dashboard → "Customize layout" → "Move Total
// Debt earlier" → "Start my real setup" and found `dashboardPillLayout.v1`
// (and its widget twin) in the REAL profile — keys that did not exist before
// entry, and that a control run never writes. They had been ruled raw because
// their ids are app CONSTANTS; the reasoning missed that the ARRANGEMENT is
// not a constant. The line is therefore two-pronged: a device-local key is
// NAMESPACED when its key or value carries profile data (row/person ids,
// computed figures) OR when it records an arrangement the user made through
// the UI — layout, order, visibility. What stays raw is the true device
// preference over app constants (`theme`, mode/segment enums — the spec's
// exemption, P-W4-10) and the REAL onboarding keys D-S7 protects on purpose.
//
// This test is the RATCHET: every file in src/ that touches localStorage or
// sessionStorage must appear below with an explicit ruling. A NEW pref file
// fails this test until someone decides which side of the line it is on —
// so a future preference cannot silently leak the way the donut hidden sets
// and the backtest verdict cache did.
// ---------------------------------------------------------------------------

/**
 * Files whose keys carry DB row ids / person ids / profile-derived values, or
 * that record a layout / order / visibility arrangement made from the UI.
 */
const NAMESPACED: ReadonlySet<string> = new Set([
  // `entityKey(kind, id)` strings: 'account:2', 'loan:1'.
  'src/components/charts/useDonutSelection.ts',
  // `{kind, id}` selection tuples + the surface's time window.
  'src/lib/net-worth-chart-prefs.ts',
  // The backtest VERDICT cache — counts, config, and a sample person's name.
  'src/lib/backtest/last-run.ts',
  // Category ids are migration-seeded constants, but the mere PRESENCE of the
  // key flips the real profile's null→auto-seed branch (Budget.tsx).
  'src/lib/tracked-budget-categories.ts',
  // Per-card numeric overrides typed against a profile's own figures.
  'src/lib/calculator-state.ts',
  // Person-scoped assumption silos ('calc-scenario:p<personId>').
  'src/lib/calculators/scenario-assumptions.ts',
  // A { personId: salary } map.
  'src/lib/calculators/use-scenario-assumptions.ts',
  // The stored VALUE is a person id.
  'src/lib/calculators/use-selected-earner.ts',
  // A $/mo figure the user set against the sample's numbers.
  'src/lib/calculators/next-dollar-store.ts',
  // W5's page-level Today's $ / Future $ basis ('calc-basis:<pageId>'). The
  // stored value is an enum, but the W4×W5 merge ruling (2026-09-02)
  // namespaces it anyway: an explore session must leave NOTHING behind, and
  // the `explore.` sweep on exit reaps it.
  'src/lib/calculators/dollar-basis.ts',
  // Update-check stamp — also disabled in explore (D-S7 offline).
  'src/components/settings/UpdaterSection.tsx',
  // ---- W4 smoke D1: the arrangement family (ids are constants, the ORDER
  // and the hidden flags are not — they are what the session DID). ----
  // Dashboard pill AND widget layout (both keys route through this store):
  // order + per-item hidden, written by "Customize layout".
  'src/components/dashboard/use-layout-store.ts',
  // The widget key's SECOND write path: the pristine-generation migration
  // rewrites stored layout on mount, so an explore boot reading the raw key
  // would rewrite the real profile before the user touched anything.
  'src/components/dashboard/use-widget-layout.ts',
  // Details-open — the same storage class as the layout keys (the constant
  // in Dashboard.tsx says so), and the disclosure that holds them.
  'src/pages/Dashboard.tsx',
  // "Investable only": hides cash-like accounts from the by-account card,
  // its composition bar AND its % denominator.
  'src/pages/Investments.tsx',
  // Scenarios-panel collapsed state (protected surface: src/components/whatif).
  'src/components/whatif/ScenariosPanel.tsx',
  // The helper's own home.
  'src/lib/explore-mode.ts',
]);

/**
 * Files that deliberately keep RAW keys, each with the reason. Three classes:
 * (a) true device preferences over app-level CONSTANTS (mode/segment enums) —
 *     the spec's theme exemption, generalized (P-W4-10). NOTE the W4-smoke
 *     narrowing: an ARRANGEMENT (layout, order, visibility) is NOT in this
 *     class even when its ids are constants — it is namespaced above;
 * (b) the REAL onboarding keys D-S7 protects, which explore reaches through
 *     structural guards (route redirects, hidden launchers), never renaming;
 * (c) keys no UI interaction can write in explore (boot infra, legacy
 *     read-only values, prefs whose live home is the DB — which the separate
 *     sample DB already isolates).
 *
 * A fourth situation is NOT a ruling this table can make: a module we may not
 * edit (a frozen surface) writing a raw key. The coordinator closed that hole
 * structurally on 2026-09-02 — both exit paths call
 * `clearExploreSessionStorage()`, blanking the whole session store after the
 * prefix sweep — so a raw SESSION key cannot outlive the exit whatever this
 * table says. localStorage has no such backstop: a raw key there is still a
 * leak, and still needs a ruling below.
 */
const RAW_WITH_REASON: Readonly<Record<string, string>> = {
  'src/App.tsx': 'chunk-reload guard — boot infra, not a UI pref; must be SHARED across the reload it guards',
  'src/lib/backup-restore.ts': 'restore-failure notice; every restore control is disabled in explore',
  'src/lib/calculator-card-layout.ts': 'the live card layout lives in app_settings (DB) ⇒ already isolated by the sample DB; the only localStorage touch is the legacy import, itself explore-guarded (it DELETES a real key)',
  'src/lib/calculator-visibility.ts': 'legacy `calculator-hidden-cards` key — no UI write path left (hidden cards live in app_settings ⇒ DB-isolated); its one reader is the explore-guarded import, which must still see the user’s REAL legacy value',
  // NOTE (W4×W5 merge, 2026-09-02): the per-card display-mode hook that used
  // to sit here ('NOMINAL|REAL enum') was DELETED by W5 — the page-level
  // basis toggle replaces it, and its own key is NAMESPACED above. The
  // stale-entry half of the ratchet is what caught the removal.
  'src/lib/calculators/use-supplemental-method.ts': 'AGGREGATE|FLAT withholding-method enum over app constants — a view mode, not an arrangement (same family as the src/pages/calculators segment enums below)',
  'src/lib/interview/bar-store.ts': 'the $X bar’s session-scoped hypothetical (amount + cadence) under a RAW sessionStorage key. The interview kernel is frozen, so the coordinator (2026-09-02) closed it from the other side: clearExploreSessionStorage() blanks the whole session store on both exit paths, so this key cannot outlive the exit',
  'src/lib/onboarding-state.ts': 'D-S7 REAL tailor/tour keys — unreachable in explore by structural guards',
  'src/lib/setup-dismissal.ts': 'D-S7 REAL dismissal key — /setup redirects while exploring',
  'src/lib/setup-progress.ts': 'D-S7 REAL progress keys — /setup redirects while exploring',
  'src/pages/calculators/CalculatorsLayout.tsx': 'stale-banner boolean — a transient notice, not a stored arrangement (protected surface: src/pages/calculators)',
  'src/pages/calculators/PathToFiCard.tsx': 'KEEP|STOP view-mode enum over app constants (protected surface)',
  'src/pages/calculators/StressTestCard.tsx': 'mode + crash-window id enums, both app constants (protected surface)',
  'src/pages/calculators/SupplementalPayCard.tsx': 'BONUS|COMMISSION segment enum over app constants (protected surface)',
};

const STORAGE_RE = new RegExp('\\b(localStorage|sessionStorage)\\s*[.\\[]');
const PREF_KEY_RE = new RegExp('prefKey\\s*\\(');

async function storageFiles(): Promise<Map<string, string>> {
  const files = await collectSourceFiles(SRC_DIR, ['.ts', '.tsx']);
  const out = new Map<string, string>();
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, 'utf8'));
    if (!STORAGE_RE.test(stripped)) continue;
    out.set(path.relative(ROOT, file).split(path.sep).join('/'), stripped);
  }
  return out;
}

describe('explore-mode device-pref namespace policy', () => {
  it('every src/ file touching web storage is classified (namespaced or raw-with-reason)', async () => {
    const found = [...(await storageFiles()).keys()].sort();
    const classified = new Set([...NAMESPACED, ...Object.keys(RAW_WITH_REASON)]);
    const unclassified = found.filter((f) => !classified.has(f));
    const stale = [...classified].filter((f) => !found.includes(f)).sort();

    expect(
      unclassified,
      [
        '',
        'New localStorage/sessionStorage user(s) in src/ with no explore ruling:',
        `  ${unclassified.join('\n  ')}`,
        '',
        'Decide: does the key (or its value) carry a DB row id, a person id, or a',
        'value computed from the profile’s data? If yes, route it through',
        'prefKey() from @/lib/explore-mode and add it to NAMESPACED. If it is a',
        'true device preference over app constants, add it to RAW_WITH_REASON',
        'with the reason.',
        '',
      ].join('\n'),
    ).toEqual([]);

    expect(stale, `Classified file(s) that no longer touch web storage: ${stale.join(', ')}`)
      .toEqual([]);
  });

  it('every NAMESPACED file actually routes its keys through prefKey()', async () => {
    const files = await storageFiles();
    const missing = [...NAMESPACED].filter((f) => {
      const src = files.get(f);
      return src === undefined || !PREF_KEY_RE.test(src);
    }).sort();
    expect(
      missing,
      `NAMESPACED file(s) not calling prefKey(): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('the id-bearing families the review caught are namespaced by name', async () => {
    const files = await storageFiles();
    for (const f of [
      'src/components/charts/useDonutSelection.ts',
      'src/lib/net-worth-chart-prefs.ts',
      'src/lib/backtest/last-run.ts',
    ]) {
      expect(PREF_KEY_RE.test(files.get(f) ?? ''), `${f} must call prefKey()`).toBe(true);
    }
  });

  it('the arrangement family the W4 smoke caught is namespaced by name', async () => {
    const files = await storageFiles();
    for (const f of [
      'src/components/dashboard/use-layout-store.ts',
      'src/components/dashboard/use-widget-layout.ts',
      'src/pages/Dashboard.tsx',
      'src/pages/Investments.tsx',
      'src/components/whatif/ScenariosPanel.tsx',
    ]) {
      expect(PREF_KEY_RE.test(files.get(f) ?? ''), `${f} must call prefKey()`).toBe(true);
    }
  });

  it('every raw ruling carries a written reason', () => {
    for (const [file, reason] of Object.entries(RAW_WITH_REASON)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});
