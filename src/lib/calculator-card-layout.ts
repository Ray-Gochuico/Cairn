import type { CardLayoutEntry } from '@/types/schema';
import { SettingsRepo } from '@/domain/app-settings';
import { getDatabase } from '@/db/db';
import { getHiddenCards } from '@/lib/calculator-visibility';

/**
 * The 12 stable kebab-case calculator-card ids, in display order. This is the
 * single canonical list; `CalculatorsLayout` re-exports it as `CARD_IDS`
 * (object form) for its JSX and the tailoring engine consumes it. Keep this in
 * lock-step with the cards rendered in `CalculatorsLayout.tsx`.
 */
export const CALCULATOR_CARD_IDS: readonly string[] = [
  'paycheck',
  'bonus-tax',
  'commission-tax',
  'overtime',
  'financial-independence',
  'coast-fi',
  'compound-interest',
  'debt-payoff',
  'equity',
  'retirement-401k-withdrawal',
  'backtest',
  'contribution-allocator',
];

/**
 * Resolve the set of HIDDEN card ids from the stored overlay. Mirrors the
 * intent of applyCardLayout (investments-card-layout.ts) but returns the
 * hidden-id list the grid needs (not a reordered registry — calculator cards
 * are not reorderable, only hide/show).
 *   - layout === null  → nothing hidden (all visible);
 *   - otherwise        → the ids whose entry has hidden:true. Ids absent from
 *                        a non-null layout are treated as visible (a card
 *                        added in a future release shows up without migrating
 *                        stored layouts). Unknown-id entries are ignored by
 *                        the caller because it intersects against the live
 *                        CARD_IDS, but we also don't synthesize them here.
 * Pure; never mutates its inputs.
 */
export function applyCalculatorCardLayout(
  allIds: readonly string[],
  layout: CardLayoutEntry[] | null,
): string[] {
  if (layout === null) return [];
  const known = new Set(allIds);
  const hiddenById = new Map<string, boolean>();
  for (const entry of layout) hiddenById.set(entry.id, entry.hidden);
  return allIds.filter((id) => known.has(id) && hiddenById.get(id) === true);
}

/**
 * Module-level single-fire latch. settings-store.load() IS in-flight
 * de-duped (createDedupedLoad), but the import fires macrotask-deferred on
 * EVERY successful settings fetch — and loads re-fetch after settle — so
 * repeated loads would re-enter this function. The latch collapses
 * concurrent import runs into one promise; the DB-field non-null check
 * below makes later re-entries no-ops. Cleared in a finally so a failed
 * (fail-soft) import can retry on the next load.
 */
let importInflight: Promise<void> | null = null;

/**
 * One-time migration of the legacy 'calculator-hidden-cards' localStorage
 * value into app_settings.calculator_card_layout. Called once from the
 * settings-store after a successful load() resolve. Contract:
 *   - no-op if the DB field is already non-null (single source of truth wins);
 *   - no-op if the legacy localStorage key is absent (nothing to import);
 *   - otherwise read the legacy hidden ids via getHiddenCards() (which applies
 *     LEGACY_ID_MIGRATIONS + de-dupes + tolerates malformed JSON → []), build a
 *     COMPLETE CardLayoutEntry[] over CALCULATOR_CARD_IDS (hidden = imported),
 *     write it, and clear the localStorage key ON SUCCESS only;
 *   - fail-soft: on any error, swallow it, leave the key in place, and let the
 *     next load() retry. Never throws (must not block render).
 * Single-fire via importInflight so concurrent callers share one promise.
 */
export function importCalcVisibilityIfNeeded(): Promise<void> {
  if (importInflight) return importInflight;
  importInflight = (async () => {
    try {
      const repo = new SettingsRepo(getDatabase());
      const current = await repo.get();
      // Single source of truth: once the DB field is set, never re-import.
      if (current.calculatorCardLayout !== null) return;
      // Nothing migrated yet AND no legacy value → leave the field null.
      const legacyRaw = localStorage.getItem('calculator-hidden-cards');
      if (legacyRaw === null) return;

      // getHiddenCards() reads the same key, applies LEGACY_ID_MIGRATIONS,
      // de-dupes, and returns [] on malformed/non-array content.
      const hiddenIds = new Set(getHiddenCards());
      const layout: CardLayoutEntry[] = CALCULATOR_CARD_IDS.map((id) => ({
        id,
        hidden: hiddenIds.has(id),
      }));

      await repo.update({ calculatorCardLayout: layout });
      // Clear ONLY after a successful write so a failed write retries next load.
      localStorage.removeItem('calculator-hidden-cards');
    } catch {
      // Fail-soft: leave the key for a later retry; never block render.
    }
  })();
  try {
    return importInflight;
  } finally {
    // Release the latch when the in-flight promise settles (success OR fail),
    // so a fail-soft import can retry on the next load() and a success can't
    // be re-run (the DB-non-null guard short-circuits the retry).
    void importInflight.finally(() => {
      importInflight = null;
    });
  }
}

/**
 * TEST SEAM: reset the module-level latch between tests (the module loads once
 * per test file). Not used by production code.
 */
export function __resetImportLatchForTests(): void {
  importInflight = null;
}
