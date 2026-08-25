import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAccountWithBalance } from '@/domain/setup-flow/steps/accounts-gate';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { DEFAULT_ACCOUNT } from '@/lib/entity-scaffolds';

const createWithAnswers = vi.fn(async () => 5);
const remove = vi.fn(async () => {});
const upsert = vi.fn(async () => 9);

beforeEach(() => {
  vi.clearAllMocks();
  useAccountsStore.setState({
    accounts: [], isLoading: false, error: null, createWithAnswers, remove, load: async () => {},
  } as never);
  useSnapshotsStore.setState({
    snapshots: [], isLoading: false, error: null, upsert, load: async () => {},
  } as never);
});

describe('accounts gate write sequence (Wave A item 2 — shared store action)', () => {
  it('delegates to createWithAnswers ONCE with the full values, then the MANUAL balance snapshot', async () => {
    const values = {
      ...DEFAULT_ACCOUNT,
      name: 'My 401k',
      // fractions at the storage boundary (AccountForm converts 50% / 6%):
      hasEmployerMatch: true, employerMatchPct: 0.5, employerMatchLimitPct: 0.06,
      allowsMegaBackdoorRollover: true,
    };
    const id = await createAccountWithBalance(values, 12500, '2026-08-09');
    expect(id).toBe(5);
    // The four collected columns ride the values — the store action persists
    // them (D-WA2); the gate no longer repairs a partial trio itself.
    expect(createWithAnswers).toHaveBeenCalledTimes(1);
    expect(createWithAnswers).toHaveBeenCalledWith(values);
    expect(upsert).toHaveBeenCalledWith({
      accountId: 5, snapshotDate: '2026-08-09', totalValue: 12500, source: 'MANUAL',
    });
    // Strictly sequenced (D-WF14): createWithAnswers → upsert
    expect(createWithAnswers.mock.invocationCallOrder[0]).toBeLessThan(
      upsert.mock.invocationCallOrder[0],
    );
  });

  it('no balance entered → NO snapshot write (skips write nothing)', async () => {
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Checking' }, null, '2026-08-09');
    expect(createWithAnswers).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('m3 parity: a snapshot failure removes the created account before rethrowing (no orphan; retry starts clean)', async () => {
    upsert.mockRejectedValueOnce(new Error('db locked'));
    await expect(
      createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'My 401k' }, 12500, '2026-08-09'),
    ).rejects.toThrow('db locked');
    expect(remove).toHaveBeenCalledWith(5);
  });
});
