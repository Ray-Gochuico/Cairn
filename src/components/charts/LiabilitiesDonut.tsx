import { useEffect, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { useLoansStore } from '@/stores/loans-store';
import { loanTypeLabel } from '@/lib/loan-labels';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Per-loan composition of the household's debt at the current moment.
 * One slice per loan with a positive `currentBalance`, labelled by the
 * loan's `name` (falling back to a human-readable `loanTypeLabel` when
 * the name is empty or whitespace-only). Sits alongside `AssetsDonut`
 * below the Net Worth time-series chart.
 */
export default function LiabilitiesDonut() {
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  const slices = useMemo<DonutSlice[]>(() => {
    const out: DonutSlice[] = [];
    for (const l of loans) {
      if (l.id == null) continue;
      if (l.currentBalance <= 0) continue;
      const trimmed = l.name.trim();
      const label = trimmed.length > 0 ? trimmed : loanTypeLabel(l.type);
      out.push({ name: label, value: l.currentBalance });
    }
    return out;
  }, [loans]);

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

  return (
    <DonutChartCard
      title="Liabilities"
      data={slices}
      valueFormatter={formatCurrency}
    />
  );
}
