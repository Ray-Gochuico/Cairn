import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  cutoffForWindow,
  type Granularity,
  type TimeWindow,
} from '@/lib/snapshot-bucketing';
import { CHART_PALETTE } from '@/components/charts/palette';
import { colorForAccount } from '@/lib/chart-colors';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import {
  getGranularity,
  setGranularity,
  getSelectedEntities,
  setSelectedEntities,
  getTimeWindow,
  setTimeWindow,
  type SelectedEntity,
} from '@/lib/net-worth-chart-prefs';
import { entityKey, parseEntityKey } from '@/lib/entity-key';
import { buildNetWorthChartData } from '@/lib/net-worth-chart-data';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { loanTypeLabel } from '@/lib/loan-labels';

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: 'DAY', label: 'Days' },
  { value: 'WEEK', label: 'Weeks' },
  { value: 'MONTH', label: 'Months' },
  { value: 'QUARTER', label: 'Quarters' },
  { value: 'YEAR', label: 'Years' },
];

const TIME_WINDOW_OPTIONS: Array<{ value: TimeWindow; label: string }> = [
  { value: '3M', label: '3 months' },
  { value: '1Y', label: '1 year' },
  { value: '5Y', label: '5 years' },
  { value: 'ALL', label: 'All time' },
];

// Hoisted constants for recharts ref stability (see InvestmentTimeSeriesChart's
// comment about RenderedTicksReporter loops).
const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 8 } as const;
const LINE_DOT = { r: 3 } as const;
// CSS-variable references so the axis / grid / reference-line strokes
// flip with the theme (Wave-3 Design must-have #2). The Recharts default
// of a hardcoded `#e2e8f0` / `#64748b` / `#0f172a` read fine in light
// mode but inverted incorrectly in dark.
const GRID_STROKE = 'hsl(var(--border))' as const;
const AXIS_STROKE = 'hsl(var(--muted-foreground))' as const;
const ZERO_REFERENCE_STROKE = 'hsl(var(--muted-foreground))' as const;
const NET_WORTH_LINE_STROKE = 'hsl(var(--foreground))' as const;
const EMPTY_CHART_DATA: Array<Record<string, number | string>> = [];

interface EligibleEntity extends SelectedEntity {
  name: string;
}

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  dataKey?: string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const netEntry = payload.find((p) => p.dataKey === 'netWorth');
  const assetEntries: TooltipPayloadItem[] = [];
  const liabilityEntries: TooltipPayloadItem[] = [];
  for (const entry of payload) {
    if (entry.dataKey === 'netWorth') continue;
    if (typeof entry.value !== 'number' || entry.value === 0) continue;
    if (entry.value > 0) assetEntries.push(entry);
    else liabilityEntries.push(entry);
  }
  return (
    <div className="rounded-md border bg-background shadow-md p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
      {assetEntries.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mt-1">Assets</div>
          <ul className="space-y-1">
            {assetEntries.map((entry) => (
              <li
                key={entry.dataKey ?? entry.name}
                className="flex items-center gap-2 tabular-nums"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: entry.color ?? '#94a3b8' }}
                />
                <span className="text-muted-foreground">{entry.name}:</span>
                <span className="ml-auto font-medium">
                  {typeof entry.value === 'number'
                    ? formatCurrency(entry.value)
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {liabilityEntries.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mt-2">Liabilities</div>
          <ul className="space-y-1">
            {liabilityEntries.map((entry) => (
              <li
                key={entry.dataKey ?? entry.name}
                className="flex items-center gap-2 tabular-nums"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: entry.color ?? '#94a3b8' }}
                />
                <span className="text-muted-foreground">{entry.name}:</span>
                <span className="ml-auto font-medium">
                  {typeof entry.value === 'number'
                    ? formatCurrency(Math.abs(entry.value))
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {netEntry && typeof netEntry.value === 'number' && (
        <div className="mt-2 pt-2 border-t flex items-center gap-2 tabular-nums">
          <span className="text-foreground font-semibold">Net Worth:</span>
          <span className="ml-auto font-semibold">
            {formatCurrency(netEntry.value)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Color for a non-account chart segment (property / vehicle / loan).
 * Deterministic from the composite entityKey string-hash so two entries
 * of the same kind don't always pick the same palette slot.
 */
function colorForEntity(kind: SelectedEntity['kind'], id: number): string {
  if (kind === 'account') return colorForAccount(id);
  const key = `${kind}:${id}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return CHART_PALETTE[Math.abs(h) % CHART_PALETTE.length];
}

/**
 * Display label for a loan in the picker / legend / tooltip — name if
 * non-empty, fall back to loanTypeLabel(loan.type).
 */
function loanDisplayName(name: string, type: import('@/types/enums').LoanType): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) return trimmed;
  return loanTypeLabel(type);
}

export default function NetWorthTimeSeriesChart() {
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

  // Eligible entities — only show in the picker if the entity has
  // something to plot:
  //   - account: has at least one snapshot
  //   - property/vehicle: not excluded, and has either a snapshot or a
  //     non-null currentEstimatedValue (otherwise the segment is 0 every
  //     bucket — not useful)
  //   - loan: any non-deleted loan
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

  const [granularity, setGranularityState] = useState<Granularity>('MONTH');
  const [timeWindow, setTimeWindowState] = useState<TimeWindow>('ALL');
  const [selectedKeys, setSelectedKeysState] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate from localStorage on mount + when the set of eligible
  // entities changes. Mirrors InvestmentTimeSeriesChart's pattern of
  // intersecting saved selection with currently-eligible ids.
  useEffect(() => {
    const savedG = getGranularity();
    if (savedG) setGranularityState(savedG);

    const savedW = getTimeWindow();
    if (savedW) setTimeWindowState(savedW);

    const eligibleKeys = new Set(eligibleAll.map((e) => entityKey(e.kind, e.id)));
    const saved = getSelectedEntities();
    if (saved === null) {
      // Default: assets are pre-selected, liabilities are pre-selected
      // too — the spec wants the full net-worth picture by default.
      setSelectedKeysState(new Set(eligibleKeys));
    } else {
      const intersected = saved
        .map((s) => entityKey(s.kind, s.id))
        .filter((key) => eligibleKeys.has(key));
      setSelectedKeysState(new Set(intersected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleAll.map((e) => `${e.kind}:${e.id}`).join(',')]);

  const handleGranularityChange = (g: Granularity) => {
    setGranularityState(g);
    setGranularity(g);
  };

  const handleTimeWindowChange = (w: TimeWindow) => {
    setTimeWindowState(w);
    setTimeWindow(w);
  };

  const toggleEntity = (kind: SelectedEntity['kind'], id: number) => {
    const key = entityKey(kind, id);
    setSelectedKeysState((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setSelectedEntities(
        [...next]
          .map(parseEntityKey)
          .filter((p): p is { kind: SelectedEntity['kind']; id: number } =>
            p !== null,
          ),
      );
      return next;
    });
  };

  const cutoff = useMemo(() => cutoffForWindow(timeWindow), [timeWindow]);

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
  ]);

  // Split selection by kind for rendering — assets stack positive,
  // liabilities stack negative (under separate stackIds).
  const selectedAssets = useMemo<EligibleEntity[]>(() => {
    return eligibleAll.filter(
      (e) =>
        (e.kind === 'account' ||
          e.kind === 'property' ||
          e.kind === 'vehicle') &&
        selectedKeys.has(entityKey(e.kind, e.id)),
    );
  }, [eligibleAll, selectedKeys]);

  const selectedLiabilities = useMemo<EligibleEntity[]>(() => {
    return eligibleAll.filter(
      (e) => e.kind === 'loan' && selectedKeys.has(entityKey(e.kind, e.id)),
    );
  }, [eligibleAll, selectedKeys]);

  const tooltipContent = useMemo<ReactElement>(() => <CustomTooltip />, []);

  const hasEligible = eligibleAll.length > 0;
  const hasSelection = selectedKeys.size > 0;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Net Worth Over Time</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="nw-chart-granularity"
                className="text-xs text-muted-foreground whitespace-nowrap"
              >
                Granularity
              </Label>
              <select
                id="nw-chart-granularity"
                value={granularity}
                onChange={(e) =>
                  handleGranularityChange(e.target.value as Granularity)
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {GRANULARITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="nw-chart-window"
                className="text-xs text-muted-foreground whitespace-nowrap"
              >
                Window
              </Label>
              <select
                id="nw-chart-window"
                value={timeWindow}
                onChange={(e) =>
                  handleTimeWindowChange(e.target.value as TimeWindow)
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TIME_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {hasEligible && (
              <div className="relative">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-expanded={pickerOpen}
                  aria-haspopup="dialog"
                >
                  Entities ({selectedKeys.size}/{eligibleAll.length})
                </Button>
                {pickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      aria-hidden="true"
                      onMouseDown={() => setPickerOpen(false)}
                    />
                    <div
                      role="dialog"
                      aria-label="Select entities"
                      className="absolute right-0 top-full mt-2 w-72 rounded-md border bg-background shadow-lg p-3 z-20 max-h-96 overflow-y-auto"
                    >
                      {eligibleAccounts.length > 0 && (
                        <PickerSection
                          title="Accounts"
                          entities={eligibleAccounts}
                          selectedKeys={selectedKeys}
                          onToggle={toggleEntity}
                        />
                      )}
                      {eligibleProperties.length > 0 && (
                        <PickerSection
                          title="Properties"
                          entities={eligibleProperties}
                          selectedKeys={selectedKeys}
                          onToggle={toggleEntity}
                        />
                      )}
                      {eligibleVehicles.length > 0 && (
                        <PickerSection
                          title="Vehicles"
                          entities={eligibleVehicles}
                          selectedKeys={selectedKeys}
                          onToggle={toggleEntity}
                        />
                      )}
                      {eligibleLoans.length > 0 && (
                        <PickerSection
                          title="Loans"
                          entities={eligibleLoans}
                          selectedKeys={selectedKeys}
                          onToggle={toggleEntity}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasEligible ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Add an account, property, vehicle, or loan in Inputs to see your net
            worth over time.
          </p>
        ) : !hasSelection ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Select at least one account, property, vehicle, or loan.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis
                dataKey="bucketEnd"
                stroke={AXIS_STROKE}
                fontSize={11}
                tick={{ fill: AXIS_STROKE }}
              />
              <YAxis
                tickFormatter={formatCompactCurrency}
                stroke={AXIS_STROKE}
                fontSize={11}
                width={64}
                tick={{ fill: AXIS_STROKE }}
              />
              <ReferenceLine y={0} stroke={ZERO_REFERENCE_STROKE} />
              <Tooltip content={tooltipContent} />
              <Legend />
              {selectedAssets.map((a) => (
                <Bar
                  key={entityKey(a.kind, a.id)}
                  dataKey={entityKey(a.kind, a.id)}
                  stackId="assets"
                  fill={colorForEntity(a.kind, a.id)}
                  name={a.name}
                  isAnimationActive={false}
                />
              ))}
              {selectedLiabilities.map((l) => (
                <Bar
                  key={entityKey(l.kind, l.id)}
                  dataKey={entityKey(l.kind, l.id)}
                  stackId="liabilities"
                  fill={colorForEntity(l.kind, l.id)}
                  name={l.name}
                  isAnimationActive={false}
                />
              ))}
              <Line
                dataKey="netWorth"
                stroke={NET_WORTH_LINE_STROKE}
                strokeWidth={2.5}
                dot={LINE_DOT}
                name="Net Worth"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface PickerSectionProps {
  title: string;
  entities: EligibleEntity[];
  selectedKeys: Set<string>;
  onToggle: (kind: SelectedEntity['kind'], id: number) => void;
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
          const checked = selectedKeys.has(key);
          const inputId = `nw-chart-${e.kind}-${e.id}`;
          return (
            <li
              key={key}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(e.kind, e.id)}
                className="h-4 w-4 cursor-pointer"
              />
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-sm shrink-0"
                style={{ background: colorForEntity(e.kind, e.id) }}
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
