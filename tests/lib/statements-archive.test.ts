import { describe, it, expect, vi, beforeEach } from 'vitest';

// `archiveStatementPdf` touches the Tauri fs plugin and `@tauri-apps/api/path`'s
// async `join`, neither of which has a runtime in vitest. Mock them BEFORE
// importing the module under test. `join` is mocked separator-aware so a
// backslash variant can prove Windows separators flow through (a mocked join
// proves call-wiring, not real OS separators — real proof is the A4 hardware
// run).
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(),
  readDir: vi.fn(),
  exists: vi.fn(),
}));
vi.mock('@tauri-apps/api/path', () => ({
  // POSIX-style join: collapse a trailing sep on the head, then '/'-join.
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

import { writeFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { resolveArchivePath, archiveStatementPdf } from '@/lib/statements-archive';

const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as unknown as ReturnType<typeof vi.fn>;
const mockJoin = join as unknown as ReturnType<typeof vi.fn>;

// `resolveArchivePath` is PURE and returns the collision-free FILENAME only
// (the directory join is the async caller's job). Its dedup walk operates on
// bare names, so it is unchanged by the path-join refactor.
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
    expect(resolveArchivePath('statement.2026.pdf', ['statement.2026.pdf'])).toBe(
      'statement.2026 (2).pdf',
    );
  });

  it('suffixes a filename with no extension', () => {
    expect(resolveArchivePath('statement', ['statement'])).toBe('statement (2)');
  });

  it('treats existing names case-sensitively', () => {
    expect(resolveArchivePath('Mar.pdf', ['mar.pdf'])).toBe('Mar.pdf');
  });
});

describe('archiveStatementPdf', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-arm the separator-aware join after resetAllMocks wiped the impl.
    mockJoin.mockImplementation((...parts: string[]) => Promise.resolve(parts.join('/')));
  });

  it('joins the folder and collision-free filename via the path plugin', async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    const bytes = new Uint8Array([1, 2, 3]);

    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);

    expect(warning).toBeNull();
    // The path is built with join(folder, name), NOT a hardcoded '/'.
    expect(mockJoin).toHaveBeenCalledWith('/Users/me/Statements', 'mar.pdf');
    expect(mockWriteFile).toHaveBeenCalledWith('/Users/me/Statements/mar.pdf', bytes);
  });

  it('joins the collision-suffixed filename when one already exists', async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([{ name: 'mar.pdf' }]);
    const bytes = new Uint8Array([9]);

    await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', bytes);

    expect(mockJoin).toHaveBeenCalledWith('/Users/me/Statements', 'mar (2).pdf');
    expect(mockWriteFile).toHaveBeenCalledWith('/Users/me/Statements/mar (2).pdf', bytes);
  });

  it('builds a Windows path with backslash separators (no mixed separators)', async () => {
    // Windows variant: join uses '\\'. This proves the call wiring carries the
    // platform separator end-to-end instead of a hardcoded POSIX '/'.
    mockJoin.mockImplementation((...parts: string[]) => Promise.resolve(parts.join('\\')));
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    const bytes = new Uint8Array([7]);

    await archiveStatementPdf('C:\\Users\\me\\Statements', 'mar.pdf', bytes);

    expect(mockJoin).toHaveBeenCalledWith('C:\\Users\\me\\Statements', 'mar.pdf');
    expect(mockWriteFile).toHaveBeenCalledWith('C:\\Users\\me\\Statements\\mar.pdf', bytes);
  });

  it('returns a non-blocking warning (never throws) when the folder is missing', async () => {
    mockExists.mockResolvedValue(false);
    const warning = await archiveStatementPdf('/no/such/folder', 'mar.pdf', new Uint8Array());
    expect(warning).toContain('not found');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns a non-blocking warning (never throws) on a write error', async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([]);
    mockWriteFile.mockRejectedValue(new Error('permission denied'));
    const warning = await archiveStatementPdf('/Users/me/Statements', 'mar.pdf', new Uint8Array());
    expect(warning).toContain('permission denied');
  });
});
