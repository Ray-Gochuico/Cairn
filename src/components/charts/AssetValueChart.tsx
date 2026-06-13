import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RANGE_TABS,
  buildAssetValueView,
  deltaPctOrNull,
  earliestObservationIso,
  formatBucketDate,
  granularityForWindow,
  headerLabel,
  tooltipRows,
  xTickLabel,
  xTicksFor,
} from '@/lib/asset-value-chart';
import {
  buildNetWorthChartData,
  type NetWorthChartRow,
} from '@/lib/net-worth-chart-data';
import {
  makeChartPrefs,
  type ChartPrefs,
  type EntityKind,
  type SelectedEntity,
} from '@/lib/net-worth-chart-prefs';
import { entityKey, parseEntityKey } from '@/lib/entity-key';
import { cutoffForWindow, type TimeWindow } from '@/lib/snapshot-bucketing';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { loanTypeLabel } from '@/lib/loan-labels';
import { useViewFilter } from '@/lib/use-view-filter';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import type { LoanType } from '@/types/enums';

/**
 * AssetValueChart — the Google-Finance-style growth chart (spec
 * docs/superpowers/specs/2026-06-12-asset-value-chart-design.md §3).
 *
 * Task 9 skeleton + Task 10 canvas polish: header (label / value / delta),
 * range tabs, Included picker, per-surface defaults + persistence, empty
 * states, and the AreaChart with directional gradient fill, end dot, and
 * hover tooltip (§3.3/§3.4). Task 11 adds hover-scrub + click-to-pin
 * (header precedence scrub > pin > latest, §3.5). Task 12 extends this
 * file with the breakdown panel — keep the section structure below
 * (hoisted constants → state → derivation memos → header / tabs / body)
 * intact for it.
 */

export type AssetValueChartSurface = 'netWorth' | 'dashboard';

// Per-surface persisted preferences. 'netWorthChart' reuses the legacy
// chart's localStorage keys so existing selections carry over.
const PREFS: Record<AssetValueChartSurface, ChartPrefs> = {
  netWorth: makeChartPrefs('netWorthChart'),
  dashboard: makeChartPrefs('dashboardAssetChart'),
};

interface SurfaceConfig {
  height: number;
  strokeWidth: number;
  valueClass: string;
  /** Breakdown panel (Task 12) — netWorth surface only. */
  showBreakdown: boolean;
  /** Click-to-pin (Task 11) — netWorth surface only. */
  allowPin: boolean;
  /** Header-right "Net Worth →" link — dashboard surface only. */
  showLink: boolean;
  /** Default selection: everything (net worth) vs assets only. */
  defaultIncludeLoans: boolean;
  /**
   * Per-direction gradient fill ids — unique per surface so the dashboard
   * and net-worth charts can mount on one page without <defs> collisions.
   */
  gradientUpId: string;
  gradientDownId: string;
}

const SURFACES: Record<AssetValueChartSurface, SurfaceConfig> = {
  netWorth: {
    height: 320,
    strokeWidth: 2.5,
    valueClass: 'text-3xl',
    showBreakdown: true,
    allowPin: true,
    showLink: false,
    defaultIncludeLoans: true,
    gradientUpId: 'avc-fill-netWorth-up',
    gradientDownId: 'avc-fill-netWorth-down',
  },
  dashboard: {
    height: 200,
    strokeWidth: 2,
    valueClass: 'text-2xl',
    showBreakdown: false,
    allowPin: false,
    showLink: true,
    defaultIncludeLoans: false,
    gradientUpId: 'avc-fill-dashboard-up',
    gradientDownId: 'avc-fill-dashboard-down',
  },
};

// ----- Hoisted recharts props (recharts 3.x re-render discipline) -----
// Every object/function prop must keep a stable identity across renders —
// fresh literals re-trigger recharts' internal axis-layout dispatch (see
// InvestmentTimeSeriesChart's RenderedTicksReporter comment).
const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 8 } as const;
const GRID_STROKE = 'hsl(var(--border))' as const;
const AXIS_STROKE = 'hsl(var(--muted-foreground))' as const;
const SUCCESS = 'hsl(var(--success))' as const;
const DESTRUCTIVE = 'hsl(var(--destructive))' as const;
// Tooltip cursor — the vertical dashed scrub line.
const CURSOR = {
  stroke: AXIS_STROKE,
  strokeDasharray: '4 4',
} as const;
// Pin marker line (§3.5) — axis-toned, tighter dash than the scrub cursor.
const PIN_LINE_DASH = '3 3' as const;
// Crosshair on the plot area. Must be a STYLE prop: RechartsWrapper sets
// inline `cursor: 'default'` on its wrapper div, which beats any class —
// recharts merges user style after its defaults, so this wins.
const CHART_WRAPPER_STYLE = { cursor: 'crosshair' } as const;
const ACTIVE_DOT = { r: 4 } as const;
const EMPTY_CHART_DATA: NetWorthChartRow[] = [];

// End-of-series dot (spec §3.3): solid core + soft halo, tinted by trend
// direction. Prebuilt per direction so the ReferenceDot `shape` prop keeps
// a stable identity across renders.
function endDotShape(color: string) {
  return function EndDot(props: { cx?: number; cy?: number }) {
    const { cx = 0, cy = 0 } = props;
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.15} />
        <circle cx={cx} cy={cy} r={4} fill={color} />
      </g>
    );
  };
}
const END_DOT_UP = endDotShape(SUCCESS);
const END_DOT_DOWN = endDotShape(DESTRUCTIVE);

// Whole-domain function form (spec §3.3) — the tuple-of-functions form
// can't see the span, so padding must be computed from both ends at once.
const Y_DOMAIN = ([lo, hi]: readonly [number, number]): [number, number] => {
  const span = hi - lo;
  const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(hi) * 0.05, 1);
  return [lo - pad, hi + pad];
};

// One stable tick-formatter per window so the XAxis prop identity only
// changes when the window does.
const X_TICK_FORMATTERS: Record<TimeWindow, (v: string) => string> = {
  '3M': (v) => xTickLabel(v, '3M'),
  '6M': (v) => xTickLabel(v, '6M'),
  YTD: (v) => xTickLabel(v, 'YTD'),
  '1Y': (v) => xTickLabel(v, '1Y'),
  '5Y': (v) => xTickLabel(v, '5Y'),
  ALL: (v) => xTickLabel(v, 'ALL'),
};

interface EligibleEntity extends SelectedEntity {
  name: string;
}

/** Loan display name — name if non-empty, else the type label. */
function loanDisplayName(name: string, type: LoanType): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : loanTypeLabel(type);
}

// ----- Tooltip content (spec §3.4) -----

export interface AssetValueTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: NetWorthChartRow }>;
  label?: string;
  nameByKey: ReadonlyMap<string, string>;
  headerLabel: string;
  todayIso: string;
}

/**
 * Single-Area charts put ONE entry in the recharts payload; the per-entity
 * breakdown reads the raw row via entry.payload (spec §3.4). Exported for
 * direct unit testing with a fabricated payload.
 */
export function AssetValueTooltipContent({
  active,
  payload,
  label,
  nameByKey,
  headerLabel: hl,
  todayIso,
}: AssetValueTooltipProps) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) return null;
  const rowData = payload[0].payload;
  const t = tooltipRows(rowData, nameByKey, 5);
  return (
    <div className="rounded-md border bg-background shadow-md p-3 text-sm min-w-[200px]">
      <div className="text-xs text-muted-foreground mb-1">
        {formatBucketDate(label ?? rowData.bucketEnd, todayIso)}
      </div>
      <div className="flex items-center justify-between gap-4 font-semibold tabular-nums">
        <span>{hl}</span>
        <span>{formatCurrency(rowData.netWorth)}</span>
      </div>
      <div className="border-t my-1.5" />
      <ul className="space-y-0.5">
        {t.rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4 tabular-nums">
            <span className="text-muted-foreground truncate">{r.name}</span>
            <span>{r.value < 0 ? `−${formatCurrency(Math.abs(r.value))}` : formatCurrency(r.value)}</span>
          </li>
        ))}
        {t.moreCount > 0 && (
          <li className="flex items-center justify-between gap-4 tabular-nums text-muted-foreground">
            <span>+{t.moreCount} more</span>
            <span>{t.moreSum < 0 ? `−${formatCurrency(Math.abs(t.moreSum))}` : formatCurrency(t.moreSum)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

interface AssetValueChartProps {
  surface: AssetValueChartSurface;
}

export default function AssetValueChart({ surface }: AssetValueChartProps) {
  const cfg = SURFACES[surface];
  const prefs = PREFS[surface];

  // ----- Stores (no loading gate — render whatever is there) -----
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const assetValueSnapshots = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots,
  );
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);

  useEffect(() => {
    loadAccounts();
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadLoans();
    loadAssetValueSnapshots();
  }, [
    loadAccounts,
    loadSnapshots,
    loadProperties,
    loadVehicles,
    loadLoans,
    loadAssetValueSnapshots,
  ]);

  const { filter } = useViewFilter();

  // ----- Eligibility (rules unchanged from the old NetWorthTimeSeriesChart) -----
  const eligibleAccounts = useMemo<EligibleEntity[]>(() => {
    return accounts
      .filter(
        (a) =>
          a.id != null &&
          !a.excludedFromNetWorth &&
          snapshots.some((s) => s.accountId === a.id),
      )
      .map((a) => ({ kind: 'account' as const, id: a.id!, name: a.name }));
  }, [accounts, snapshots]);

  const eligibleProperties = useMemo<EligibleEntity[]>(() => {
    return properties
      .filter((p) => p.id != null && !p.excludedFromNetWorth)
      .filter((p) => {
        const hasSnapshot = assetValueSnapshots.some(
          (s) => s.ownerType === 'PROPERTY' && s.ownerId === p.id,
        );
        const hasFallback =
          p.currentEstimatedValue != null && p.currentEstimatedValue > 0;
        return hasSnapshot || hasFallback;
      })
      .map((p) => ({ kind: 'property' as const, id: p.id!, name: p.name }));
  }, [properties, assetValueSnapshots]);

  const eligibleVehicles = useMemo<EligibleEntity[]>(() => {
    return vehicles
      .filter((v) => v.id != null && !v.excludedFromNetWorth)
      .filter((v) => {
        const hasSnapshot = assetValueSnapshots.some(
          (s) => s.ownerType === 'VEHICLE' && s.ownerId === v.id,
        );
        const hasFallback =
          v.currentEstimatedValue != null && v.currentEstimatedValue > 0;
        return hasSnapshot || hasFallback;
      })
      .map((v) => ({ kind: 'vehicle' as const, id: v.id!, name: v.name }));
  }, [vehicles, assetValueSnapshots]);

  const eligibleLoans = useMemo<EligibleEntity[]>(() => {
    return loans
      .filter((l) => l.id != null)
      .map((l) => ({
        kind: 'loan' as const,
        id: l.id!,
        name: loanDisplayName(l.name, l.type),
      }));
  }, [loans]);

  const eligibleAll = useMemo<EligibleEntity[]>(
    () => [
      ...eligibleAccounts,
      ...eligibleProperties,
      ...eligibleVehicles,
      ...eligibleLoans,
    ],
    [eligibleAccounts, eligibleProperties, eligibleVehicles, eligibleLoans],
  );

  // ----- State -----
  const [window_, setWindow] = useState<TimeWindow>('1Y');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // Scrub = transient hover; pin = sticky click (spec §3.5). Each holds a
  // bucketEnd id from chartData, or null when inactive.
  const [scrubBucket, setScrubBucket] = useState<string | null>(null);
  const [pinBucket, setPinBucket] = useState<string | null>(null);

  // Hydrate from localStorage on mount + whenever the eligible set changes:
  // saved window → state; saved selection → intersect with eligible; no
  // saved selection → per-surface default (netWorth: everything; dashboard:
  // assets only). Defaults are NOT persisted — only explicit user actions
  // write to storage.
  const eligibleJoin = eligibleAll.map((e) => entityKey(e.kind, e.id)).join(',');
  useEffect(() => {
    const savedW = prefs.getTimeWindow();
    if (savedW) setWindow(savedW);

    const eligibleKeys = eligibleAll.map((e) => entityKey(e.kind, e.id));
    const saved = prefs.getSelectedEntities();
    if (saved === null) {
      const defaults = cfg.defaultIncludeLoans
        ? eligibleKeys
        : eligibleAll
            .filter((e) => e.kind !== 'loan')
            .map((e) => entityKey(e.kind, e.id));
      setSelectedKeys(new Set(defaults));
    } else {
      const eligibleSet = new Set(eligibleKeys);
      setSelectedKeys(
        new Set(
          saved
            .map((s) => entityKey(s.kind, s.id))
            .filter((key) => eligibleSet.has(key)),
        ),
      );
    }
    // prefs/cfg are intentionally omitted from deps — surface is fixed per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleJoin]);

  // ----- Handlers (state + persistence in lockstep) -----
  const handleWindowChange = (value: string) => {
    const w = value as TimeWindow;
    setWindow(w);
    prefs.setTimeWindow(w);
  };

  const persistSelection = (keys: Set<string>) => {
    prefs.setSelectedEntities(
      [...keys]
        .map(parseEntityKey)
        .filter((p): p is SelectedEntity => p !== null),
    );
  };

  const toggleEntity = (kind: EntityKind, id: number) => {
    const key = entityKey(kind, id);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
    persistSelection(next);
  };

  const selectAll = () => {
    const next = new Set(eligibleAll.map((e) => entityKey(e.kind, e.id)));
    setSelectedKeys(next);
    persistSelection(next);
  };

  const selectNone = () => {
    const next = new Set<string>();
    setSelectedKeys(next);
    persistSelection(next);
  };

  // Scrub/pin handlers are chart-level recharts props — useCallback keeps
  // their identities stable across renders (recharts 3.x discipline above).
  // Guarded setter: recharts rAF-throttles mousemove, and this bail means a
  // re-render happens only on bucket CROSSING, not per pixel.
  const handleScrub = useCallback(
    (s: { activeLabel?: unknown; isTooltipActive?: boolean }) => {
      const label =
        s.isTooltipActive && typeof s.activeLabel === 'string' ? s.activeLabel : null;
      setScrubBucket((prev) => (prev === label ? prev : label));
    },
    [],
  );
  const handleLeave = useCallback(() => setScrubBucket(null), []);
  const handlePinToggle = useCallback(
    (s: { activeLabel?: unknown }) => {
      if (!cfg.allowPin) return;
      if (typeof s.activeLabel !== 'string') return;
      const label = s.activeLabel;
      setPinBucket((prev) => (prev === label ? null : label));
    },
    [cfg.allowPin],
  );

  // ----- Derivations -----
  // Derived per render ON PURPOSE (no mount-pinned memo): a frozen date
  // goes stale across midnight (stale cutoffs, vanishing new snapshots).
  // The ISO string is a primitive, so downstream memos stay stable within
  // a day.
  const todayIso = new Date().toISOString().slice(0, 10);

  // Lib helper mirrors the builder's observation-starts semantics
  // (incl. property/vehicle purchaseDate) so the ALL-window granularity is
  // computed off the same span the spine will actually cover.
  const earliestObservation = useMemo(
    () =>
      earliestObservationIso({
        selectedKeys,
        snapshots,
        assetValueSnapshots,
        properties,
        vehicles,
      }),
    [selectedKeys, snapshots, assetValueSnapshots, properties, vehicles],
  );

  const granularity = useMemo(
    () => granularityForWindow(window_, earliestObservation, todayIso),
    [window_, earliestObservation, todayIso],
  );

  const cutoff = useMemo(
    () => cutoffForWindow(window_, new Date(todayIso + 'T00:00:00Z')),
    [window_, todayIso],
  );

  const chartData = useMemo(() => {
    if (selectedKeys.size === 0) return EMPTY_CHART_DATA;
    return buildNetWorthChartData({
      accounts,
      snapshots,
      properties,
      vehicles,
      loans,
      assetValueSnapshots,
      selectedKeys,
      granularity,
      cutoff,
      today: todayIso,
    });
  }, [
    selectedKeys,
    accounts,
    snapshots,
    properties,
    vehicles,
    loans,
    assetValueSnapshots,
    granularity,
    cutoff,
    todayIso,
  ]);

  const view = useMemo(
    () => buildAssetValueView(chartData, window_, granularity, todayIso),
    [chartData, window_, granularity, todayIso],
  );

  const rowByBucket = useMemo(
    () => new Map(chartData.map((r) => [r.bucketEnd, r] as const)),
    [chartData],
  );

  // Stale-pin guard: clear when the pinned bucket no longer exists (e.g.
  // granularity changed with the range tab). Survives 6M↔1Y (same WEEK ids).
  useEffect(() => {
    setPinBucket((p) => (p && !chartData.some((r) => r.bucketEnd === p) ? null : p));
  }, [chartData]);

  // Esc clears the pin. Registered only while pinned AND the picker is
  // closed: window keydown listeners fire in registration order, so a pin
  // set BEFORE the picker opened would otherwise see the event first and
  // clear itself before the picker's preventDefault() could mark it handled.
  // The defaultPrevented check still defers to any other Esc consumer that
  // ran earlier (e.g. a route-level dialog).
  useEffect(() => {
    if (!pinBucket || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setPinBucket(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinBucket, pickerOpen]);

  const nameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of eligibleAll) m.set(entityKey(e.kind, e.id), e.name);
    return m;
  }, [eligibleAll]);

  const eligibleAssetKeys = useMemo(
    () =>
      eligibleAll
        .filter((e) => e.kind !== 'loan')
        .map((e) => entityKey(e.kind, e.id)),
    [eligibleAll],
  );

  const eligibleLoanKeys = useMemo(
    () => eligibleLoans.map((e) => entityKey(e.kind, e.id)),
    [eligibleLoans],
  );

  const label = useMemo(() => {
    const base = headerLabel({
      selected: selectedKeys,
      eligibleAssets: eligibleAssetKeys,
      eligibleLoans: eligibleLoanKeys,
      nameByKey,
    });
    return filter !== 'household' ? `${base} · Household` : base;
  }, [selectedKeys, eligibleAssetKeys, eligibleLoanKeys, nameByKey, filter]);

  const xTicks = useMemo(() => xTicksFor(chartData, window_), [chartData, window_]);

  // Tooltip content re-renders per mousemove inside recharts; memoizing the
  // ELEMENT (recharts cloneElement-injects active/payload/label into it)
  // keeps that cheap.
  const tooltipElement = useMemo(
    () => <AssetValueTooltipContent nameByKey={nameByKey} headerLabel={label} todayIso={todayIso} />,
    [nameByKey, label, todayIso],
  );

  const hasEligible = eligibleAll.length > 0;
  const hasSelection = selectedKeys.size > 0;

  // Sign-aware trend direction (spec §2 locked decision) — drives the line
  // color, gradient fill, and end dot. Keyed on the FULL-RANGE delta, never
  // on the scrub/pin position (§3.5).
  const trendDown = view.delta !== null && view.delta < 0;
  const lineColor = trendDown ? DESTRUCTIVE : SUCCESS;

  // Header precedence: scrub > pin > latest (spec §3.5), resolved ROW-wise:
  // a scrub/pin id missing from chartData (range change while hovering,
  // midnight tick, store refresh) drops out of precedence entirely instead
  // of pairing the LATEST value with a stale date suffix.
  const scrubRow = scrubBucket ? rowByBucket.get(scrubBucket) ?? null : null;
  const pinRow = pinBucket ? rowByBucket.get(pinBucket) ?? null : null;
  const activeRow =
    scrubRow ??
    pinRow ??
    (view.latest ? rowByBucket.get(view.latest.bucketEnd) ?? null : null);
  const activeValue = activeRow ? activeRow.netWorth : view.latest?.value ?? null;
  const activeDelta =
    activeValue !== null && view.baseline ? activeValue - view.baseline.value : null;
  const activeDeltaPct =
    activeDelta !== null && view.baseline
      ? deltaPctOrNull(activeDelta, view.baseline.value)
      : null;
  // Muted " · <date>" suffix while the header shows a non-latest bucket.
  const activeDateText =
    activeRow && activeRow.bucketEnd !== view.latest?.bucketEnd
      ? formatBucketDate(activeRow.bucketEnd, todayIso)
      : null;

  // Delta row pieces, kept as small string consts. The ROW's direction
  // follows the active delta (a scrubbed loss reads as a loss even on an
  // up range); only the canvas stays keyed on trendDown.
  const activeDown = activeDelta !== null && activeDelta < 0;
  const deltaSign = activeDown ? '−' : '+';
  const deltaDollar = activeDelta !== null ? formatCurrency(Math.abs(activeDelta)) : null;
  const deltaPctText =
    activeDeltaPct !== null
      ? ` (${deltaSign}${Math.abs(activeDeltaPct).toFixed(1)}%)`
      : '';
  const deltaText =
    activeDelta !== null
      ? `${activeDown ? '▼' : '▲'} ${deltaSign}${deltaDollar}${deltaPctText}`
      : null;
  const deltaAria =
    activeDelta !== null
      ? `${activeDown ? 'Down' : 'Up'} ${deltaDollar}` +
        (activeDeltaPct !== null
          ? `, ${Math.abs(activeDeltaPct).toFixed(1)} percent`
          : '') +
        `, ${view.phrase}` +
        (activeDateText ? `, as of ${activeDateText}` : '')
      : undefined;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        {/* ----- Header: label / value / delta + (link · Included picker) ----- */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              {pinBucket && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  Pinned · {formatBucketDate(pinBucket, todayIso)}
                  <button
                    type="button"
                    aria-label="Clear pinned date"
                    onClick={() => setPinBucket(null)}
                    className="hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <div className={`font-semibold tabular-nums ${cfg.valueClass}`}>
              {activeValue !== null ? formatCurrency(activeValue) : '—'}
            </div>
            {deltaText !== null ? (
              <div className="flex flex-wrap items-baseline gap-1.5 text-sm tabular-nums">
                {/* SR path is the sr-only sentence — an aria-label on a
                    role-less div gets pruned entirely by VoiceOver/WKWebView
                    (our actual runtime) when all children are aria-hidden. */}
                <span className="sr-only">{deltaAria}</span>
                <span
                  aria-hidden="true"
                  className={activeDown ? 'text-destructive' : 'text-success'}
                >
                  {deltaText}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  {view.phrase}
                </span>
                {activeDateText && (
                  <span aria-hidden="true" className="text-muted-foreground">
                    · {activeDateText}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                — not enough history
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {cfg.showLink && (
              <Link
                to="/net-worth"
                className="text-sm font-medium text-primary hover:underline"
              >
                Net Worth →
              </Link>
            )}
            {hasEligible && (
              <IncludedPicker
                open={pickerOpen}
                setOpen={setPickerOpen}
                selectedKeys={selectedKeys}
                eligibleAccounts={eligibleAccounts}
                eligibleProperties={eligibleProperties}
                eligibleVehicles={eligibleVehicles}
                eligibleLoans={eligibleLoans}
                eligibleCount={eligibleAll.length}
                onToggle={toggleEntity}
                onSelectAll={selectAll}
                onSelectNone={selectNone}
              />
            )}
          </div>
        </div>

        {/* ----- Range tabs ----- */}
        <Tabs value={window_} onValueChange={handleWindowChange}>
          <TabsList>
            {RANGE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* ----- Body: empty states or the area chart ----- */}
        {!hasEligible ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Add an account, property, vehicle, or loan in Inputs to see your
              wealth over time.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/inputs/accounts">Add an account</Link>
            </Button>
          </div>
        ) : !hasSelection ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Select at least one account, property, vehicle, or loan.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={cfg.height}>
            <AreaChart
              data={chartData}
              margin={CHART_MARGIN}
              onMouseMove={handleScrub}
              onMouseLeave={handleLeave}
              onClick={handlePinToggle}
              style={CHART_WRAPPER_STYLE}
            >
              {/* Plain SVG defs (not recharts components). baseValue="dataMin"
                  resolves against the PADDED domain in recharts 3.8.1, so the
                  vertical gradient reaches the plot bottom (design review). */}
              <defs>
                <linearGradient id={cfg.gradientUpId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={SUCCESS} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={cfg.gradientDownId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DESTRUCTIVE} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={DESTRUCTIVE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="bucketEnd"
                ticks={xTicks}
                tickFormatter={X_TICK_FORMATTERS[window_]}
                stroke={AXIS_STROKE}
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                orientation="right"
                tickFormatter={formatCompactCurrency}
                width={60}
                tickLine={false}
                axisLine={false}
                domain={Y_DOMAIN}
                stroke={AXIS_STROKE}
                fontSize={11}
              />
              <Tooltip content={tooltipElement} cursor={CURSOR} />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke={lineColor}
                strokeWidth={cfg.strokeWidth}
                fill={trendDown ? `url(#${cfg.gradientDownId})` : `url(#${cfg.gradientUpId})`}
                baseValue="dataMin"
                dot={false}
                activeDot={ACTIVE_DOT}
                isAnimationActive={false}
              />
              {pinRow && (
                <ReferenceLine
                  x={pinRow.bucketEnd}
                  stroke={AXIS_STROKE}
                  strokeDasharray={PIN_LINE_DASH}
                />
              )}
              {pinRow && (
                <ReferenceDot
                  x={pinRow.bucketEnd}
                  y={pinRow.netWorth}
                  shape={trendDown ? END_DOT_DOWN : END_DOT_UP}
                />
              )}
              {view.latest && (
                <ReferenceDot
                  x={view.latest.bucketEnd}
                  y={view.latest.value}
                  shape={trendDown ? END_DOT_DOWN : END_DOT_UP}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ----- Included picker (header-right popover) -----

interface IncludedPickerProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedKeys: Set<string>;
  eligibleAccounts: EligibleEntity[];
  eligibleProperties: EligibleEntity[];
  eligibleVehicles: EligibleEntity[];
  eligibleLoans: EligibleEntity[];
  eligibleCount: number;
  onToggle: (kind: EntityKind, id: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

function IncludedPicker({
  open,
  setOpen,
  selectedKeys,
  eligibleAccounts,
  eligibleProperties,
  eligibleVehicles,
  eligibleLoans,
  eligibleCount,
  onToggle,
  onSelectAll,
  onSelectNone,
}: IncludedPickerProps) {
  // Esc closes the picker. Registered only while open, removed on close /
  // unmount. preventDefault marks the event handled so Task 11's pin-Esc
  // listener (which respects defaultPrevented) defers to the picker.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Included · {selectedKeys.size} of {eligibleCount}
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Included entities"
            className="absolute right-0 top-full mt-2 w-72 rounded-md border bg-background shadow-lg p-3 z-20 max-h-96 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Included entities
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={onSelectAll}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={onSelectNone}
                >
                  None
                </button>
              </div>
            </div>
            {eligibleAccounts.length > 0 && (
              <PickerSection
                title="Accounts"
                entities={eligibleAccounts}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
              />
            )}
            {eligibleProperties.length > 0 && (
              <PickerSection
                title="Properties"
                entities={eligibleProperties}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
              />
            )}
            {eligibleVehicles.length > 0 && (
              <PickerSection
                title="Vehicles"
                entities={eligibleVehicles}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
              />
            )}
            {eligibleLoans.length > 0 && (
              <PickerSection
                title="Loans"
                entities={eligibleLoans}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface PickerSectionProps {
  title: string;
  entities: EligibleEntity[];
  selectedKeys: Set<string>;
  onToggle: (kind: EntityKind, id: number) => void;
}

function PickerSection({
  title,
  entities,
  selectedKeys,
  onToggle,
}: PickerSectionProps) {
  return (
    <section className="mb-3 last:mb-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </div>
      <ul className="space-y-1">
        {entities.map((e) => {
          const key = entityKey(e.kind, e.id);
          const inputId = `avc-${e.kind}-${e.id}`;
          return (
            <li
              key={key}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={selectedKeys.has(key)}
                onChange={() => onToggle(e.kind, e.id)}
                className="h-4 w-4 cursor-pointer"
              />
              <label
                htmlFor={inputId}
                className="text-sm cursor-pointer flex-1 truncate"
              >
                {e.name}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
