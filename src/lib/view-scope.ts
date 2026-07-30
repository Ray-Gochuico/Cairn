import type { ViewFilter } from './use-view-filter';

/**
 * Wave A shared view-scope vocabulary (pure — no React, no stores).
 * The canonical grammars live here so captions, empty states, and title
 * suffixes can never drift page-to-page. See the Copy contract in
 * docs/superpowers/plans/2026-07-20-wave-a-person-view-honoring.md.
 */

/** ' · Household' under any person/joint view — the household-by-design
 *  title suffix. One implementation; PerTickerDonut/SectorDonut/
 *  ConcentrationCard/ConcentrationHealthCard (and AssetValueChart's label
 *  path) converge here instead of five hand-rolled ternaries. */
export function scopeSuffix(filter: ViewFilter): string {
  return filter === 'household' ? '' : ' · Household';
}

export interface HiddenPartition {
  total: number;
  visibleCount: number;
  hiddenCount: number;
  /** Hidden rows whose person field is null (joint/shared). */
  jointCount: number;
  /** Hidden rows attributed to a person outside the current view. */
  otherCount: number;
}

/**
 * Count what a view filter hid, split joint vs other-person. `visible` MUST
 * be a filtered SUBSET of `all` sharing object references (every
 * filterBy*PersonId helper returns `items.filter(...)`, so this holds by
 * construction) — membership is checked by reference. Partition BEFORE any
 * map/clone step.
 */
export function partitionHidden<T>(
  all: readonly T[],
  visible: readonly T[],
  personIdOf: (item: T) => number | null | undefined,
): HiddenPartition {
  const visibleSet = new Set<T>(visible);
  let jointCount = 0;
  let otherCount = 0;
  for (const item of all) {
    if (visibleSet.has(item)) continue;
    if (personIdOf(item) == null) jointCount += 1;
    else otherCount += 1;
  }
  return {
    total: all.length,
    visibleCount: visible.length,
    hiddenCount: jointCount + otherCount,
    jointCount,
    otherCount,
  };
}

export interface HiddenClauseOpts {
  filter: ViewFilter;
  /** The non-selected person's name (p1/p2 views); null in joint view. */
  otherName: string | null;
  /** Word for null-person rows: 'joint' (default) or 'shared' (goals). */
  jointWord?: string;
  /** Verb linking other-person rows: 'owned by' (default) or 'for' (goals). */
  otherVerb?: string;
}

/** The count clause of C2–C5: '2 joint and 1 owned by Bob', '3 shared',
 *  '3 individually owned' (joint view). Empty string when nothing is hidden. */
export function hiddenClause(p: HiddenPartition, opts: HiddenClauseOpts): string {
  if (p.hiddenCount === 0) return '';
  if (opts.filter === 'joint') return `${p.otherCount} individually owned`;
  const jointWord = opts.jointWord ?? 'joint';
  const otherVerb = opts.otherVerb ?? 'owned by';
  const parts: string[] = [];
  if (p.jointCount > 0) parts.push(`${p.jointCount} ${jointWord}`);
  if (p.otherCount > 0) parts.push(`${p.otherCount} ${otherVerb} ${opts.otherName ?? 'others'}`);
  return parts.join(' and ');
}

/**
 * Preserve the active ?view= across intra-page links (D9). Promotion of
 * Dashboard's `withView` (W10 S1) to a shared shape usable from plain
 * <Link to={...}> call sites: pass `location.search`. A `to` that already
 * pins its own view wins; other query params on `to` are preserved.
 */
export function withViewSearch(to: string, search: string): string {
  const view = new URLSearchParams(search).get('view');
  if (!view) return to;
  const [path, existing = ''] = to.split('?');
  const params = new URLSearchParams(existing);
  if (params.has('view')) return to;
  params.set('view', view);
  return `${path}?${params.toString()}`;
}
