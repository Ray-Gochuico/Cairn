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
import { revealItemInDir } from '@tauri-apps/plugin-opener';
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

// v1.8.0 H3, chip (a) (coordinator ruling D-H3-2) and its review fix: the
// listing note has its own line, kept until a listing succeeds, so no other
// message hides it and it never hides or replaces the one-time
// restore-failure notice. No string is added or changed: an existing one is
// hidden, and the existing notices are kept.
describe('DataSection × a listing failure (v1.8.0 H3, chip (a))', () => {
  const UNREADABLE = readDirRejection('Permission denied (os error 13)');
  const NOTE = `Could not read your backups: ${UNREADABLE}`;
  const alerts = () => screen.queryAllByRole('alert').map((a) => a.textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    vi.mocked(appConfigDir).mockResolvedValue(BASE);
    vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('the "No backups yet" empty state does not render beside the "Could not read your backups" note', async () => {
    vi.mocked(readDir).mockRejectedValue(UNREADABLE);
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(NOTE);
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();
  });

  it('a listing failure never replaces or hides the one-time restore-failure notice the mount showed: each keeps its own line', async () => {
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
      rejectListing(UNREADABLE);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(alerts()).toEqual([NOTE, notice]);                                     // the Restore area's note, then the section's line
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();      // the list is still unknown
  });

  it('the note stays when another action clears the section\'s message line, so the Restore area keeps saying why it is empty', async () => {
    vi.mocked(readDir).mockRejectedValue(UNREADABLE);
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toBe(NOTE);
    await userEvent.click(screen.getByRole('button', { name: /reveal backups/i }));   // its handler clears the section's message line
    expect(revealItemInDir).toHaveBeenCalledWith(DIR);
    expect(alerts()).toEqual([NOTE]);
    expect(screen.queryByText('No backups yet')).not.toBeInTheDocument();
  });

  it('the empty state comes back once a later listing succeeds empty, and the note goes with the failure', async () => {
    vi.mocked(readDir)
      .mockRejectedValueOnce(UNREADABLE)                                           // the mount's listing
      .mockResolvedValue([]);                                                      // the rotation and the listing after the backup
    vi.mocked(invoke).mockResolvedValue(undefined);                                // db_backup
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toBe(NOTE);
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    expect(await screen.findByText('No backups yet')).toBeInTheDocument();
    expect(alerts()).toEqual([]);
  });

  it('a listing failure leaves an already-loaded list visible, with the note beside it', async () => {
    const manual = { name: 'cairn-20260924-120000.db', isFile: true, isDirectory: false, isSymlink: false };
    vi.mocked(readDir)
      .mockResolvedValueOnce([manual])                                             // the mount's listing
      .mockResolvedValueOnce([manual])                                             // the backup's rotation
      .mockRejectedValue(UNREADABLE);                                              // the listing after the backup
    vi.mocked(invoke).mockResolvedValue(undefined);                                // db_backup
    renderSection();
    expect(await screen.findAllByTestId('backup-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read your backups: ');
    expect(screen.getAllByTestId('backup-row')).toHaveLength(1);
  });
});
