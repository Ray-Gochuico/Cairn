import { describe, it, expect, vi, beforeEach } from 'vitest';

// archiveStatementPdf touches the Tauri fs plugin and the async path API —
// neither has a runtime in vitest. Mock both BEFORE importing the module.
// resolveArchivePath stays pure and needs none of this.
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(),
  readDir: vi.fn(),
  exists: vi.fn(),
}));
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }));

import { writeFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { resolveArchivePath, archiveStatementPdf } from '@/lib/statements-archive';

const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as unknown as ReturnType<typeof vi.fn>;
const mockJoin = join as unknown as ReturnType<typeof vi.fn>;

describe('resolveArchivePath', () => {
  it('keeps the original filename when no collision', () => {
    expect(resolveArchivePath('mar.pdf', [])).toBe('mar.pdf');
  });

  it('keeps the original filename when other names are present but differ', () => {
    expect(resolveArchivePath('mar.pdf', ['feb.pdf', 'jan.pdf'])).toBe('mar.pdf');
  });

  it('suffixes (2) on the first collision', () => {
    expect(resolveArchivePath('mar.pdf', ['mar.pdf'])).toBe('mar (2).pdf');
  });

  it('walks the suffix up until it finds a free name', () => {
    expect(
      resolveArchivePath('mar.pdf', ['mar.pdf', 'mar (2).pdf', 'mar (3).pdf']),
    ).toBe('mar (4).pdf');
  });

  it('suffixes before the last extension only', () => {
    expect(
      resolveArchivePath('statement.2026.pdf', ['statement.2026.pdf']),
    ).toBe('statement.2026 (2).pdf');
  });

  it('suffixes a filename with no extension', () => {
    expect(resolveArchivePath('statement', ['statement'])).toBe('statement (2)');
  });

  it('treats existing names case-sensitively', () => {
    expect(resolveArchivePath('Mar.pdf', ['mar.pdf'])).toBe('Mar.pdf');
  });
});

describe('archiveStatementPdf', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  /** Async `join()` fake for one separator. A mocked join proves the module
   * delegates joining to the platform-aware API — not real OS behavior (that
   * proof is the A4 Windows-hardware run). */
  const fakeJoin =
    (sep: '/' | '\\') =>
    async (...parts: string[]): Promise<string> =>
      parts.join(sep);

  beforeEach(() => {
    vi.resetAllMocks();
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    mockWriteFile.mockResolvedValue(undefined);
    mockJoin.mockImplementation(fakeJoin('/'));
  });

  it('joins folder + resolved name via the platform-aware join (POSIX)', async () => {
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);
    expect(warning).toBeNull();
    expect(mockJoin).toHaveBeenCalledWith('/Users/me/Statements', 'mar.pdf');
    expect(mockWriteFile).toHaveBeenCalledWith('/Users/me/Statements/mar.pdf', bytes);
  });

  it('writes a backslash target on Windows (mocked join — proves wiring)', async () => {
    mockJoin.mockImplementation(fakeJoin('\\'));
    const warning = await archiveStatementPdf('C:\\Users\\me\\Statements', 'mar.pdf', bytes);
    expect(warning).toBeNull();
    expect(mockWriteFile).toHaveBeenCalledWith('C:\\Users\\me\\Statements\\mar.pdf', bytes);
  });

  it('dedups against the folder listing BEFORE joining (Windows collision)', async () => {
    mockJoin.mockImplementation(fakeJoin('\\'));
    mockReadDir.mockResolvedValue([{ name: 'mar.pdf' }, { name: 'mar (2).pdf' }]);
    const warning = await archiveStatementPdf('C:\\Users\\me\\Statements', 'mar.pdf', bytes);
    expect(warning).toBeNull();
    expect(mockJoin).toHaveBeenCalledWith('C:\\Users\\me\\Statements', 'mar (3).pdf');
    expect(mockWriteFile).toHaveBeenCalledWith('C:\\Users\\me\\Statements\\mar (3).pdf', bytes);
  });

  it('returns a warning (never throws) when the folder is missing', async () => {
    mockExists.mockResolvedValue(false);
    const warning = await archiveStatementPdf('/gone', 'mar.pdf', bytes);
    expect(warning).toContain('Statements archive folder not found');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns a warning (never throws) when the write fails', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'));
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);
    expect(warning).toContain('Could not archive the statement PDF');
    expect(warning).toContain('disk full');
  });
});
