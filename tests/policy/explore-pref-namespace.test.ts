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
// This test is the RATCHET: every file in src/ that touches localStorage or
// sessionStorage must appear below with an explicit ruling. A NEW pref file
// fails this test until someone decides which side of the line it is on —
// so a future preference cannot silently leak the way the donut hidden sets
// and the backtest verdict cache did.
// ---------------------------------------------------------------------------

/** Files whose keys carry DB row ids / person ids / profile-derived values. */
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
  // W2's per-card Assumed | History return source ('calc-chart-source:<cardId>').
  // Same ruling as the basis key above, for the same reason: the stored value
  // is an enum, but an explore session must leave nothing behind — a sample-era
  // History selection has no business surviving into the real profile.
  'src/lib/calculators/use-chart-source.ts',
  // Update-check stamp — also disabled in explore (D-S7 offline).
  'src/components/settings/UpdaterSection.tsx',
  // The helper's own home.
  'src/lib/explore-mode.ts',
]);

/**
 * Files that deliberately keep RAW keys, each with the reason. Two classes:
 * (a) true device preferences over app-level CONSTANTS (booleans, enum modes,
 *     card/widget ids) — the spec's theme exemption, generalized (P-W4-10);
 * (b) the REAL onboarding keys D-S7 protects, which explore reaches through
 *     structural guards (route redirects, hidden launchers), never renaming.
 */
const RAW_WITH_REASON: Readonly<Record<string, string>> = {
  'src/App.tsx': 'chunk-reload guard — must be shared across the boot, holds no profile data',
  'src/components/dashboard/use-layout-store.ts': 'widget/pill order over constant widget ids',
  'src/components/dashboard/use-widget-layout.ts': 'widget order over constant widget ids',
  'src/components/whatif/ScenariosPanel.tsx': 'collapsed boolean (protected surface: src/components/whatif)',
  'src/lib/backup-restore.ts': 'restore-failure notice; every restore control is disabled in explore',
  'src/lib/calculator-card-layout.ts': 'card ids; the legacy import is explore-guarded (it DELETES a real key)',
  'src/lib/calculator-visibility.ts': 'hidden calculator ids — app constants',
  // NOTE (W4×W5 merge, 2026-09-02): the per-card display-mode hook that used
  // to sit here ('NOMINAL|REAL enum') was DELETED by W5 — the page-level
  // basis toggle replaces it, and its own key is NAMESPACED above. The
  // stale-entry half of the ratchet is what caught the removal.
  'src/lib/calculators/use-supplemental-method.ts': 'AGGREGATE|FLAT enum',
  'src/lib/interview/bar-store.ts': 'session-scoped answered-question ids (protected surface: src/lib/interview)',
  'src/lib/onboarding-state.ts': 'D-S7 REAL tailor/tour keys — unreachable in explore by structural guards',
  'src/lib/setup-dismissal.ts': 'D-S7 REAL dismissal key — /setup redirects while exploring',
  'src/lib/setup-progress.ts': 'D-S7 REAL progress keys — /setup redirects while exploring',
  'src/pages/Dashboard.tsx': 'Details-open boolean',
  'src/pages/Investments.tsx': 'investable-only boolean',
  'src/pages/calculators/CalculatorsLayout.tsx': 'stale-banner boolean (protected surface: src/pages/calculators)',
  'src/pages/calculators/PathToFiCard.tsx': 'KEEP|STOP enum (protected surface)',
  'src/pages/calculators/StressTestCard.tsx': 'mode + crash-window id enums (protected surface)',
  'src/pages/calculators/SupplementalPayCard.tsx': 'BONUS|COMMISSION enum (protected surface)',
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

  it('every raw ruling carries a written reason', () => {
    for (const [file, reason] of Object.entries(RAW_WITH_REASON)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});
