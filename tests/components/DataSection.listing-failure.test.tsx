import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// v1.8.0 H3 (L26, D-H3-2): Settings → Data over the REAL listBackups. An
// unreadable backups folder now reaches DataSection's existing note; a
// folder that does not exist yet is still "no backups".
vi.mock('@/lib/tauri-runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { readDir } from '@tauri-apps/plugin-fs';
import { DataSection } from '@/components/settings/DataSection';
import { RESTORE_FAILURE_NOTICE_KEY } from '@/lib/boot-notices';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

const BASE = '/Users/me/Library/Application Support/com.raymondgochuico.cairn';
const DIR = `${BASE}/backups`;
const readDirRejection = (ioError: string) => `failed to read directory at path: ${DIR} with error: ${ioError}`;

function renderSection() {
  return render(
    <MemoryRouter>
      <DataSection />
    </MemoryRouter>,
  );
}

describe('DataSection × listBackups (v1.8.0 H3, L26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    vi.mocked(appConfigDir).mockResolvedValue(BASE);
    vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('an unreadable backups folder shows the existing "Could not read your backups" note with the reason', async () => {
    const reason = readDirRejection('Permission denied (os error 13)');
    vi.mocked(readDir).mockRejectedValue(reason);
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(`Could not read your backups: ${reason}`);
  });

  it('a folder that does not exist yet: no note, the "No backups yet" empty state as before', async () => {
    vi.mocked(readDir).mockRejectedValue(readDirRejection('No such file or directory (os error 2)'));
    renderSection();
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// v1.8.0 H3, chip (a) (coordinator ruling D-H3-2): the two Settings residuals
// of an unreadable folder. No string is added or changed: an existing one is
// hidden, and an existing notice is kept.
describe('DataSection × a listing failure (v1.8.0 H3, chip (a))', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    vi.mocked(appConfigDir).mockResolvedValue(BASE);
    vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('the "No backups yet" empty state does not render beside the "Could not read your backups" note', async () => {
    const reason = readDirRejection('Permission denied (os error 13)');
    vi.mocked(readDir).mockRejectedValue(reason);
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(`Could not read your backups: ${reason}`);
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();
  });

  it('a listing failure never replaces the one-time restore-failure notice the mount showed', async () => {
    window.sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'disk full during restore');
    const notice = 'Restore did not complete: disk full during restore. Your data was not changed.';
    let rejectListing!: (reason: unknown) => void;
    vi.mocked(readDir).mockReturnValue(new Promise<never>((_, reject) => { rejectListing = reject; }));
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toBe(notice);
    await vi.waitFor(() => expect(readDir).toHaveBeenCalledWith(DIR));
    // The listing rejects only now, after the notice is on screen (as on a
    // real mount); a macrotask lets the rejection reach refreshBackups' catch.
    await act(async () => {
      rejectListing(readDirRejection('Permission denied (os error 13)'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByRole('alert').textContent).toBe(notice);
    expect(screen.queryByText(/Could not read your backups/)).not.toBeInTheDocument();
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();      // the list is still unknown
  });

  it('the empty state comes back once a later listing succeeds empty: it is hidden only while the list could not be read', async () => {
    vi.mocked(readDir)
      .mockRejectedValueOnce(readDirRejection('Permission denied (os error 13)'))   // the mount's listing
      .mockResolvedValue([]);                                                      // the rotation and the listing after the backup
    vi.mocked(invoke).mockResolvedValue(undefined);                                // db_backup
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read your backups: ');
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
