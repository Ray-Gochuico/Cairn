import { useEffect, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from './DonutEntityPicker';
import { useLoansStore } from '@/stores/loans-store';
import { loanTypeLabel } from '@/lib/loan-labels';
import { formatCurrency } from '@/lib/format';
import { CHART_PALETTE } from './palette';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STORAGE_KEY = 'donut.liabilities.hidden';

/**
 * Per-loan composition of the household's debt at the current moment.
 * One slice per loan with a positive `currentBalance`, labelled by the
 * loan's `name` (falling back to a human-readable `loanTypeLabel` when
 * the name is empty or whitespace-only). Sits alongside `AssetsDonut`
 * below the Net Worth time-series chart.
 *
 * Picker: a header popover lets the user hide individual loans; the
 * hidden set persists in localStorage under `donut.liabilities.hidden`.
 * Keys are loan id strings.
 */
export default function LiabilitiesDonut() {
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  // Build the donut slices AND the parallel picker items in one pass so the
  // slice name and the picker key stay perfectly aligned. Loan name is the
  // user-facing display label; loan id is the stable picker key (loan
  // names can be edited; ids cannot).
  const { slices, pickerItems, keyByName } = useMemo<{
    slices: DonutSlice[];
    pickerItems: DonutEntityPickerItem[];
    keyByName: Map<string, string>;
  }>(() => {
    const sl: DonutSlice[] = [];
    const pi: DonutEntityPickerItem[] = [];
    const kbn = new Map<string, string>();
    let idx = 0;
    for (const l of loans) {
      if (l.id == null) continue;
      if (l.currentBalance <= 0) continue;
      const trimmed = l.name.trim();
      const label = trimmed.length > 0 ? trimmed : loanTypeLabel(l.type);
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      const key = l.id.toString();
      sl.push({ name: label, value: l.currentBalance });
      pi.push({ key, label, color });
      kbn.set(label, key);
      idx += 1;
    }
    return { slices: sl, pickerItems: pi, keyByName: kbn };
  }, [loans]);

  const allKeys = useMemo(() => pickerItems.map((i) => i.key), [pickerItems]);
  const selected = useDonutSelected(STORAGE_KEY, allKeys);

  const filteredSlices = useMemo(
    () =>
      slices.filter((s) => {
        const k = keyByName.get(s.name);
        return k !== undefined && selected.has(k);
      }),
    [slices, keyByName, selected],
  );

  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Liabilities</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No loans recorded yet.
        </CardContent>
      </Card>
    );
  }

  const picker = (
    <DonutEntityPicker localStorageKey={STORAGE_KEY} items={pickerItems} />
  );

  if (filteredSlices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Liabilities</CardTitle>
            {picker}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            All entities hidden. Open the picker above to show at least one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-10">{picker}</div>
      <DonutChartCard
        title="Liabilities"
        data={filteredSlices}
        valueFormatter={formatCurrency}
      />
    </div>
  );
}
