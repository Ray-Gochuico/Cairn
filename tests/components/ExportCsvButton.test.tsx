import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
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
    await Promise.resolve();

    expect(downloadName).toMatch(/^things-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(capturedText).toBe('name\nA\nB');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
