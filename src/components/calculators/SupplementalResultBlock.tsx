import type { ReactNode } from 'react';
import { ResultRow } from '@/components/calculators/ResultRow';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { SupplementalMethod } from '@/lib/calculators/use-supplemental-method';

export interface SupplementalTaxRows {
  /** All ANNUAL figures; the block divides by `periods` for per-event rows. */
  federal: number;
  fica: number;
  state: number;
  city: number;
  total: number;
  takeHome: number;
  /** AGGREGATE: the engine's marginalRateOnBonus. FLAT: total ÷ wages. */
  rate: number;
}

interface SupplementalResultBlockProps {
  /** 'bonus' | 'commission' | 'overtime' — label text only. */
  noun: string;
  periods: number;
  method: SupplementalMethod;
  rows: SupplementalTaxRows;
  /** Extra rows appended before the teaching row (D1 deferral routing). */
  children?: ReactNode;
}

/**
 * Shared supplemental-wage result block (Wave 18): tax rows → rate row
 * labeled per method (Wave-15 label semantics: marginal under Aggregate,
 * effective withholding under Flat — D3: the flat ratio is NOT a marginal
 * rate) → take-home emphasis → the calm "why is so much withheld" teaching
 * row.
 */
export function SupplementalResultBlock({
  noun,
  periods,
  method,
  rows,
  children,
}: SupplementalResultBlockProps) {
  const per = (v: number) => formatCurrency(v / periods);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ResultRow label={`Estimated federal on ${noun}`} value={per(rows.federal)} />
        <ResultRow label={<><TermTooltip term="FICA" /> on {noun}</>} value={per(rows.fica)} />
        <ResultRow label={`Estimated state on ${noun}`} value={per(rows.state)} />
        <ResultRow label={`Estimated city on ${noun}`} value={per(rows.city)} />
        <ResultRow label={`Estimated total tax on ${noun}`} value={per(rows.total)} />
        <ResultRow
          label={
            method === 'AGGREGATE' ? (
              <TermTooltip term="marginal rate" />
            ) : (
              // Wave-15 landed label: the flat ratio is an EFFECTIVE
              // withholding rate — calling it marginal was false.
              <TermTooltip term="effective rate">effective withholding rate</TermTooltip>
            )
          }
          value={formatPercent(rows.rate)}
          testId="supplemental-rate"
        />
      </div>
      <ResultRow
        label={`Estimated ${noun} take-home`}
        value={per(rows.takeHome)}
        emphasis
        testId="supplemental-takehome"
      />
      {children}
      <p className="text-sm text-muted-foreground">
        Supplemental pay is withheld differently from your regular paycheck, so the check can
        look smaller than you expect. Withholding isn&#39;t your final tax — it reconciles when
        you file.
      </p>
    </div>
  );
}
