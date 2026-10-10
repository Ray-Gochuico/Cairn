import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { EXPLORE_DB_URL } from '@/lib/explore-mode';
import { collectSourceFiles, stripComments } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const RUST_LIB = path.join(ROOT, 'src-tauri', 'src', 'lib.rs');
const RUST_DB_BACKUP = path.join(ROOT, 'src-tauri', 'src', 'db_backup.rs');
const TS_BACKUP_RESTORE = path.join(ROOT, 'src', 'lib', 'backup-restore.ts');
const TAURI_CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json');

/** Commands registered in tauri::generate_handler![ … ] (idents, order-free). */
function rustRegisteredCommands(): Set<string> {
  const source = readFileSync(RUST_LIB, 'utf8');
  const m = source.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error('generate_handler![…] not found in src-tauri/src/lib.rs');
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Every string-literal custom command passed to invoke() in src/**.
 * `plugin:`-prefixed commands are Tauri plugin built-ins registered by the
 * plugin crates (e.g. `plugin:sql|close` in backup-restore.ts), not ours.
 * The browser shim's own `function invoke(…)` DEFINITION has no literal
 * first argument, so the regex never matches it.
 */
async function jsInvokedCommands(): Promise<Map<string, string[]>> {
  const byCommand = new Map<string, string[]>();
  const files = await collectSourceFiles(SRC_DIR);
  const invokeRe = /\binvoke(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g;
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, 'utf8'));
    let m: RegExpExecArray | null;
    invokeRe.lastIndex = 0;
    while ((m = invokeRe.exec(stripped)) !== null) {
      const cmd = m[1];
      if (cmd.startsWith('plugin:')) continue;
      const rel = path.relative(ROOT, file);
      byCommand.set(cmd, [...(byCommand.get(cmd) ?? []), rel]);
    }
  }
  return byCommand;
}

describe('JS ↔ Rust IPC parity', () => {
  it('every JS-invoked command is registered in generate_handler![]', async () => {
    const rust = rustRegisteredCommands();
    const js = await jsInvokedCommands();
    const unregistered = [...js.entries()].filter(([cmd]) => !rust.has(cmd));
    expect(
      unregistered.map(([cmd, files]) => `${cmd} (called from ${files.join(', ')})`),
    ).toEqual([]); // an unregistered command rejects at runtime with "command not found"
  });

  it('every Rust-registered command has at least one JS call site', async () => {
    const rust = rustRegisteredCommands();
    const js = await jsInvokedCommands();
    const dead = [...rust].filter((cmd) => !js.has(cmd));
    // A dead command is exposed IPC attack/audit surface with zero callers.
    // If one becomes intentionally JS-invisible (e.g. invoked from Rust menu
    // code), exclude it HERE with a comment — that's the escape hatch.
    expect(dead).toEqual([]);
  });

  it('MAX_SCHEMA_VERSION matches across the language boundary (JS migrations.ts vs Rust db_backup.rs)', () => {
    const rustSource = readFileSync(RUST_DB_BACKUP, 'utf8');
    const m = rustSource.match(/pub const MAX_SCHEMA_VERSION:\s*i64\s*=\s*(\d+)\s*;/);
    if (!m) throw new Error('pub const MAX_SCHEMA_VERSION not found in src-tauri/src/db_backup.rs');
    // The Rust restore guard refuses backups newer than ITS constant — a
    // one-sided bump would let restore accept files migrations can't run, or
    // reject files it should accept. tests/db/schema-version-guard.test.ts
    // pins the JS literal; this closes the cross-language half for real.
    expect(Number(m[1])).toBe(MAX_SCHEMA_VERSION);
  });

  it('sample DB URL literal matches across languages (W4 allowlist pin)', () => {
    // db_sample_reset is hard-allowlisted to ONE url. If the TS constant and
    // the Rust allowlist ever drift, every explore wipe would be refused —
    // and the real DB is only safe because the Rust side compares EQUALITY
    // against this exact literal.
    const rustSource = readFileSync(RUST_DB_BACKUP, 'utf8');
    const m = rustSource.match(/pub const SAMPLE_DB_URL:\s*&str\s*=\s*"([^"]+)"\s*;/);
    if (!m) throw new Error('pub const SAMPLE_DB_URL not found in src-tauri/src/db_backup.rs');
    expect(m[1]).toBe(EXPLORE_DB_URL);
  });

  it('the live database URL matches across languages (v1.8.0 H2: the startup reconciliation settles the file the webview loads)', () => {
    const rust = readFileSync(RUST_DB_BACKUP, 'utf8').match(/pub const LIVE_DB_URL:\s*&str\s*=\s*"([^"]+)"\s*;/);
    if (!rust) throw new Error('pub const LIVE_DB_URL not found in src-tauri/src/db_backup.rs');
    const ts = readFileSync(TS_BACKUP_RESTORE, 'utf8').match(/export const DB_URL = '([^']+)';/);
    if (!ts) throw new Error('export const DB_URL not found in src/lib/backup-restore.ts');
    expect(rust[1]).toBe(ts[1]);
  });

  it('an interrupted restore is settled in the setup hook, and no database is opened before it (v1.8.0 H2, chip r)', () => {
    // The plugin opens a database only on the webview's plugin:sql|load, or
    // at its own setup for a `plugins.sql.preload` entry — which would run
    // BEFORE the app's setup hook. So no preload, and the hook calls the
    // reconciliation.
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8')) as { plugins?: Record<string, unknown> };
    expect(conf.plugins?.sql).toBeUndefined();
    const lib = stripComments(readFileSync(RUST_LIB, 'utf8'));
    const setup = lib.match(/\.setup\(\|app\| \{([\s\S]*?)\}\)/);
    expect(setup, '.setup(|app| { … }) in src-tauri/src/lib.rs').not.toBeNull();
    expect(setup![1]).toContain('db_backup::reconcile_at_startup(app.handle());');
    // Nor in a platform file Tauri merges over it (none today; plan review R3-5).
    const platformConfs = readdirSync(path.join(ROOT, 'src-tauri')).filter((n) => /^tauri\.[a-z]+\.conf\.json$/.test(n));
    for (const name of platformConfs) {
      const platform = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', name), 'utf8')) as { plugins?: Record<string, unknown> };
      expect(platform.plugins?.sql, name).toBeUndefined();
    }
    // The setup step resolves the live file as db_restore does and settles
    // it: no test builds an AppHandle, so its body is pinned as text (plan
    // review R2-3, as v1.7.2 L37 pins db_restore's).
    const rust = readFileSync(RUST_DB_BACKUP, 'utf8');
    const start = rust.indexOf('pub fn reconcile_at_startup<');
    expect(start, 'pub fn reconcile_at_startup in src-tauri/src/db_backup.rs').toBeGreaterThan(-1);
    const body = rust
      .slice(start, rust.indexOf('\n}\n', start))
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(body).toContain('if let Ok(live) = resolve_sqlite_path(app, LIVE_DB_URL) {');
    expect(body.match(/reconcile_interrupted_restore\(&live\);/g)).toHaveLength(1);
  });

  it('db_restore_check hands the check the chosen file, then the live file (v1.8.0 H2, chip v; as v1.7.2 L37 pins db_restore)', () => {
    // No test builds an AppHandle: a swapped order would look for set-asides
    // beside the backup, pass, and leave the refusal to after the close.
    const rust = readFileSync(RUST_DB_BACKUP, 'utf8');
    const start = rust.indexOf('pub async fn db_restore_check(');
    expect(start, 'pub async fn db_restore_check in src-tauri/src/db_backup.rs').toBeGreaterThan(-1);
    const body = rust
      .slice(start, rust.indexOf('\n}\n', start))
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(body).toContain('let live_path = resolve_sqlite_path(&app, &db)?;');
    expect(body.match(/refuse_before_close\(/g)).toHaveLength(1);
    expect(body).toContain('refuse_before_close(Path::new(&source), &live_path)');
    expect(rust).toContain('fn refuse_before_close(source: &Path, live: &Path) -> Result<(), String> {');
  });
});
