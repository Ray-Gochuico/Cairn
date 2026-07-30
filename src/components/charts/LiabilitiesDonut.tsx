import { useEffect, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from './DonutEntityPicker';
import { useLoansStore } from '@/stores/loans-store';
import { loanTypeLabel } from '@/lib/loan-labels';
import { formatCurrency } from '@/lib/format';
import { useViewScope } from '@/lib/use-view-scope';
import { filterByObligorPersonId } from '@/lib/filter-by-view';
import { partitionHidden } from '@/lib/view-scope';
import { colorForLoan } from '@/lib/chart-colors';
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
  // Wave A D4 (supersedes W10 T7): the donut GENUINELY filters by the person
  // view now (loans carry obligorPersonId) — the '· Household' suffix is
  // gone because the data is scoped; a filtered-to-empty view names the
  // hidden counts (C27) instead of the onboarding copy.
  const { filter, isFiltered, personName, persons } = useViewScope();
  const title = 'Liabilities';
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  const visibleLoans = useMemo(
    () => filterByObligorPersonId(loans, filter, persons),
    [loans, filter, persons],
  );
  const hiddenPartition = useMemo(
    () => partitionHidden(loans, visibleLoans, (l) => l.obligorPersonId),
    [loans, visibleLoans],
  );

  // Build the donut slices AND the parallel picker items in one pass so the
  // slice name and the picker key stay perfectly aligned. Loan name is the
  // user-facing display label; loan id is the stable picker key (loan
  // names can be edited; ids cannot).
  const { slices, pickerItems } = useMemo<{
    slices: DonutSlice[];
    pickerItems: DonutEntityPickerItem[];
  }>(() => {
    const sl: DonutSlice[] = [];
    const pi: DonutEntityPickerItem[] = [];
    for (const l of visibleLoans) {
      if (l.id == null) continue;
      if (l.currentBalance <= 0) continue;
      const trimmed = l.name.trim();
      const label = trimmed.length > 0 ? trimmed : loanTypeLabel(l.type);
      // Color keyed on the loan ID (not the running insertion index) and
      // attached to BOTH the slice and the picker item from one source, so a
      // kept wedge never re-colors when another loan is hidden — wedge ==
      // legend == picker swatch by construction (the I9 desync fix). The slice
      // carries `entityKey` (the loan id) so two loans sharing a display label
      // stay independently toggleable.
      const color = colorForLoan(l.id);
      const key = l.id.toString();
      sl.push({ name: label, value: l.currentBalance, color, entityKey: key });
      pi.push({ key, label, color });
    }
    return { slices: sl, pickerItems: pi };
  }, [visibleLoans]);

  const allKeys = useMemo(() => pickerItems.map((i) => i.key), [pickerItems]);
  const selected = useDonutSelected(STORAGE_KEY, allKeys);

  const filteredSlices = useMemo(
    () =>
      slices.filter((s) => s.entityKey !== undefined && selected.has(s.entityKey)),
    [slices, selected],
  );

  // Full-universe denominator (hidden loans included) so hiding one never
  // re-normalizes the shares that remain.
  const fullTotal = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);

  // Two-tier empty (Wave A C27): a view that hid every loan names the counts;
  // only a truly loan-free household gets the onboarding copy.
  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isFiltered && hiddenPartition.hiddenCount > 0
            ? filter === 'joint'
              ? `No joint loans — ${hiddenPartition.otherCount} individually owned not shown.`
              : `No loans in ${personName}'s name — ${hiddenPartition.hiddenCount} household loan${hiddenPartition.hiddenCount === 1 ? '' : 's'} not shown.`
            : 'No loans recorded yet.'}
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
            <CardTitle>{title}</CardTitle>
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
    <DonutChartCard
      title={title}
      data={filteredSlices}
      shareTotal={fullTotal}
      valueFormatter={formatCurrency}
      headerRight={picker}
    />
  );
}
