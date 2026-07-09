import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// The Data section now drives the REAL whole-db backup/restore via the
// `@/lib/backup-restore` helpers (which invoke Rust commands). Mock that module
// and the file-picker; the helpers themselves are unit-tested in
// tests/lib/db-backup.test.ts and the Rust commands in src-tauri.
vi.mock('@/lib/backup-restore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backup-restore')>(
    '@/lib/backup-restore',
  );
  return {
    ...actual,
    isTauriRuntime: vi.fn(() => true),
    runBackup: vi.fn(),
    saveBackupCopy: vi.fn(),
    revealBackupsDir: vi.fn(),
    listBackups: vi.fn(),
    backupsDirPath: vi.fn(),
    validateBackupFile: vi.fn(),
    restoreFromBackup: vi.fn(),
  };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import {
  isTauriRuntime,
  runBackup,
  saveBackupCopy,
  revealBackupsDir,
  listBackups,
  backupsDirPath,
  validateBackupFile,
  restoreFromBackup,
  RESTORE_FAILURE_NOTICE_KEY,
  type BackupEntry,
} from '@/lib/backup-restore';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { DataSection } from '@/components/settings/DataSection';

const mIsTauri = isTauriRuntime as unknown as ReturnType<typeof vi.fn>;
const mRunBackup = runBackup as unknown as ReturnType<typeof vi.fn>;
const mSaveCopy = saveBackupCopy as unknown as ReturnType<typeof vi.fn>;
const mReveal = revealBackupsDir as unknown as ReturnType<typeof vi.fn>;
const mList = listBackups as unknown as ReturnType<typeof vi.fn>;
const mBackupsDir = backupsDirPath as unknown as ReturnType<typeof vi.fn>;
const mValidate = validateBackupFile as unknown as ReturnType<typeof vi.fn>;
const mRestore = restoreFromBackup as unknown as ReturnType<typeof vi.fn>;
const mOpen = openDialog as unknown as ReturnType<typeof vi.fn>;

const BACKUPS_DIR = '/Users/me/Library/Application Support/com.x.cairn/backups';

function entry(name: string, takenAt: Date): BackupEntry {
  return { name, path: `${BACKUPS_DIR}/${name}`, takenAt };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <DataSection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mIsTauri.mockReturnValue(true);
  mRunBackup.mockResolvedValue('/Users/me/.../backups/cairn-20260602-100000.db');
  mSaveCopy.mockResolvedValue('/Users/me/Desktop/copy.db');
  mReveal.mockResolvedValue(undefined);
  mList.mockResolvedValue([]); // default: no backups; individual tests override
  mBackupsDir.mockResolvedValue(BACKUPS_DIR);
  mValidate.mockResolvedValue({ ok: true, user_version: 46, max_supported_version: 46, reason: null });
  mRestore.mockResolvedValue(undefined);
  mOpen.mockResolvedValue('/Users/me/Downloads/backup.db');
});

describe('DataSection — desktop (Tauri) path', () => {
  it('renders Back up + Restore controls', async () => {
    renderSection();
    expect(screen.getByRole('button', { name: /back up now/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /save a copy/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /reveal backups/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /restore from a file/i })).toBeEnabled();
    expect(screen.queryByTestId('desktop-only-note')).not.toBeInTheDocument();
    // listBackups runs on mount in Tauri mode.
    await waitFor(() => expect(mList).toHaveBeenCalled());
  });

  it('Back up now invokes runBackup and shows the destination path', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    expect(mRunBackup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/backed up to/i)).toHaveTextContent(
      /cairn-20260602-100000\.db/,
    );
  });

  it('Back up now surfaces a failure message', async () => {
    mRunBackup.mockRejectedValue(new Error('disk full'));
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    expect(await screen.findByText(/backup failed/i)).toHaveTextContent(/disk full/);
  });

  it('reloads the backup list after a successful Back up now', async () => {
    // Initially one backup; after backing up, listBackups returns two and the
    // new one appears without a manual refresh.
    mList
      .mockResolvedValueOnce([entry('cairn-20260601-090000.db', new Date(2026, 5, 1, 9, 0, 0))])
      .mockResolvedValue([
        entry('cairn-20260602-100000.db', new Date(2026, 5, 2, 10, 0, 0)),
        entry('cairn-20260601-090000.db', new Date(2026, 5, 1, 9, 0, 0)),
      ]);
    renderSection();
    // One row before.
    await waitFor(() => expect(screen.getAllByTestId('backup-row')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));

    // listBackups called again (mount + after backup), and a second row appears.
    await waitFor(() => expect(mList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId('backup-row')).toHaveLength(2));
  });

  it('each Restore names its backup and only the busy row flips (W10 T6)', async () => {
    mList.mockResolvedValue([
      entry('cairn-20260701-100000.db', new Date(2026, 6, 1, 10, 0, 0)),
      entry('cairn-20260601-100000.db', new Date(2026, 5, 1, 10, 0, 0)),
    ]);
    renderSection();
    await waitFor(() => expect(screen.getAllByTestId('backup-row')).toHaveLength(2));
    const restores = screen.getAllByRole('button', { name: /^restore backup from/i });
    expect(new Set(restores.map((b) => b.getAttribute('aria-label'))).size).toBe(2);
  });

  it('Save a copy invokes saveBackupCopy and reports the path', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /save a copy/i }));
    expect(mSaveCopy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/saved a copy to/i)).toBeInTheDocument();
  });

  it('Save a copy shows nothing extra when the user cancels (null)', async () => {
    mSaveCopy.mockResolvedValue(null);
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /save a copy/i }));
    await waitFor(() => expect(mSaveCopy).toHaveBeenCalled());
    expect(screen.queryByText(/saved a copy/i)).not.toBeInTheDocument();
  });

  it('Reveal backups calls revealBackupsDir', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /reveal backups/i }));
    expect(mReveal).toHaveBeenCalledTimes(1);
  });

  it('lists recent backups newest-first with a Restore button per row', async () => {
    mList.mockResolvedValue([
      entry('cairn-20260602-235000.db', new Date(2026, 5, 2, 23, 50, 0)),
      entry('cairn-20260601-090000.db', new Date(2026, 5, 1, 9, 0, 0)),
    ]);
    renderSection();

    const rows = await screen.findAllByTestId('backup-row');
    expect(rows).toHaveLength(2);
    // Each row carries a human-readable date and its own Restore button.
    expect(within(rows[0]).getByText(/jun 2, 2026/i)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/jun 1, 2026/i)).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: /restore/i })).toBeInTheDocument();
    // Empty-state message must NOT show when there are backups.
    expect(screen.queryByText(/no backups yet/i)).not.toBeInTheDocument();
  });

  it('does not claim "No backups yet" before the backup list resolves (round-3 S7)', async () => {
    let resolveList!: (v: BackupEntry[]) => void;
    mList.mockReturnValue(new Promise<BackupEntry[]>((r) => { resolveList = r; }));
    renderSection();
    // Still loading: the empty state must NOT render over the unresolved list.
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();
    resolveList([]);
    // Settled-empty: NOW the empty state is honest.
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
  });

  it('shows an empty state when there are no backups', async () => {
    mList.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText(/no backups yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('backup-row')).not.toBeInTheDocument();
  });

  it('Restore from list: validates that backup, confirms (naming its date), then restores', async () => {
    const taken = new Date(2026, 5, 2, 23, 50, 0);
    mList.mockResolvedValue([entry('cairn-20260602-235000.db', taken)]);
    renderSection();

    const row = await screen.findByTestId('backup-row');
    await userEvent.click(within(row).getByRole('button', { name: /restore/i }));

    // Validate runs against THAT row's path.
    await waitFor(() =>
      expect(mValidate).toHaveBeenCalledWith(`${BACKUPS_DIR}/cairn-20260602-235000.db`),
    );
    // The destructive confirm names which backup (its formatted date).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/replace all current data/i);
    expect(dialog).toHaveTextContent(/jun 2, 2026/i);
    expect(mRestore).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /replace and restore/i }));
    await waitFor(() =>
      expect(mRestore).toHaveBeenCalledWith(`${BACKUPS_DIR}/cairn-20260602-235000.db`),
    );
  });

  it('Restore from list: cancelling the confirm does NOT restore', async () => {
    mList.mockResolvedValue([entry('cairn-20260602-235000.db', new Date(2026, 5, 2, 23, 50, 0))]);
    renderSection();
    const row = await screen.findByTestId('backup-row');
    await userEvent.click(within(row).getByRole('button', { name: /restore/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore from a file: opens the picker IN the backups dir, validates → confirms → restores', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from a file/i }));

    // The picker opens defaulted into the (hidden) backups folder.
    await waitFor(() =>
      expect(mOpen).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: BACKUPS_DIR }),
      ),
    );
    // Validate runs against the picked file.
    await waitFor(() => expect(mValidate).toHaveBeenCalledWith('/Users/me/Downloads/backup.db'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/replace all current data/i);
    expect(mRestore).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /replace and restore/i }));
    await waitFor(() =>
      expect(mRestore).toHaveBeenCalledWith('/Users/me/Downloads/backup.db'),
    );
  });

  it('Restore from a file: an invalid backup is rejected before any confirm', async () => {
    mValidate.mockResolvedValue({
      ok: false,
      user_version: 99,
      max_supported_version: 46,
      reason: 'This backup was created by a newer version of Cairn.',
    });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from a file/i }));
    expect(await screen.findByText(/newer version of cairn/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore from a file: cancelling the file picker (null) is a no-op', async () => {
    mOpen.mockResolvedValue(null);
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from a file/i }));
    await waitFor(() => expect(mOpen).toHaveBeenCalled());
    expect(mValidate).not.toHaveBeenCalled();
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore: surfaces a restore failure without crashing', async () => {
    mRestore.mockRejectedValue(new Error('copy failed'));
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from a file/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /replace and restore/i }));
    expect(await screen.findByText(/restore failed/i)).toHaveTextContent(/copy failed/);
  });

  it('surfaces a post-reload restore-failure notice from sessionStorage (M-4)', async () => {
    // Simulate the prior session's forced reload having stashed a reason.
    window.sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'disk full during restore');
    renderSection();
    expect(await screen.findByText(/restore did not complete/i)).toHaveTextContent(
      /disk full during restore.*data was not changed/i,
    );
    // Read-once: the notice is cleared so a later remount won't re-show it.
    expect(window.sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBeNull();
  });
});

describe('DataSection — browser mode (no Tauri runtime)', () => {
  beforeEach(() => {
    mIsTauri.mockReturnValue(false);
  });

  it('renders without crashing and shows the desktop-only note', () => {
    renderSection();
    expect(screen.getByTestId('desktop-only-note')).toHaveTextContent(
      /available in the cairn desktop app/i,
    );
    // The list is never loaded in browser mode.
    expect(mList).not.toHaveBeenCalled();
  });

  it('disables every backup/restore action in browser mode', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /back up now/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save a copy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reveal backups/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /restore from a file/i })).toBeDisabled();
  });
});

describe('DataSection — platform-aware copy (distribution plan A3)', () => {
  // Real WebView2 UA shape — always contains "Windows NT".
  const WEBVIEW2_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

  afterEach(() => {
    // tests/setup.ts restores mocks but NOT stubbed globals.
    vi.unstubAllGlobals();
  });

  it('labels the reveal button "Reveal backups in Finder" on macOS (default UA)', async () => {
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Reveal backups in Finder' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mList).toHaveBeenCalled());
  });

  it('labels the reveal button "Reveal backups in File Explorer" on Windows', async () => {
    vi.stubGlobal('navigator', { userAgent: WEBVIEW2_UA });
    renderSection();
    expect(
      screen.getByRole('button', { name: 'Reveal backups in File Explorer' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/finder/i)).toBeNull();
    await waitFor(() => expect(mList).toHaveBeenCalled());
  });

  it('describes the data location platform-neutrally ("this computer", never "this Mac")', async () => {
    renderSection();
    expect(
      screen.getByText(/your data lives only on this computer/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/if this\s+computer is lost/i)).toBeInTheDocument();
    expect(screen.queryByText(/this mac/i)).toBeNull();
    await waitFor(() => expect(mList).toHaveBeenCalled());
  });
});
