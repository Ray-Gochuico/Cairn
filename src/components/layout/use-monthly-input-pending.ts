import { useEffect, useMemo } from 'react';
import { monthlyInputPendingFor } from '@/lib/input-pending';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

/**
 * Household-wide monthly-input pending flag for global chrome (the
 * sidebar dot). Subscribes to the accounts + snapshots stores and loads
 * them on mount — the same idempotent layout-level load pattern Sidebar
 * already uses for settings/housing/leases; store loads de-dupe in
 * flight, so this adds no extra DB round-trips on normal boots. NOTE:
 * deliberately NOT view-filtered (the Dashboard banner is) — the dot
 * means "someone in the household has input pending".
 */
export function useMonthlyInputPending(): boolean {
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);

  useEffect(() => {
    void loadAccounts();
    void loadSnapshots();
  }, [loadAccounts, loadSnapshots]);

  return useMemo(
    () => monthlyInputPendingFor(new Date(), accounts, snapshots),
    [accounts, snapshots],
  );
}
