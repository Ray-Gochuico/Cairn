const KEY = 'calculator-hidden-cards';

// Scope note (2026-06-01): we migrate ONLY the persisted hidden-cards
// localStorage value here. The per-card sessionStorage keys
// (`calc-state:<id>`, `calc-suppl-method:<id>`) are intentionally NOT
// migrated on the `commission`→`commission-tax` rename: they are ephemeral
// (die with the webview session / app restart) and hold disposable input
// overrides that re-prefill from real data, so a stale `…:commission` key
// self-heals. The live path already writes `…:commission-tax` (see
// CalculatorsLayout.test.tsx).
// One-time migration map for renamed card ids. Older persisted values may
// still reference the legacy id; we translate on read so the user keeps their
// hidden-state across the rename.
const LEGACY_ID_MIGRATIONS: Record<string, string> = {
  fire: 'financial-independence',
  commission: 'commission-tax',
};

function migrateId(id: string): string {
  return LEGACY_ID_MIGRATIONS[id] ?? id;
}

export function getHiddenCards(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((x): x is string => typeof x === 'string').map(migrateId);
    // De-dupe in case both the legacy and renamed id were somehow present.
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export function persistHiddenCards(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable (private mode / quota / SSR); the React
    // state still updates so the UI behaves correctly within the session.
  }
}

