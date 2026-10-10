import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

import { appConfigDir, join } from '@tauri-apps/api/path';
import { readDir } from '@tauri-apps/plugin-fs';
import { DataSection } from '@/components/settings/DataSection';
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
