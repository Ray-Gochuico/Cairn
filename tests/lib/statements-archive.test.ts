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
    mockReadDir.mockRejectedValue('failed to read directory at path: /gone with error: No such file or directory (os error 2)');
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

// v1.8.0 W4 (C009): an empty array is never written as an "archived" PDF.
describe('archiveStatementPdf — empty bytes (C009)', () => {
  const EMPTY_WARNING =
    'Could not archive the statement PDF: the copy Cairn held was empty, so nothing was written. The import itself was saved.';

  beforeEach(() => {
    vi.resetAllMocks();
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    mockWriteFile.mockResolvedValue(undefined);
    mockJoin.mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('a zero-length array writes nothing and returns the empty-copy warning', async () => {
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', new Uint8Array(0));
    expect(warning).toBe(EMPTY_WARNING);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockReadDir).not.toHaveBeenCalled();
  });

  it('an array whose buffer was transferred away (detached) is treated the same', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(bytes.byteLength).toBe(0);
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);
    expect(warning).toBe(EMPTY_WARNING);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('a one-byte array is still written (the guard is exactly zero length)', async () => {
    const one = new Uint8Array([0x25]);
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', one);
    expect(warning).toBeNull();
    expect(mockWriteFile).toHaveBeenCalledWith('/Users/me/Statements/mar.pdf', one);
  });
});

// v1.8.0 W4 (C009): after a relaunch the folder picked in Settings has no
// dialog grant any more, and exists() has no static scope (fs:default covers
// the app's own folders only), so it was refused on every import. The archive
// now lists the folder with readDir, which has the static $HOME scope, and
// tells "not there" from "not allowed" by the OS error in its rejection.
describe('archiveStatementPdf — after a relaunch (C009)', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const NOT_FOUND = (folder: string) =>
    `Statements archive folder not found: ${folder}. The import was saved; the PDF was not archived.`;

  beforeEach(() => {
    vi.resetAllMocks();
    // The session the folder was picked in: exists() still answers.
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    mockWriteFile.mockResolvedValue(undefined);
    mockJoin.mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('never calls exists: with exists refused, the PDF is still archived', async () => {
    mockExists.mockRejectedValue('forbidden path: /Users/me/Statements');
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);
    expect(warning).toBeNull();
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith('/Users/me/Statements/mar.pdf', bytes);
  });

  it.each([
    ['macOS, no such folder', 'failed to read directory at path: /gone with error: No such file or directory (os error 2)'],
    ['Windows, path not found', 'failed to read directory at path: /gone with error: The system cannot find the path specified. (os error 3)'],
    ['a file, not a folder', 'failed to read directory at path: /gone with error: Not a directory (os error 20)'],
    ['Windows, not a folder', 'failed to read directory at path: /gone with error: The directory name is invalid. (os error 267)'],
  ])('readDir rejecting with an OS not-found error (%s) gives the folder-not-found warning', async (_label, reason) => {
    mockReadDir.mockRejectedValue(reason);
    const warning = await archiveStatementPdf('/gone', 'mar.pdf', bytes);
    expect(warning).toBe(NOT_FOUND('/gone'));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('readDir refused by the scope gives the could-not-archive warning with the reason', async () => {
    mockReadDir.mockRejectedValue('forbidden path: /Volumes/Card/Statements');
    const warning = await archiveStatementPdf('/Volumes/Card/Statements', 'mar.pdf', bytes);
    expect(warning).toBe(
      'Could not archive the statement PDF: forbidden path: /Volumes/Card/Statements. The import itself was saved.',
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('an OS error number that only starts like a not-found one is not read as one', async () => {
    mockReadDir.mockRejectedValue('failed to read directory at path: /x with error: Resource temporarily unavailable (os error 35)');
    const warning = await archiveStatementPdf('/x', 'mar.pdf', bytes);
    expect(warning).toBe(
      'Could not archive the statement PDF: failed to read directory at path: /x with error: Resource temporarily unavailable (os error 35). The import itself was saved.',
    );
  });

  it('a write refused after the listing gives the could-not-archive warning', async () => {
    mockWriteFile.mockRejectedValue('forbidden path: /Users/me/Statements/mar.pdf');
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);
    expect(warning).toBe(
      'Could not archive the statement PDF: forbidden path: /Users/me/Statements/mar.pdf. The import itself was saved.',
    );
  });
});
