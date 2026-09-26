import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));

import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import type { CsvColumn } from '@/lib/csv';

interface Row {
  name: string;
}
const columns: CsvColumn<Row>[] = [{ header: 'name', value: (r) => r.name }];

describe('ExportCsvButton', () => {
  it('renders an "Export CSV" button by default', () => {
    render(
      <MemoryRouter>
        <ExportCsvButton baseName="things" columns={columns} rows={[{ name: 'A' }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
  });

  it('renders a custom label when given one', () => {
    render(
      <MemoryRouter>
        <ExportCsvButton
          baseName="things"
          columns={columns}
          rows={[{ name: 'A' }]}
          label="Download data"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Download data' })).toBeInTheDocument();
  });

  it('is disabled when there are no rows', () => {
    render(
      <MemoryRouter>
        <ExportCsvButton baseName="things" columns={columns} rows={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
  });

  it('C24 (Wave A D5): householdScopeNote renders the uniform disclosure (title + sr-only, aria-describedby)', () => {
    render(
      <MemoryRouter>
        <ExportCsvButton baseName="x" columns={columns} rows={[{ name: 'A' }]} householdScopeNote />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: 'Export CSV' });
    expect(btn).toHaveAttribute(
      'title',
      "Exports all household rows — the person view doesn't change what's exported.",
    );
    const noteId = btn.getAttribute('aria-describedby');
    expect(noteId).toBeTruthy();
    expect(document.getElementById(noteId!)).toHaveTextContent(/Exports all household rows/);
  });

  it('no note without the prop (regression)', () => {
    render(
      <MemoryRouter>
        <ExportCsvButton baseName="x" columns={columns} rows={[{ name: 'A' }]} />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: 'Export CSV' });
    expect(btn).not.toHaveAttribute('title');
    expect(btn).not.toHaveAttribute('aria-describedby');
  });

  it('on click downloads a CSV named <baseName>-<date>.csv with the serialized rows', async () => {
    let capturedText = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => {
        capturedText = t;
      });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let downloadName = '';
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });

    render(
      <MemoryRouter>
        <ExportCsvButton
          baseName="things"
          columns={columns}
          rows={[{ name: 'A' }, { name: 'B' }]}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    // downloadCsv is async now (W19: runtime-aware save); wait for the
    // browser-branch anchor click and blob capture to settle.
    await vi.waitFor(() => {
      expect(downloadName).toMatch(/^things-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(capturedText).toBe('name\nA\nB');
    });

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  describe('Tauri write-failure surfacing (W19 review)', () => {
    beforeEach(() => {
      // isTauriRuntime() probes exactly this marker.
      (window as any).__TAURI_INTERNALS__ = {};
      vi.mocked(save).mockReset();
      vi.mocked(writeFile).mockReset();
    });
    afterEach(() => {
      delete (window as any).__TAURI_INTERNALS__;
    });

    function renderButton() {
      render(
        <MemoryRouter>
          <ExportCsvButton baseName="things" columns={columns} rows={[{ name: 'A' }]} />
        </MemoryRouter>,
      );
    }

    it('surfaces an inline error when the write fails after a destination was chosen', async () => {
      vi.mocked(save).mockResolvedValue('/Volumes/ReadOnly/things.csv');
      vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'));
      renderButton();
      await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

      // The user picked a path, so silence would read as success.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/couldn't save the file/i);
    });

    it('clears the error on a subsequent successful export', async () => {
      vi.mocked(save).mockResolvedValue('/Volumes/ReadOnly/things.csv');
      vi.mocked(writeFile)
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce(undefined as never);
      renderButton();
      const button = screen.getByRole('button', { name: /export csv/i });
      await userEvent.click(button);
      await screen.findByRole('alert');
      await userEvent.click(button);
      await vi.waitFor(() => {
        expect(screen.queryByRole('alert')).toBeNull();
      });
    });

    it('shows no error when the user cancels the save dialog', async () => {
      vi.mocked(save).mockResolvedValue(null);
      renderButton();
      await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    });
  });
});

describe('v1.8.0 A-2′: the CSV filename carries the LOCAL calendar day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  let downloadName = '';
  let restores: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    downloadName = '';
    const a = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
    const b = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const c = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });
    restores = [() => a.mockRestore(), () => b.mockRestore(), () => c.mockRestore()];
  });
  afterEach(() => {
    restores.forEach((r) => r());
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  async function exportedName(): Promise<string> {
    render(
      <MemoryRouter>
        <ExportCsvButton baseName="things" columns={columns} rows={[{ name: 'A' }]} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(downloadName).not.toBe(''));
    return downloadName;
  }

  it('Los Angeles, Dec 31 19:00 PST (UTC day Jan 1): things-2025-12-31.csv', async () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
    expect(await exportedName()).toBe('things-2025-12-31.csv');
  });

  it('Pacific/Auckland, Jan 1 09:00 NZDT (UTC day Dec 31): things-2026-01-01.csv', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2025-12-31T20:00:00Z'));
    expect(await exportedName()).toBe('things-2026-01-01.csv');
  });
});
