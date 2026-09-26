import { mkdtempSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { assertSeedTargetAllowed, seedSchemaFile } from './seed-schema-file';

describe('seedSchemaFile — a released-schema file for the isolated smoke (U1) and the upgrade harness (U3)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'cairn-seed-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true })); // removes a symlink inside, never follows it

  it('writes a self-contained file at schema n: n audit rows, user_version n, quick_check ok, no WAL sidecar', async () => {
    const out = path.join(dir, 'finance.db');
    await seedSchemaFile(out, 53);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(`${out}-wal`)).toBe(false);
    const db = new BetterSqlite3(out, { readonly: true });
    expect(db.pragma('user_version', { simple: true })).toBe(53);
    expect(db.pragma('quick_check', { simple: true })).toBe('ok');
    expect((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(53);
    expect(() => db.prepare('SELECT vehicle_repair_category_ids FROM app_settings').get()).toThrow(/no such column/);
    db.close();
  });

  it('REFUSES anything outside tmp or a *.smoke folder, case-insensitively and before any fs write (CR-U-6, PR-15)', async () => {
    // A lookalike of the real folder with the wrong case, under a user folder that does not exist.
    // /Users is root-owned, so even a broken guard could not create anything here.
    const lookalike = '/Users/nobody-cairn-seed-guard/Library/Application Support/com.raymondgochuico.Cairn/finance.db';
    await expect(seedSchemaFile(lookalike, 53)).rejects.toThrow(/refusing/);
    expect(existsSync('/Users/nobody-cairn-seed-guard')).toBe(false);
  });

  it('REFUSES a *.smoke-named symlink that resolves outside tmp to a folder not named *.smoke', async () => {
    const link = path.join(dir, 'link.smoke');
    symlinkSync('/usr', link);                                   // read-only system folder: nothing can be written through it
    await expect(seedSchemaFile(path.join(link, 'finance.db'), 53)).rejects.toThrow(/refusing/);
  });

  // Coordinator (lane brief, CR-U-6): the helper must refuse ANY path under the
  // real identifier's folder — a `*.smoke` folder nested inside it too, and
  // even inside tmp. Every path here is under the per-test tmp folder or under
  // a root-owned /Users entry that does not exist, so nothing real is touched.
  it('REFUSES any path with a segment equal to the real identifier, even under tmp or inside a *.smoke folder (case-insensitive)', async () => {
    for (const id of ['com.raymondgochuico.cairn', 'com.raymondgochuico.Cairn']) {
      const nested = path.join(dir, id, 'inner.smoke', 'finance.db');
      await expect(seedSchemaFile(nested, 53)).rejects.toThrow(/refusing/);
      expect(existsSync(path.join(dir, id))).toBe(false);
    }
    const underRealShape = '/Users/nobody-cairn-seed-guard/Library/Application Support/com.raymondgochuico.cairn/inner.smoke/finance.db';
    await expect(seedSchemaFile(underRealShape, 53)).rejects.toThrow(/refusing/);
    expect(existsSync('/Users/nobody-cairn-seed-guard')).toBe(false);
  });

  it('U1-m28: allows a *.smoke profile folder OUTSIDE tmp — the path the isolated smoke uses (checked, never written)', () => {
    // assertSeedTargetAllowed only stats paths (existsSync/realpathSync): nothing is created.
    const smokePath = '/Users/nobody-cairn-seed-guard/Library/Application Support/com.raymondgochuico.cairn.smoke/finance.db';
    expect(() => assertSeedTargetAllowed(smokePath)).not.toThrow();
    expect(existsSync('/Users/nobody-cairn-seed-guard')).toBe(false);
  });

  it('allows the isolated smoke identifier folder itself (a *.smoke name under tmp here)', async () => {
    const out = path.join(dir, 'com.raymondgochuico.cairn.smoke', 'finance.db');
    await seedSchemaFile(out, 53);
    expect(existsSync(out)).toBe(true);
  });

  it.runIf(process.env.CAIRN_SEED_SCHEMA_OUT)('writes the smoke seed to $CAIRN_SEED_SCHEMA_OUT at $CAIRN_SEED_SCHEMA_N (default 53) — never a real-profile path', async () => {
    const out = process.env.CAIRN_SEED_SCHEMA_OUT as string;
    expect(out).not.toMatch(/com\.raymondgochuico\.cairn(\/|\\|$)/); // CR-U-6: the real identifier's folder is off limits
    await seedSchemaFile(out, Number(process.env.CAIRN_SEED_SCHEMA_N ?? 53));
    expect(existsSync(out)).toBe(true);
  });
});
