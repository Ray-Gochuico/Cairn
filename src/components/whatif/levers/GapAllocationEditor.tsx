import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Account } from '@/types/schema';
import type {
  GapAllocation,
  BucketAllocation,
  BucketAllocationMode,
  PerAccountSplit,
} from '@/lib/scenarios';
import { formatCurrency } from '@/lib/format';

export interface GapAllocationEditorProps {
  /** The current monthly gap (income − expenses − loans). Always >= 0; the editor shows a zero state below 0. */
  gap: number;
  gapAllocation: GapAllocation;
  accountsByBucket: { taxAdvantaged: Account[]; brokerage: Account[]; cash: Account[] };
  onChange: (next: GapAllocation) => void;
}

type Bucket = 'taxAdvantaged' | 'brokerage';
const BUCKETS: Bucket[] = ['taxAdvantaged', 'brokerage'];
const BUCKET_LABELS: Record<Bucket, string> = {
  taxAdvantaged: 'Tax-advantaged',
  brokerage:     'Brokerage',
};

function bucketAmount(cfg: BucketAllocation | null, gap: number): number {
  if (!cfg || cfg.value <= 0) return 0;
  if (cfg.mode === 'fixed') return Math.min(cfg.value, gap);
  return gap * cfg.value;
}

/**
 * Per-account-split allocation editor for the gap surplus. Split out of the
 * IncomePopover (2026-05-26 revamp) so the editor's mode toggling + percent
 * conversion + per-account splits + empty-bucket warnings live in their own
 * unit and can be exercised by tests without standing up the popover.
 *
 * Inputs:
 *   - `gap` is the monthly surplus magnitude in nominal $. Always >= 0; the
 *     editor short-circuits to a "no surplus" message when gap <= 0.
 *   - `gapAllocation` is the current routing decision (per spec §E3).
 *   - `accountsByBucket` is the bucket → accounts mapping captured from
 *     RealState. Used for per-account split rendering and empty-bucket
 *     warnings.
 *   - `onChange` is called whenever the user edits any field. The editor
 *     follows the "form sync with store" convention — no internal draft
 *     state; every input change immediately flows out via onChange so the
 *     parent persists to the store.
 *
 * Edge cases handled here (per the spec):
 *   - User flips % → $: convert the percent value to its dollar equivalent
 *     against the current gap (e.g., 50% × $6250 → $3125).
 *   - User flips $ → %: leave the raw value as-is (the user re-enters the
 *     percent manually — the editor doesn't second-guess the dollar amount).
 *   - Bucket has no accounts but user set a non-zero allocation: show a
 *     warning that the amount is redirected to cash.
 *   - Per-account split percentages are re-balanced proportionally as the
 *     user edits one (keeps the bucket sum at 100%).
 */
export function GapAllocationEditor(props: GapAllocationEditorProps) {
  const { gap, gapAllocation, accountsByBucket, onChange } = props;

  // Cash remainder: gap − (allocated to tax-advantaged + brokerage), clamped >= 0.
  const cashRemainder = useMemo(() => {
    const a = bucketAmount(gapAllocation.taxAdvantaged, gap);
    const b = bucketAmount(gapAllocation.brokerage, gap);
    return Math.max(0, gap - a - b);
  }, [gap, gapAllocation]);

  const updateBucket = (bucket: Bucket, patch: BucketAllocation | null) => {
    onChange({ ...gapAllocation, [bucket]: patch });
  };

  const setMode = (bucket: Bucket, mode: BucketAllocationMode) => {
    const current = gapAllocation[bucket];
    if (!current) {
      // Initialize from "null" → mode with value=0.
      updateBucket(bucket, { mode, value: 0, accountSplits: null });
      return;
    }
    // Converting % → $: value × currentGap → new $.
    // Converting $ → %: value stays as-is (per spec — user must re-enter).
    if (current.mode === 'percent' && mode === 'fixed') {
      updateBucket(bucket, { ...current, mode, value: current.value * gap });
    } else {
      updateBucket(bucket, { ...current, mode });
    }
  };

  const setValue = (bucket: Bucket, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    const current = gapAllocation[bucket];
    if (!current) {
      // No mode yet — assume percent by default.
      updateBucket(bucket, { mode: 'percent', value: n / 100, accountSplits: null });
      return;
    }
    // For percent: input is 0..100; store 0..1.
    // For fixed: input is the dollar amount.
    const value = current.mode === 'percent' ? n / 100 : n;
    updateBucket(bucket, { ...current, value });
  };

  const setAccountSplit = (bucket: Bucket, accountId: number, rawPct: string) => {
    const n = Number(rawPct);
    if (!Number.isFinite(n) || n < 0) return;
    const newPct = n / 100;
    const current = gapAllocation[bucket];
    if (!current) return;
    const accts = accountsByBucket[bucket];

    // Rebuild the splits array. If accountSplits is null, start from even
    // split (so the user's edit becomes a delta against the even baseline).
    const baseSplits: PerAccountSplit[] =
      current.accountSplits ??
      accts
        .map((a) => a.id)
        .filter((id): id is number => id != null)
        .map((id) => ({ accountId: id, pct: 1 / accts.length }));

    const updated = baseSplits.map((sp) =>
      sp.accountId === accountId ? { ...sp, pct: newPct } : sp,
    );
    // Redistribute the REMAINING (1 - newPct) over the other ids
    // proportionally so the sum stays close to 1.0. The engine renormalizes
    // at distribute time anyway, but the UX here keeps the visible
    // percentages summing correctly.
    const remaining = Math.max(0, 1 - newPct);
    const others = updated.filter((sp) => sp.accountId !== accountId);
    const othersSum = others.reduce((acc, sp) => acc + sp.pct, 0);
    const rescaled = updated.map((sp) => {
      if (sp.accountId === accountId) return sp;
      if (othersSum === 0) return { ...sp, pct: 0 };
      return { ...sp, pct: remaining * (sp.pct / othersSum) };
    });

    updateBucket(bucket, { ...current, accountSplits: rescaled });
  };

  const resetToDefaults = () => onChange({ taxAdvantaged: null, brokerage: null });

  if (gap <= 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No surplus to allocate this month.
      </div>
    );
  }

  return (
    <div
      data-testid="gap-allocation-editor"
      className="rounded-md border bg-muted/20 p-3 text-sm space-y-3"
    >
      <div className="font-medium">Allocate the {formatCurrency(gap)} surplus</div>

      {BUCKETS.map((bucket) => {
        const cfg = gapAllocation[bucket];
        const accts = accountsByBucket[bucket];
        const amount = bucketAmount(cfg, gap);
        const isEmpty = accts.length === 0;
        const showWarning = isEmpty && cfg !== null && cfg.value > 0;

        const mode: BucketAllocationMode = cfg?.mode ?? 'percent';
        const valueForInput = cfg
          ? cfg.mode === 'percent'
            ? Math.round(cfg.value * 1000) / 10
            : cfg.value
          : 0;

        return (
          <div key={bucket} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-40 font-medium">{BUCKET_LABELS[bucket]}</span>
              <Input
                type="number"
                min={0}
                step={mode === 'percent' ? 1 : 100}
                value={valueForInput}
                onChange={(e) => setValue(bucket, e.target.value)}
                aria-label={`${BUCKET_LABELS[bucket]} ${mode === 'percent' ? 'percent' : 'dollar'} amount`}
                className="w-20"
              />
              <select
                value={mode}
                onChange={(e) => setMode(bucket, e.target.value as BucketAllocationMode)}
                aria-label={`${BUCKET_LABELS[bucket]} mode`}
                className="border rounded h-9 px-2 text-sm bg-background"
              >
                <option value="percent">%</option>
                <option value="fixed">$</option>
              </select>
              <span className="text-muted-foreground tabular-nums">
                = {formatCurrency(amount)}
              </span>
            </div>
            {showWarning && (
              <div role="alert" className="text-xs text-warning-foreground ml-40 mt-1">
                You have no {bucket === 'taxAdvantaged' ? 'tax-advantaged' : 'brokerage'} accounts.
                The {mode === 'percent' ? `${valueForInput}%` : formatCurrency(cfg!.value)}{' '}
                allocated here is being redirected to cash.
              </div>
            )}
            {!isEmpty && cfg !== null && cfg.value > 0 && (
              <div className="ml-40 space-y-1 pt-1 border-l pl-3">
                {accts.map((acct) => {
                  const splits = cfg.accountSplits ??
                    accts
                      .map((a) => a.id)
                      .filter((id): id is number => id != null)
                      .map((id) => ({ accountId: id, pct: 1 / accts.length }));
                  const sp = splits.find((s) => s.accountId === acct.id);
                  const pct = sp ? Math.round(sp.pct * 1000) / 10 : 0;
                  return (
                    <div key={acct.id} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate">{acct.name}</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={pct}
                        onChange={(e) => setAccountSplit(bucket, acct.id!, e.target.value)}
                        aria-label={`${acct.name} percent`}
                        className="w-20"
                      />
                      <span className="text-muted-foreground">%</span>
                      <span className="text-muted-foreground tabular-nums">
                        → {formatCurrency(amount * (sp?.pct ?? 0))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2 text-sm border-t pt-2">
        <span className="w-40 font-medium">Cash (remainder)</span>
        <span
          data-testid="gap-alloc-cash-remainder"
          className="text-muted-foreground tabular-nums"
        >
          {formatCurrency(cashRemainder)}
        </span>
        <span className="text-muted-foreground text-xs">
          ({gap > 0 ? Math.round((cashRemainder / gap) * 1000) / 10 : 0}%)
        </span>
      </div>

      <Button variant="outline" size="sm" onClick={resetToDefaults}>
        Reset to defaults (all cash)
      </Button>
    </div>
  );
}
