import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// v1.8.0 H2 (code review): a refusal db_restore_check gives BEFORE the close
// reaches Settings → Data as `Restore failed: {reason}`, on the still-open
// pool: no reload, nothing stashed for a next boot, and every control usable
// again. The first test mocks restoreFromBackup; the second runs the real one
// over a mocked invoke, so the refusal comes from the check itself.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/lib/backup-restore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backup-restore')>('@/lib/backup-restore');
  return {
    ...actual,
    isTauriRuntime: vi.fn(() => true),
    listBackups: vi.fn(),
    backupsDirPath: vi.fn(),
    validateBackupFile: vi.fn(),
    restoreFromBackup: vi.fn(),
  };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { listBackups, backupsDirPath, validateBackupFile, restoreFromBackup, type BackupEntry } from '@/lib/backup-restore';
import { RESTORE_FAILURE_NOTICE_KEY } from '@/lib/boot-notices';
import { DataSection } from '@/components/settings/DataSection';

const BACKUPS_DIR = '/x/backups';
const BACKUP: BackupEntry = {
  name: 'cairn-20261001-090000.db',
  path: `${BACKUPS_DIR}/cairn-20261001-090000.db`,
  takenAt: new Date(2026, 9, 1, 9, 0, 0),
  kind: 'manual',
};
// A Rust Err(String) arrives as a plain string.
const REFUSAL =
  'db_restore: /x/finance.db-wal.restore-old from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)';
const RENDERED =
  'Restore failed: db_restore: /x/finance.db-wal.restore-old from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)';

function renderSection() {
  return render(
    <MemoryRouter>
      <DataSection />
    </MemoryRouter>,
  );
}

async function restoreTheBackup() {
  const user = userEvent.setup();
  renderSection();
  await user.click(await screen.findByRole('button', { name: /^restore backup from/i }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Replace and restore' }));
  return screen.findByText(RENDERED);
}

function expectEveryControlUsable() {
  expect(screen.getByRole('button', { name: /^restore backup from/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /^restore backup from/i })).toHaveTextContent(/^Restore$/);
  expect(screen.getByRole('button', { name: /restore from a file/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /back up now/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /save a copy/i })).toBeEnabled();
}

// window.location.reload cannot be spied on in jsdom, but window.location
// itself is configurable: each test sees a location whose reload is a mock.
const REAL_LOCATION = Object.getOwnPropertyDescriptor(window, 'location')!;
const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  vi.mocked(listBackups).mockResolvedValue([BACKUP]);
  vi.mocked(backupsDirPath).mockResolvedValue(BACKUPS_DIR);
  vi.mocked(validateBackupFile).mockResolvedValue({ ok: true, user_version: 55, max_supported_version: 55, reason: null });
});

afterEach(() => {
  Object.defineProperty(window, 'location', REAL_LOCATION);
});

describe('DataSection — a refusal before the close (v1.8.0 H2, CX-H2-3)', () => {
  it('shows the exact refusal, reloads nothing, stashes nothing and re-enables every control', async () => {
    vi.mocked(restoreFromBackup).mockRejectedValue(REFUSAL);
    const line = await restoreTheBackup();
    expect(line).toHaveAttribute('role', 'alert');
    expect(line.textContent).toBe(RENDERED);
    expect(restoreFromBackup).toHaveBeenCalledTimes(1);
    expect(restoreFromBackup).toHaveBeenCalledWith(BACKUP.path);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBeNull();
    expectEveryControlUsable();
  });

  it('through the real restoreFromBackup: the check refuses, so the pool is never closed and db_restore never runs', async () => {
    const actual = await vi.importActual<typeof import('@/lib/backup-restore')>('@/lib/backup-restore');
    vi.mocked(restoreFromBackup).mockImplementation((source, opts) => actual.restoreFromBackup(source, opts));
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === 'db_restore_check') throw REFUSAL;
      return undefined;
    });
    const line = await restoreTheBackup();
    expect(line.textContent).toBe(RENDERED);
    expect(calls).toEqual(['db_restore_check']);
    expect(invoke).toHaveBeenCalledWith('db_restore_check', { db: 'sqlite:finance.db', source: BACKUP.path });
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBeNull();
    expectEveryControlUsable();
  });
});
