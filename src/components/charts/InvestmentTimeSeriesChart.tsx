import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
import {
  bucketSnapshots,
  type Granularity,
} from '@/lib/snapshot-bucketing';
import { colorForAccount } from '@/lib/account-colors';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import {
  getGranularity,
  setGranularity,
  getSelectedAccounts,
  setSelectedAccounts,
} from '@/lib/investment-chart-prefs';
import type { Account, Holding, AccountSnapshot } from '@/types/schema';

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: 'DAY', label: 'Days' },
  { value: 'WEEK', label: 'Weeks' },
  { value: 'MONTH', label: 'Months' },
  { value: 'QUARTER', label: 'Quarters' },
  { value: 'YEAR', label: 'Years' },
];

const MAX_BUCKETS = 90;

interface InvestmentTimeSeriesChartProps {
  accounts: Account[];
  holdings: Holding[];
  snapshots: AccountSnapshot[];
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
  // Separate the Total line from per-account bars.
  const totalEntry = payload.find((p) => p.dataKey === 'total');
  const accountEntries = payload.filter(
    (p) => p.dataKey !== 'total' && typeof p.value === 'number' && p.value !== 0,
  );
  return (
    <div className="rounded-md border bg-background shadow-md p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
      <ul className="space-y-1">
        {accountEntries.map((entry) => (
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
              {typeof entry.value === 'number' ? formatCurrency(entry.value) : '—'}
            </span>
          </li>
        ))}
      </ul>
      {totalEntry && typeof totalEntry.value === 'number' && (
        <div className="mt-2 pt-2 border-t flex items-center gap-2 tabular-nums">
          <span className="text-foreground font-semibold">Total:</span>
          <span className="ml-auto font-semibold">{formatCurrency(totalEntry.value)}</span>
        </div>
      )}
    </div>
  );
}

export default function InvestmentTimeSeriesChart({
  accounts,
  holdings,
  snapshots,
}: InvestmentTimeSeriesChartProps) {
  // Accounts with at least one holding — these are the only ones picker shows.
  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => a.id != null && holdings.some((h) => h.accountId === a.id)),
    [accounts, holdings],
  );

  const [granularity, setGranularityState] = useState<Granularity>('MONTH');
  const [selectedAccountIds, setSelectedAccountIdsState] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate from localStorage on mount, intersecting saved selection with eligible accounts.
  useEffect(() => {
    const savedG = getGranularity();
    if (savedG) setGranularityState(savedG);

    const eligibleIds = eligibleAccounts.map((a) => a.id!).filter((n): n is number => typeof n === 'number');
    const saved = getSelectedAccounts();
    if (saved === null) {
      setSelectedAccountIdsState(new Set(eligibleIds));
    } else {
      const eligibleSet = new Set(eligibleIds);
      const intersected = saved.filter((id) => eligibleSet.has(id));
      setSelectedAccountIdsState(new Set(intersected));
    }
    // We intentionally re-run when the set of eligible account ids changes;
    // a stringified key avoids retriggering on identity-only re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleAccounts.map((a) => a.id).join(',')]);

  const handleGranularityChange = (g: Granularity) => {
    setGranularityState(g);
    setGranularity(g);
  };

  const toggleAccount = (id: number) => {
    setSelectedAccountIdsState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedAccounts([...next]);
      return next;
    });
  };

  // Build chart data: per-bucket row keyed by account name with a `total`.
  const filteredSnapshots = useMemo(
    () => snapshots.filter((s) => selectedAccountIds.has(s.accountId)),
    [snapshots, selectedAccountIds],
  );

  const selectedAccounts = useMemo(
    () => eligibleAccounts.filter((a) => a.id != null && selectedAccountIds.has(a.id)),
    [eligibleAccounts, selectedAccountIds],
  );

  const chartData = useMemo(() => {
    if (selectedAccounts.length === 0 || filteredSnapshots.length === 0) return [];
    const bucketed = bucketSnapshots(filteredSnapshots, granularity, MAX_BUCKETS);
    return bucketed.bucketEnds.map((bEnd, i) => {
      const row: Record<string, number | string> = { bucketEnd: bEnd };
      let total = 0;
      for (const acc of selectedAccounts) {
        const series = bucketed.valuesByAccount.get(acc.id!) ?? [];
        const v = series[i] ?? 0;
        row[acc.name] = v;
        total += v;
      }
      row.total = total;
      return row;
    });
  }, [filteredSnapshots, selectedAccounts, granularity]);

  // Render guards: no eligible accounts vs. user unchecked all.
  const hasEligible = eligibleAccounts.length > 0;
  const hasSelection = selectedAccounts.length > 0;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Investments Over Time</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Time bucket granularity">
              {GRANULARITY_OPTIONS.map((opt) => {
                const active = opt.value === granularity;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    aria-pressed={active}
                    onClick={() => handleGranularityChange(opt.value)}
                  >
                    {opt.label}
                  </Button>
                );
              })}
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
                  Accounts ({selectedAccountIds.size}/{eligibleAccounts.length})
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
                      aria-label="Select accounts"
                      className="absolute right-0 top-full mt-2 w-64 rounded-md border bg-background shadow-lg p-2 z-20"
                    >
                      <ul className="space-y-1 max-h-72 overflow-y-auto">
                        {eligibleAccounts.map((acc) => {
                          const id = acc.id!;
                          const checked = selectedAccountIds.has(id);
                          const inputId = `inv-chart-acc-${id}`;
                          return (
                            <li key={id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent">
                              <input
                                id={inputId}
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAccount(id)}
                                className="h-4 w-4 cursor-pointer"
                              />
                              <span
                                aria-hidden="true"
                                className="inline-block h-3 w-3 rounded-sm shrink-0"
                                style={{ background: colorForAccount(id) }}
                              />
                              <label htmlFor={inputId} className="text-sm cursor-pointer flex-1 truncate">
                                {acc.name}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
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
            Add holdings in Inputs to see your investment time series.
          </p>
        ) : !hasSelection ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Select at least one account.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="bucketEnd" stroke="#64748b" fontSize={11} />
              <YAxis
                tickFormatter={formatCompactCurrency}
                stroke="#64748b"
                fontSize={11}
                width={64}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              {selectedAccounts.map((acc) => (
                <Bar
                  key={acc.id}
                  dataKey={acc.name}
                  stackId="investments"
                  fill={colorForAccount(acc.id!)}
                  name={acc.name}
                />
              ))}
              <Line
                dataKey="total"
                stroke="#0f172a"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                name="Total"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
