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
