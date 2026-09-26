import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRE_UPDATE_KEEP,
  PRE_UPDATE_NAME_RE,
  parsePreUpdateCopyName,
  preUpdateCopyFilename,
} from '@/lib/pre-update-names';

const NOW = new Date(2026, 8, 25, 10, 15, 0); // local 2026-09-25 10:15:00

describe('pre-update copy names (CR-U-3 family)', () => {
  it('keeps the newest 3', () => {
    expect(PRE_UPDATE_KEEP).toBe(3);
  });

  it('builds cairn-pre-update-<from>-to-<to>-YYYYMMDD-HHMMSS.db from a LOCAL-time Date', () => {
    expect(preUpdateCopyFilename(53, 55, NOW)).toBe('cairn-pre-update-53-to-55-20260925-101500.db');
    expect(preUpdateCopyFilename(9, 10, new Date(2026, 0, 3, 4, 5, 6))).toBe(
      'cairn-pre-update-9-to-10-20260103-040506.db',
    );
  });

  it('parses its own names back (round-trip) and reports from/to/takenAt', () => {
    const p = parsePreUpdateCopyName('cairn-pre-update-53-to-55-20260925-101500.db');
    expect(p).not.toBeNull();
    expect(p?.schemaFrom).toBe(53);
    expect(p?.schemaTo).toBe(55);
    expect(p?.takenAt.getTime()).toBe(NOW.getTime());
    expect(preUpdateCopyFilename(p!.schemaFrom, p!.schemaTo, p!.takenAt)).toBe(
      'cairn-pre-update-53-to-55-20260925-101500.db',
    );
  });

  it('NEVER matches a manual backup name, a suffixed name, or a foreign name (family isolation)', () => {
    for (const name of [
      'cairn-20260925-101500.db',
      'cairn-pre-update-53-to-55-20260925-101500.db.bak',
      'cairn-pre-update-53-to-55-20260925-1015.db',
      'pre-update-53-to-55-20260925-101500.db',
      'notes.txt',
    ]) {
      expect(parsePreUpdateCopyName(name), name).toBeNull();
      expect(PRE_UPDATE_NAME_RE.test(name), name).toBe(false);
    }
  });

  it("the manual regex from backup-restore cannot match the family (both directions)", () => {
    // U1-m30: read the REAL rotation regex out of rotateBackups (never a copied
    // literal), so a widened rotation regex turns this test red.
    const src = readFileSync(resolve(__dirname, '../../src/lib/backup-restore.ts'), 'utf8');
    const literal = /\.filter\(\(e\) => e\.isFile && \/(.+?)\/\.test\(e\.name\)\)/.exec(src);
    expect(literal, 'rotateBackups’ filter regex must be found').not.toBeNull();
    const manualRe = new RegExp(literal![1]);
    expect(manualRe.test('cairn-20260925-101500.db')).toBe(true); // it IS the manual matcher
    expect(manualRe.test('cairn-pre-update-53-to-55-20260925-101500.db')).toBe(false);
    expect(PRE_UPDATE_NAME_RE.test('cairn-20260925-101500.db')).toBe(false);
  });
});
