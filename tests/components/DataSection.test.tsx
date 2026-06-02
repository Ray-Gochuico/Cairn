import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  validateBackupFile,
  restoreFromBackup,
  RESTORE_FAILURE_NOTICE_KEY,
} from '@/lib/backup-restore';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { DataSection } from '@/components/settings/DataSection';

const mIsTauri = isTauriRuntime as unknown as ReturnType<typeof vi.fn>;
const mRunBackup = runBackup as unknown as ReturnType<typeof vi.fn>;
const mSaveCopy = saveBackupCopy as unknown as ReturnType<typeof vi.fn>;
const mReveal = revealBackupsDir as unknown as ReturnType<typeof vi.fn>;
const mValidate = validateBackupFile as unknown as ReturnType<typeof vi.fn>;
const mRestore = restoreFromBackup as unknown as ReturnType<typeof vi.fn>;
const mOpen = openDialog as unknown as ReturnType<typeof vi.fn>;

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
  mValidate.mockResolvedValue({ ok: true, user_version: 46, max_supported_version: 46, reason: null });
  mRestore.mockResolvedValue(undefined);
  mOpen.mockResolvedValue('/Users/me/Downloads/backup.db');
});

describe('DataSection — desktop (Tauri) path', () => {
  it('renders Back up + Restore controls', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /back up now/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /save a copy/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /reveal backups/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeEnabled();
    expect(screen.queryByTestId('desktop-only-note')).not.toBeInTheDocument();
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

  it('Restore: validates → confirms → restores (file picker returns a path)', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from backup/i }));

    // The validate pre-flight runs against the picked file.
    await waitFor(() => expect(mValidate).toHaveBeenCalledWith('/Users/me/Downloads/backup.db'));
    // Destructive confirm dialog appears.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/replace all current data/i);
    // Restore has NOT been invoked yet (awaiting confirmation).
    expect(mRestore).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /replace and restore/i }));
    await waitFor(() =>
      expect(mRestore).toHaveBeenCalledWith('/Users/me/Downloads/backup.db'),
    );
  });

  it('Restore: cancelling the confirm does NOT restore', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from backup/i }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore: an invalid backup is rejected before any confirm', async () => {
    mValidate.mockResolvedValue({
      ok: false,
      user_version: 99,
      max_supported_version: 46,
      reason: 'This backup was created by a newer version of Cairn.',
    });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from backup/i }));
    expect(await screen.findByText(/newer version of cairn/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore: cancelling the file picker (null) is a no-op', async () => {
    mOpen.mockResolvedValue(null);
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from backup/i }));
    await waitFor(() => expect(mOpen).toHaveBeenCalled());
    expect(mValidate).not.toHaveBeenCalled();
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('Restore: surfaces a restore failure without crashing', async () => {
    mRestore.mockRejectedValue(new Error('copy failed'));
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /restore from backup/i }));
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
  });

  it('disables every backup/restore action in browser mode', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /back up now/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save a copy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reveal backups/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeDisabled();
  });
});
