import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAccountWithBalance } from '@/domain/setup-flow/steps/accounts-gate';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { DEFAULT_ACCOUNT } from '@/lib/entity-scaffolds';

const create = vi.fn(async () => 5);
const update = vi.fn(async () => {});
const upsert = vi.fn(async () => 9);

beforeEach(() => {
  vi.clearAllMocks();
  useAccountsStore.setState({
    accounts: [], isLoading: false, error: null, create, update, load: async () => {},
  } as never);
  useSnapshotsStore.setState({
    snapshots: [], isLoading: false, error: null, upsert, load: async () => {},
  } as never);
});

describe('accounts gate three-write sequence', () => {
  it('401k with match=yes persists ALL THREE match columns, then the MANUAL balance snapshot', async () => {
    const values = {
      ...DEFAULT_ACCOUNT,
      name: 'My 401k',
      // fractions at the storage boundary (AccountForm converts 50% / 6%):
      hasEmployerMatch: true, employerMatchPct: 0.5, employerMatchLimitPct: 0.06,
    };
    const id = await createAccountWithBalance(values, 12500, '2026-08-09');
    expect(id).toBe(5);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(5, {
      hasEmployerMatch: true, employerMatchPct: 0.5, employerMatchLimitPct: 0.06,
    });
    expect(upsert).toHaveBeenCalledWith({
      accountId: 5, snapshotDate: '2026-08-09', totalValue: 12500, source: 'MANUAL',
    });
    // Strictly sequenced (D-WF14): create → update → upsert
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0]);
  });

  it('no balance entered → NO snapshot write (skips write nothing)', async () => {
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Checking' }, null, '2026-08-09');
    expect(update).toHaveBeenCalledWith(5, {
      hasEmployerMatch: null, employerMatchPct: null, employerMatchLimitPct: null,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('m3: a mid-sequence failure removes the created account before rethrowing (no orphan; retry starts clean)', async () => {
    const remove = vi.fn(async () => {});
    useAccountsStore.setState({ remove } as never);
    update.mockRejectedValueOnce(new Error('db locked'));
    await expect(
      createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'My 401k' }, 12500, '2026-08-09'),
    ).rejects.toThrow('db locked');
    expect(remove).toHaveBeenCalledWith(5);
    expect(upsert).not.toHaveBeenCalled();
  });
});
