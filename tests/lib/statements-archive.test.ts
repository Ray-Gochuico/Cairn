import { describe, it, expect } from 'vitest';
import { resolveArchivePath } from '@/lib/statements-archive';

describe('resolveArchivePath', () => {
  it('keeps the original filename when no collision', () => {
    expect(resolveArchivePath('/Users/me/Statements', 'mar.pdf', [])).toBe(
      '/Users/me/Statements/mar.pdf',
    );
  });

  it('keeps the original filename when other names are present but differ', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'mar.pdf', ['feb.pdf', 'jan.pdf']),
    ).toBe('/Users/me/Statements/mar.pdf');
  });

  it('suffixes (2) on the first collision', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'mar.pdf', ['mar.pdf']),
    ).toBe('/Users/me/Statements/mar (2).pdf');
  });

  it('walks the suffix up until it finds a free name', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'mar.pdf', [
        'mar.pdf',
        'mar (2).pdf',
        'mar (3).pdf',
      ]),
    ).toBe('/Users/me/Statements/mar (4).pdf');
  });

  it('suffixes before the last extension only', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'statement.2026.pdf', [
        'statement.2026.pdf',
      ]),
    ).toBe('/Users/me/Statements/statement.2026 (2).pdf');
  });

  it('suffixes a filename with no extension', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'statement', ['statement']),
    ).toBe('/Users/me/Statements/statement (2)');
  });

  it('strips a trailing slash from the folder', () => {
    expect(resolveArchivePath('/Users/me/Statements/', 'mar.pdf', [])).toBe(
      '/Users/me/Statements/mar.pdf',
    );
  });

  it('treats existing names case-sensitively', () => {
    expect(
      resolveArchivePath('/Users/me/Statements', 'Mar.pdf', ['mar.pdf']),
    ).toBe('/Users/me/Statements/Mar.pdf');
  });
});
