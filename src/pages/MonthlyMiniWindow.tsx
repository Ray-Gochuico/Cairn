import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLoadGate } from '@/lib/use-load-gate';
import { useLocalToday } from '@/lib/use-local-today';
import { localTodayISO, dateFromLocalISO } from '@/lib/dates';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { useLoanPaymentsStore } from '@/stores/loan-payments-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { AccountType, SnapshotSource } from '@/types/enums';
import { lastBusinessDayOfMonth } from '@/lib/business-days';
import { lastMonthYyyymm } from '@/lib/input-pending';
import { LoansRepo } from '@/domain/loans';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { getDatabase } from '@/db/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import type {
  Account,
  AccountSnapshot,
  Loan,
  Property,
  Vehicle,
} from '@/types/schema';
import type { ScheduleEntry } from '@/lib/amortization';

/**
 * MonthlyMiniWindow — the three-minute month-end ritual.
 *
 * Composition: each section pulls its data straight from the corresponding
 * store, computes what needs confirming, and renders one Card per step.
 * Cards are self-contained: a tri-mode local state (`pending` | `confirmed`
 * | `skipped`) keeps the UI calm, errors render inline next to the action
 * row, and the underlying store load() runs after every write so re-derived
 * snapshots reflect immediately.
 *
 * Why these four sections and no more:
 *   1. **Derived account values** — the headline ritual. AUTO_DERIVED
 *      snapshots from the price cache need user ratification; "Confirm"
 *      flips the source to USER_CONFIRMED at the same date/value.
 *   2. **Loan payments** — amortization-projected entries that, once
 *      confirmed, both insert a LoanPayment row and decrement the loan's
 *      current_balance so subsequent net-worth calculations move forward.
 *   3. **Cash account balances** — CASH/SAVINGS aren't ticker-derivable,
 *      so the user enters today's balance directly (source = MANUAL).
 *   4. **Property/vehicle values** — purely optional nudges; the user
 *      typically updates these quarterly. Always rendered so users can
 *      drop in a new value when they have one.
 */

type CardMode = 'pending' | 'confirmed' | 'skipped';

const MANUAL_BALANCE_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
  AccountType.ACCOUNT_CRYPTO,
]);

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Signed month-over-month change against a prior snapshot value. The percent is
 * suppressed when the prior is near zero (the house percent-honesty guard used
 * on Dashboard/NetWorth) — a % change off ~$0 is noise. Returns e.g.
 * "was $10,000 (+23.5%)" or "was $0" when the base is too small to divide by.
 */
function formatPriorContext(current: number, prior: number): string {
  const base = `was ${formatUSD(prior)}`;
  if (Math.abs(prior) < 0.005) return base;
  const pct = ((current - prior) / prior) * 100;
  const sign = pct >= 0 ? '+' : '−';
  return `${base} (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

// Save-time "today" from LOCAL parts (Wave 11 T10) — a snapshot stamped by
// the user's calendar day, not UTC.
function todayISO(): string {
  return localTodayISO();
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Card 1: derived account value confirmation
// ---------------------------------------------------------------------------

interface DerivedValueCardProps {
  account: Account;
  snapshot: AccountSnapshot;
  // W10 T11: skip is LIFTED to the parent so "Confirm all" can exclude Skipped
  // cards (child-local skip left them in the ratified batch).
  isSkipped: boolean;
  onSkip: (accountId: number) => void;
  // T25: the account's most recent value BEFORE this close, so the confirm card
  // gives the reviewer a "was $X (±Y%)" anchor for the number they're ratifying.
  priorValue?: number | null;
}

function DerivedValueCard({ account, snapshot, isSkipped, onSkip, priorValue }: DerivedValueCardProps) {
  const upsertSnapshot = useSnapshotsStore((s) => s.upsert);
  // Local state covers the optimistic in-card confirm; the PROP wins whenever
  // the underlying snapshot is already ratified — so a parent-level "Confirm
  // all" (or a confirmation from another session) flips this card without a
  // remount.
  const [localMode, setLocalMode] = useState<CardMode>('pending');
  const sourceConfirmed =
    snapshot.source === SnapshotSource.USER_CONFIRMED ||
    snapshot.source === SnapshotSource.MANUAL;
  const mode: CardMode = sourceConfirmed ? 'confirmed' : isSkipped ? 'skipped' : localMode;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(String(snapshot.totalValue));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // W10 T6: confirming unmounts the focused button; move focus to the
  // pre-mounted status region so it never strands on <body>.
  const statusRef = useRef<HTMLSpanElement>(null);

  const confirm = async (value: number) => {
    setBusy(true);
    setError(null);
    try {
      await upsertSnapshot({
        accountId: snapshot.accountId,
        snapshotDate: snapshot.snapshotDate,
        totalValue: value,
        source: SnapshotSource.USER_CONFIRMED,
      });
      setLocalMode('confirmed');
      setEditing(false);
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          {/* T25: the value-to-verify LEADS — the reviewer's eye lands on the
              number they're ratifying, then its context (which account, as of
              when), then last month's value for a sanity anchor. */}
          <div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="derived-value">
              {formatUSD(snapshot.totalValue)}
            </div>
            <div className="text-sm text-muted-foreground">
              {account.name} · as of {formatDate(snapshot.snapshotDate)}
            </div>
            {priorValue != null && (
              <div className="text-xs text-muted-foreground tabular-nums" data-testid="derived-prior">
                {formatPriorContext(snapshot.totalValue, priorValue)}
              </div>
            )}
          </div>
          {/* Pre-mounted empty (Wave-5 a11y fix): a live region that only
              appears once populated never fires the polite announcement on
              most SR/browser pairs — it has nothing to diff against. Mount
              the node from the start and let the TEXT be the conditional
              part. The confirmed state is a pill INSIDE this region so the
              announcement semantics are preserved. */}
          <span ref={statusRef} role="status" tabIndex={-1} className="outline-none">
            {mode === 'confirmed' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-foreground">
                ✓ Confirmed
              </span>
            )}
          </span>
          {mode === 'skipped' && (
            <span className="text-sm text-muted-foreground">Skipped</span>
          )}
        </div>

        {mode === 'pending' && editing && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              aria-label={`override value for ${account.name}`}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="max-w-[200px]"
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const n = Number(editValue);
                if (Number.isNaN(n)) {
                  setError('Enter a number');
                  return;
                }
                confirm(n);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        )}

        {mode === 'pending' && !editing && (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => confirm(snapshot.totalValue)}>
              Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => account.id != null && onSkip(account.id)}>
              Skip
            </Button>
          </div>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive-soft-foreground">{error}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 2: loan payment confirmation
// ---------------------------------------------------------------------------

interface LoanPaymentCardProps {
  loan: Loan;
  nextEntry: ScheduleEntry;
  /** Wave-9 M37: an AMORTIZATION row for nextEntry.paymentDate already exists. */
  alreadyRecorded: boolean;
}

function LoanPaymentCard({ loan, nextEntry, alreadyRecorded }: LoanPaymentCardProps) {
  const createLoanPayment = useLoanPaymentsStore((s) => s.create);
  const updateLoan = useLoansStore((s) => s.update);
  const [mode, setMode] = useState<CardMode>(alreadyRecorded ? 'confirmed' : 'pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPaid = nextEntry.principal + nextEntry.extra + nextEntry.interest;
  const balanceReduction = nextEntry.principal + nextEntry.extra;

  const confirm = async () => {
    if (!loan.id) return;
    setBusy(true);
    setError(null);
    try {
      await createLoanPayment({
        loanId: loan.id,
        paymentDate: nextEntry.paymentDate,
        principal: nextEntry.principal,
        interest: nextEntry.interest,
        extra: nextEntry.extra,
        source: 'AMORTIZATION',
      });
      // Decrement the loan balance so subsequent projectedSchedule calls
      // start from the post-payment balance. Floor at 0 to avoid going
      // negative if amortization rounding overshoots on the last payment.
      const newBalance = Math.max(0, loan.currentBalance - balanceReduction);
      await updateLoan(loan.id, { currentBalance: newBalance });
      setMode('confirmed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      // Wave-9 M37: the 0049 partial UNIQUE index turns a race/double-click
      // into a constraint violation. The insert runs BEFORE the balance
      // update, so a rejected duplicate never decrements the balance.
      setError(
        /unique/i.test(msg)
          ? `A payment for ${nextEntry.paymentDate} is already recorded — duplicate skipped, balance unchanged.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{loan.name}</div>
            <div className="text-sm text-muted-foreground">
              Next scheduled payment: {formatUSD(totalPaid)} on{' '}
              {nextEntry.paymentDate}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Principal {formatUSD(nextEntry.principal)} · Interest{' '}
              {formatUSD(nextEntry.interest)}
              {nextEntry.extra > 0 ? ` · Extra ${formatUSD(nextEntry.extra)}` : ''}
            </div>
          </div>
          {/* Pre-mounted empty (Wave-5 a11y fix) — see DerivedValueCard. */}
          <span
            role="status"
            className={
              mode === 'confirmed'
                ? 'text-sm font-medium text-success-foreground'
                : undefined
            }
          >
            {mode === 'confirmed' && 'Recorded'}
          </span>
          {mode === 'skipped' && (
            <span className="text-sm text-muted-foreground">Skipped</span>
          )}
        </div>

        {mode === 'confirmed' && alreadyRecorded && (
          <div className="text-sm text-muted-foreground">
            Already recorded for {nextEntry.paymentDate}.
          </div>
        )}

        {mode === 'pending' && (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={confirm}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('skipped')}>
              Skip
            </Button>
          </div>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive-soft-foreground">{error}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 3: cash balance entry
// ---------------------------------------------------------------------------

interface CashBalanceCardProps {
  account: Account;
  latestBalance: number | null;
}

function CashBalanceCard({ account, latestBalance }: CashBalanceCardProps) {
  const upsertSnapshot = useSnapshotsStore((s) => s.upsert);
  const [mode, setMode] = useState<CardMode>('pending');
  const [value, setValue] = useState<string>(
    latestBalance != null ? String(latestBalance) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(value);
    if (value === '' || Number.isNaN(n)) {
      setError('Enter a number');
      return;
    }
    if (!account.id) return;
    setBusy(true);
    setError(null);
    try {
      await upsertSnapshot({
        accountId: account.id,
        snapshotDate: todayISO(),
        totalValue: n,
        source: SnapshotSource.MANUAL,
      });
      setMode('confirmed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{account.name}</div>
            <div className="text-sm text-muted-foreground">
              What's the balance as of today?
              {latestBalance != null && (
                <span className="ml-1">
                  (Last entered: {formatUSD(latestBalance)})
                </span>
              )}
            </div>
          </div>
          {/* Pre-mounted empty (Wave-5 a11y fix) — see DerivedValueCard. */}
          <span
            role="status"
            className={
              mode === 'confirmed'
                ? 'text-sm font-medium text-success-foreground'
                : undefined
            }
          >
            {mode === 'confirmed' && 'Saved'}
          </span>
          {mode === 'skipped' && (
            <span className="text-sm text-muted-foreground">Skipped</span>
          )}
        </div>

        {mode === 'pending' && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              aria-label={`balance for ${account.name}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
              className="max-w-[200px]"
            />
            <Button size="sm" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('skipped')}>
              Skip
            </Button>
          </div>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive-soft-foreground">{error}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 4: property / vehicle value nudge
// ---------------------------------------------------------------------------

interface AssetValueCardProps {
  name: string;
  currentValue: number | null;
  kind: 'property' | 'vehicle';
  onSave: (next: number) => Promise<void>;
}

function AssetValueCard({ name, currentValue, kind, onSave }: AssetValueCardProps) {
  const [mode, setMode] = useState<CardMode>('pending');
  const [value, setValue] = useState<string>(
    currentValue != null ? String(currentValue) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(value);
    if (value === '' || Number.isNaN(n)) {
      setError('Enter a number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(n);
      setMode('confirmed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{name}</div>
            <div className="text-sm text-muted-foreground">
              Current {kind} value
              {currentValue != null && (
                <span className="ml-1">({formatUSD(currentValue)})</span>
              )}
              . Update if it changed — optional.
            </div>
          </div>
          {/* Pre-mounted empty (Wave-5 a11y fix) — see DerivedValueCard. */}
          <span
            role="status"
            className={
              mode === 'confirmed'
                ? 'text-sm font-medium text-success-foreground'
                : undefined
            }
          >
            {mode === 'confirmed' && 'Updated'}
          </span>
          {mode === 'skipped' && (
            <span className="text-sm text-muted-foreground">Skipped</span>
          )}
        </div>

        {mode === 'pending' && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              aria-label={`value for ${name}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
              className="max-w-[200px]"
            />
            <Button size="sm" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('skipped')}>
              Skip
            </Button>
          </div>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive-soft-foreground">{error}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MonthlyMiniWindow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromNewMonth = searchParams.get('from') === 'new-month';

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);
  const snapshotsLoading = useSnapshotsStore((s) => s.isLoading);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);
  const loansLoading = useLoansStore((s) => s.isLoading);

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const updateProperty = usePropertiesStore((s) => s.update);
  const propertiesError = usePropertiesStore((s) => s.error);
  const propertiesLoading = usePropertiesStore((s) => s.isLoading);

  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const updateVehicle = useVehiclesStore((s) => s.update);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const vehiclesLoading = useVehiclesStore((s) => s.isLoading);

  const reload = useCallback(() => {
    loadAccounts();
    loadSnapshots();
    loadLoans();
    loadProperties();
    loadVehicles();
  }, [loadAccounts, loadSnapshots, loadLoans, loadProperties, loadVehicles]);

  // W10 M38: telling a user their monthly ritual is DONE ("Nothing to confirm
  // this month.") before the five loads settle is the worst false-empty
  // instance — gate the whole ritual on load settlement. loan-payments is a
  // parameterized non-factory store consumed only on the write path, so it's
  // not part of the gate.
  const gate = useLoadGate(
    [accountsLoading, snapshotsLoading, loansLoading, propertiesLoading, vehiclesLoading],
    [accountsError, snapshotsError, loansError, propertiesError, vehiclesError],
    reload,
  );

  const todayLocalISO = useLocalToday();
  const today = useMemo(() => dateFromLocalISO(todayLocalISO), [todayLocalISO]);
  const lastMonth = useMemo(() => lastMonthYyyymm(today), [today]);
  const lastMonthClose = useMemo(
    () => lastBusinessDayOfMonth(lastMonth),
    [lastMonth],
  );

  // --- Section 1: derived value cards ----------------------------------------

  /**
   * Only show cards for accounts that already have an AUTO_DERIVED snapshot
   * for last month's close. If derivation hasn't run yet (no snapshot), we
   * have nothing to ratify — skip the card rather than fabricate a zero.
   */
  const derivedCards = useMemo(() => {
    return accounts
      .filter((a) => a.id !== undefined)
      .filter((a) => !MANUAL_BALANCE_TYPES.has(a.type))
      .filter((a) => !a.excludedFromNetWorth)
      .flatMap((account) => {
        const snap = snapshots.find(
          (s) =>
            s.accountId === account.id &&
            s.snapshotDate === lastMonthClose,
        );
        if (!snap) return [];
        // T25: the latest value strictly BEFORE this close — the prior-month
        // anchor. Sourced from the snapshots the page already loads (no store).
        const prior = snapshots
          .filter((s) => s.accountId === account.id && s.snapshotDate < lastMonthClose)
          .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
        const priorValue: number | null = prior?.totalValue ?? null;
        // Show the card regardless of source. Pending cards drive the
        // banner; confirmed cards stay visible with a checkmark so the
        // user sees their progress through the ritual.
        return [{ account, snapshot: snap, priorValue }];
      });
  }, [accounts, snapshots, lastMonthClose]);

  // --- "Confirm all" batch over the derived cards -----------------------------

  const upsertSnapshot = useSnapshotsStore((s) => s.upsert);
  // W10 T11: skip is parent state so "Confirm all" can EXCLUDE explicitly
  // Skipped cards (they used to be ratified anyway).
  const [skippedIds, setSkippedIds] = useState<ReadonlySet<number>>(new Set());
  const onSkip = useCallback((accountId: number) => {
    setSkippedIds((prev) => new Set(prev).add(accountId));
  }, []);
  const pendingDerived = useMemo(
    () => derivedCards.filter(
      ({ snapshot }) =>
        snapshot.source === SnapshotSource.AUTO_DERIVED && !skippedIds.has(snapshot.accountId),
    ),
    [derivedCards, skippedIds],
  );
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmAllResult, setConfirmAllResult] = useState<string | null>(null);

  const confirmAll = async () => {
    setConfirmingAll(true);
    setConfirmAllResult(null);
    let ok = 0;
    let failed = 0;
    // Sequential on purpose: mirrors the per-card single-writer flow and
    // keeps sqlite happy; N is small (a household's account count). A
    // concurrent per-card confirm double-writes the same (accountId,
    // snapshotDate) row, which the store's upsert makes idempotent — so
    // per-card busy flags are intentionally not lifted.
    for (const { snapshot } of pendingDerived) {
      try {
        await upsertSnapshot({
          accountId: snapshot.accountId,
          snapshotDate: snapshot.snapshotDate,
          totalValue: snapshot.totalValue,
          source: SnapshotSource.USER_CONFIRMED,
        });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setConfirmAllResult(
      failed === 0
        ? `Confirmed ${ok} account value${ok === 1 ? '' : 's'}.`
        : `Confirmed ${ok}, ${failed} failed — use the per-card buttons to retry.`,
    );
    setConfirmingAll(false);
  };

  // --- Section 2: loan payment cards -----------------------------------------

  const [loanSchedules, setLoanSchedules] = useState<
    Map<number, { entry: ScheduleEntry; alreadyRecorded: boolean } | null>
  >(new Map());

  useEffect(() => {
    // Schedules are per-loan computations not exposed on the loans store
    // (see loans-store.ts header comment); pull the first projected entry
    // directly from LoansRepo. Re-runs whenever the loans list changes so
    // a "Confirm" that decrements balance shifts the next-payment forward.
    let cancelled = false;
    const repo = new LoansRepo(getDatabase());
    const paymentsRepo = new LoanPaymentsRepo(getDatabase());
    Promise.all(
      loans
        .filter((l): l is Loan & { id: number } => l.id !== undefined)
        .map(async (l) => {
          try {
            const schedule = await repo.projectedSchedule(l.id, todayISO());
            const entry = schedule[0] ?? null;
            if (!entry) return [l.id, null] as const;
            // Wave-9 M37: a Confirm earlier this month already wrote this
            // row — surface the card as recorded instead of re-offering it.
            const payments = await paymentsRepo.listForLoan(l.id);
            const alreadyRecorded = payments.some(
              (p) => p.paymentDate === entry.paymentDate && p.source === 'AMORTIZATION',
            );
            return [l.id, { entry, alreadyRecorded }] as const;
          } catch {
            return [l.id, null] as const;
          }
        }),
    ).then((entries) => {
      if (cancelled) return;
      setLoanSchedules(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [loans]);

  const loanCards = useMemo(() => {
    return loans
      .filter((l): l is Loan & { id: number } => l.id !== undefined)
      .map((loan) => {
        const projected = loanSchedules.get(loan.id) ?? null;
        return {
          loan,
          nextEntry: projected?.entry ?? null,
          alreadyRecorded: projected?.alreadyRecorded ?? false,
        };
      })
      .filter(
        (
          x,
        ): x is {
          loan: Loan & { id: number };
          nextEntry: ScheduleEntry;
          alreadyRecorded: boolean;
        } => x.nextEntry !== null,
      );
  }, [loans, loanSchedules]);

  // --- Section 3: cash balance cards -----------------------------------------

  const cashCards = useMemo(() => {
    return accounts
      .filter((a) => a.id !== undefined)
      .filter(
        (a) =>
          a.type === AccountType.ACCOUNT_CASH ||
          a.type === AccountType.ACCOUNT_SAVINGS,
      )
      .filter((a) => !a.excludedFromNetWorth)
      .map((account) => {
        const latest = snapshots
          .filter((s) => s.accountId === account.id)
          .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
        return {
          account,
          latestBalance: latest ? latest.totalValue : null,
        };
      });
  }, [accounts, snapshots]);

  // --- Section 4: property + vehicle cards -----------------------------------

  // Phase 2 simplification: render all non-excluded property/vehicle entries
  // as optional nudges. The plan's >90-day-stale check needs `updated_at`,
  // which isn't on the domain type — labeled "optional" so users feel free
  // to skip rather than feeling obligated.
  const assetCards = useMemo(() => {
    const props = properties
      .filter((p): p is Property & { id: number } => p.id !== undefined)
      .filter((p) => !p.excludedFromNetWorth)
      .map((p) => ({ kind: 'property' as const, entity: p }));
    const vehs = vehicles
      .filter((v): v is Vehicle & { id: number } => v.id !== undefined)
      .filter((v) => !v.excludedFromNetWorth)
      .map((v) => ({ kind: 'vehicle' as const, entity: v }));
    return [...props, ...vehs];
  }, [properties, vehicles]);

  const nothingToDo =
    derivedCards.length === 0 &&
    loanCards.length === 0 &&
    cashCards.length === 0 &&
    assetCards.length === 0;

  // W10 M38: never fake a completed ritual while stores load.
  if (!gate.settled) {
    return (
      <PageContainer width="prose" className="space-y-6">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="prose" className="space-y-6">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div>
        {fromNewMonth && (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            It's a new month — here's this month's check-in
          </p>
        )}
        <h1 className="text-2xl font-semibold">Monthly check-in</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {monthLabel(lastMonth)} close · {today.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>

      {nothingToDo ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <div className="text-muted-foreground">
              Nothing to confirm this month.
            </div>
            <Button onClick={() => navigate('/')}>Back to Dashboard</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {derivedCards.length > 0 && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <SectionTitle
                  title="Confirm last month's values"
                  description="Review the auto-derived end-of-month total for each account. Edit if Yahoo's number looks off."
                />
                {pendingDerived.length > 0 && (
                  <Button size="sm" variant="outline" disabled={confirmingAll} onClick={confirmAll}>
                    {confirmingAll
                      ? 'Confirming…'
                      : `Confirm all (${pendingDerived.length})`}
                  </Button>
                )}
              </div>
              {/* Pre-mounted empty (Wave-5 a11y fix): mounting this <p> only
                  once confirmAllResult is set means the live region appears
                  already-filled, so the polite announcement never fires on
                  most SR/browser pairs (same bug as the per-card statuses
                  above). Mount it for the section's whole lifetime and let
                  the text be the conditional part. */}
              <p role="status" className="text-sm text-muted-foreground">
                {confirmAllResult}
              </p>
              {derivedCards.map(({ account, snapshot, priorValue }) => (
                <DerivedValueCard
                  key={account.id}
                  account={account}
                  snapshot={snapshot}
                  isSkipped={account.id != null && skippedIds.has(account.id)}
                  onSkip={onSkip}
                  priorValue={priorValue}
                />
              ))}
            </section>
          )}

          {loanCards.length > 0 && (
            <section className="space-y-2">
              <SectionTitle
                title="Record loan payments"
                description="Each entry follows the loan's amortization schedule. Confirm posts the payment and decrements the balance."
              />
              {loanCards.map(({ loan, nextEntry, alreadyRecorded }) => (
                <LoanPaymentCard
                  key={loan.id}
                  loan={loan}
                  nextEntry={nextEntry}
                  alreadyRecorded={alreadyRecorded}
                />
              ))}
            </section>
          )}

          {cashCards.length > 0 && (
            <section className="space-y-2">
              <SectionTitle
                title="Update cash balances"
                description="Cash and savings balances are entered by hand — there's no ticker to derive from."
              />
              {cashCards.map(({ account, latestBalance }) => (
                <CashBalanceCard
                  key={account.id}
                  account={account}
                  latestBalance={latestBalance}
                />
              ))}
            </section>
          )}

          {assetCards.length > 0 && (
            <section className="space-y-2">
              <SectionTitle
                title="Optional: property & vehicle values"
                description="Update only when the value actually changed — most people refresh these quarterly."
              />
              {assetCards.map(({ kind, entity }) =>
                kind === 'property' ? (
                  <AssetValueCard
                    key={`p-${entity.id}`}
                    name={entity.name}
                    currentValue={entity.currentEstimatedValue}
                    kind="property"
                    onSave={(next) =>
                      updateProperty(entity.id!, { currentEstimatedValue: next })
                    }
                  />
                ) : (
                  <AssetValueCard
                    key={`v-${entity.id}`}
                    name={entity.name}
                    currentValue={entity.currentEstimatedValue}
                    kind="vehicle"
                    onSave={(next) =>
                      updateVehicle(entity.id!, { currentEstimatedValue: next })
                    }
                  />
                ),
              )}
            </section>
          )}

          <div className="flex justify-end pt-4">
            <Button onClick={() => navigate('/')} size="lg">
              All done
            </Button>
          </div>
        </>
      )}
    </PageContainer>
  );
}

interface SectionTitleProps {
  title: string;
  description: string;
}

function SectionTitle({ title, description }: SectionTitleProps) {
  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
    </Card>
  );
}
