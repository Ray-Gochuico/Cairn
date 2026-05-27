import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { taxBucketForAccount } from '@/lib/account-tax-classification';
import type { ContributionSegment } from '@/lib/scenarios';
import type { Account } from '@/types/schema';
import { useSurplusFlowPreview } from '@/components/whatif/useSurplusFlowPreview';
import { formatCurrency } from '@/lib/format';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

// DraftRow uses 1-based years for the UI; segments are persisted with 0-based
// months-from-projection-start. "Open-ended" is represented as endYear === null.
interface DraftRow {
  startYear: number;
  endYear: number | null;
  monthlyAmount: number;
  label: string;
  allocationOpen: boolean;
  overrideOn: boolean;
  /** accountId → percent 0..100 (UI representation; converted to 0..1 on save) */
  pcts: Record<number, number>;
}

const SUM_TOLERANCE = 0.01;

function deriveInitialPcts(
  allocation: Record<string, number> | null,
  investmentAccountIds: number[],
): Record<number, number> {
  if (allocation) {
    return Object.fromEntries(
      Object.entries(allocation).map(([k, v]) => [Number(k), Math.round(v * 1000) / 10]),
    );
  }
  if (investmentAccountIds.length === 0) return {};
  // Round to one decimal to keep the UI tidy.
  const even = Math.round(1000 / investmentAccountIds.length) / 10;
  return Object.fromEntries(investmentAccountIds.map((id) => [id, even]));
}

function segmentsToDraft(
  segments: ContributionSegment[],
  investmentAccountIds: number[],
): DraftRow[] {
  return segments.map((s) => {
    // Treat both `null` and `undefined` as "no override" — older payloads in
    // the store may pre-date the allocation field.
    const alloc = s.allocation ?? null;
    return {
      startYear: Math.floor(s.startMonth / 12) + 1,
      endYear: s.endMonth === null ? null : Math.floor(s.endMonth / 12) + 1,
      monthlyAmount: s.monthlyAmount,
      label: s.label ?? '',
      allocationOpen: false,
      overrideOn: alloc !== null,
      pcts: deriveInitialPcts(alloc, investmentAccountIds),
    };
  });
}

function draftToSegments(
  rows: DraftRow[],
  investmentAccountIds: number[],
): ContributionSegment[] {
  return rows.map((r) => {
    const startMonth = Math.max(0, (r.startYear - 1) * 12);
    const endMonth = r.endYear === null ? null : Math.max(startMonth, r.endYear * 12 - 1);
    let allocation: Record<string, number> | null = null;
    if (r.overrideOn && investmentAccountIds.length > 0) {
      const total = investmentAccountIds.reduce((s, id) => s + (r.pcts[id] ?? 0), 0);
      if (Math.abs(total - 100) < SUM_TOLERANCE) {
        allocation = Object.fromEntries(
          investmentAccountIds.map((id) => [String(id), (r.pcts[id] ?? 0) / 100]),
        );
      }
    }
    const seg: ContributionSegment = {
      startMonth,
      endMonth,
      monthlyAmount: Math.max(0, r.monthlyAmount),
      allocation,
    };
    if (r.label.trim()) seg.label = r.label.trim();
    return seg;
  });
}

function emptyRow(investmentAccountIds: number[]): DraftRow {
  return {
    startYear: 1,
    endYear: 5,
    monthlyAmount: 1000,
    label: '',
    allocationOpen: false,
    overrideOn: false,
    pcts: deriveInitialPcts(null, investmentAccountIds),
  };
}

export default function ContributionsPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const accounts = useAccountsStore((s) => s.accounts);
  const active = scenarios.find((s) => s.isActive);

  const investmentAccounts: Account[] = accounts.filter((a) => taxBucketForAccount(a) !== null);
  const investmentAccountIds = investmentAccounts
    .map((a) => a.id)
    .filter((id): id is number => id != null);

  // Task β2 — preview card branches on the surplus destination. The hook
  // sums both routing destinations and reads the household's auto-invest
  // setting so the card surfaces consistent copy across surfaces. Other
  // levers (income / expenses / loans) reflect the user's current scenario
  // — only the contributions are stripped inside the helper.
  const surplus = useSurplusFlowPreview(active?.leverPayload ?? null);

  const [draft, setDraft] = useState<DraftRow[]>(() =>
    segmentsToDraft(active?.leverPayload.contributions ?? [], investmentAccountIds),
  );

  useEffect(() => {
    if (open) {
      setDraft(segmentsToDraft(active?.leverPayload.contributions ?? [], investmentAccountIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.leverPayload]);

  const setRow = (i: number, patch: Partial<DraftRow>) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Disable Apply if any segment has override on but its percent inputs do not
  // sum to 100. We still let the user save when override is off (allocation =
  // null falls back to even split at projection time).
  const allocationInvalid = draft.some((row) => {
    if (!row.overrideOn) return false;
    const total = investmentAccountIds.reduce((s, id) => s + (row.pcts[id] ?? 0), 0);
    return Math.abs(total - 100) >= SUM_TOLERANCE;
  });

  const handleApply = async () => {
    if (!active?.id) return;
    if (allocationInvalid) return;
    await useScenariosStore.getState().updateLever(active.id, {
      contributions: draftToSegments(draft, investmentAccountIds),
    });
    onOpenChange(false);
  };

  const handleReset = () =>
    setDraft(segmentsToDraft(active?.leverPayload.contributions ?? [], investmentAccountIds));

  return (
    <LeverPopoverShell
      open={open}
      title="Investment contributions"
      onOpenChange={onOpenChange}
      onApply={handleApply}
      onReset={handleReset}
      applyDisabled={allocationInvalid}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Set a fixed monthly contribution that flows into investments over a span
          of years. Any surplus above the contribution accumulates as cash; a
          shortfall lets cash drop (or go negative) while the contribution still
          lands in investments.
        </p>

        {/* Task β2 — read-only surplus-flow card. Visible only when there are
            no segments AND the surplus magnitude is positive. Copy branches on
            the household's auto-invest setting (migration 0029):
            - 'cash' (the new default since 2026-05-26): nudges the user to add
              a segment so some of the surplus actually invests.
            - 'investments': preserves the legacy "Auto-invest" framing.
            The same dollar amount appears either way (it's the surplus
            magnitude, not the routed-to-investments amount). */}
        {draft.length === 0 && surplus.amount > 0 && (
          <div
            data-testid="contributions-surplus-flow-card"
            className="rounded-md border bg-muted/50 px-3 py-2 text-xs space-y-1"
          >
            {/* Transitional bridge (α3 → γ2): the surplus preview is now a
                per-bucket breakdown. We branch on "any non-cash routing
                configured?" to preserve the prior copy semantics; γ2 will
                rewrite this card to show the three-row breakdown directly. */}
            {surplus.taxAdvantaged + surplus.brokerage === 0 ? (
              <>
                <div className="font-medium">
                  {formatCurrency(surplus.amount)}/mo of monthly surplus is going to cash.
                </div>
                <p className="text-muted-foreground">
                  Add a segment below to invest some or all of it each month, or
                  configure routing in the Income lever (gap allocation).
                </p>
              </>
            ) : (
              <>
                <div className="font-medium">
                  Auto-investing {formatCurrency(surplus.taxAdvantaged + surplus.brokerage)}/mo from salary surplus.
                </div>
                <p className="text-muted-foreground">
                  (income &minus; expenses &minus; loan payments) — routed via the
                  gap allocation lever. Tune in the Income popover.
                </p>
              </>
            )}
          </div>
        )}

        <div className="space-y-2">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">No contribution segments yet.</p>
          )}
          {draft.map((row, i) => {
            const allocTotal = investmentAccountIds.reduce((s, id) => s + (row.pcts[id] ?? 0), 0);
            const allocSumOk = Math.abs(allocTotal - 100) < SUM_TOLERANCE;
            return (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end border-b py-2">
                <div>
                  <Label htmlFor={`cstart-${i}`} className="text-xs">From year</Label>
                  <Input
                    id={`cstart-${i}`}
                    type="number"
                    min={1}
                    step={1}
                    value={row.startYear}
                    onChange={(e) => setRow(i, { startYear: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                    aria-label="From year"
                  />
                </div>
                <div>
                  <Label htmlFor={`cend-${i}`} className="text-xs">Through year</Label>
                  <Input
                    id={`cend-${i}`}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="open"
                    value={row.endYear ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === '') setRow(i, { endYear: null });
                      else setRow(i, { endYear: Math.max(row.startYear, Math.floor(Number(raw) || row.startYear)) });
                    }}
                    aria-label="Through year (blank = open-ended)"
                  />
                </div>
                <div>
                  <Label htmlFor={`camt-${i}`} className="text-xs">Monthly ($)</Label>
                  <Input
                    id={`camt-${i}`}
                    type="number"
                    min={0}
                    step={50}
                    value={row.monthlyAmount}
                    onChange={(e) => setRow(i, { monthlyAmount: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label="Monthly amount"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`clabel-${i}`} className="text-xs">Label</Label>
                  <Input
                    id={`clabel-${i}`}
                    value={row.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    aria-label="Label"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove segment ${i + 1}`}
                    onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </Button>
                </div>

                {/* Allocation expander spans the full row. */}
                <div className="sm:col-span-6">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    aria-label={`Advanced: allocation for segment ${i + 1}`}
                    onClick={() => setRow(i, { allocationOpen: !row.allocationOpen })}
                  >
                    {row.allocationOpen ? '▲ Advanced: allocation' : '▼ Advanced: allocation'}
                  </button>

                  {row.allocationOpen && (
                    <div className="mt-2 pl-3 border-l space-y-2">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Historical mix</span> (v1 placeholder —
                        derived proportional mix from real contributions will appear in v2).
                      </p>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label="Override allocation"
                          checked={row.overrideOn}
                          onChange={(e) => setRow(i, { overrideOn: e.target.checked })}
                        />
                        Override allocation
                      </label>

                      {row.overrideOn && (
                        <div className="space-y-1">
                          {investmentAccounts.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              No investment accounts found — add one in Accounts to enable per-account routing.
                            </p>
                          )}
                          {investmentAccounts.map((acct) => {
                            const pct = row.pcts[acct.id!] ?? 0;
                            return (
                              <div key={acct.id} className="flex items-center gap-2">
                                <label htmlFor={`alloc-${i}-${acct.id}`} className="text-xs w-32 truncate">
                                  {acct.name}
                                </label>
                                <Input
                                  id={`alloc-${i}-${acct.id}`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={pct}
                                  onChange={(e) =>
                                    setRow(i, {
                                      pcts: { ...row.pcts, [acct.id!]: Number(e.target.value) || 0 },
                                    })
                                  }
                                  aria-label={acct.name}
                                  className="w-20"
                                />
                                <span className="text-xs">%</span>
                              </div>
                            );
                          })}
                          {!allocSumOk && investmentAccounts.length > 0 && (
                            <div role="alert" className="text-xs text-red-700">
                              Allocations must sum to 100% (current: {allocTotal.toFixed(1)}%)
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft((d) => [...d, emptyRow(investmentAccountIds)])}
              aria-label="Add segment"
            >
              + Add segment
            </Button>
          </div>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
