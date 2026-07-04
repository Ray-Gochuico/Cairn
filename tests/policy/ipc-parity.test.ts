import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { collectSourceFiles, stripComments } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const RUST_LIB = path.join(ROOT, 'src-tauri', 'src', 'lib.rs');
const RUST_DB_BACKUP = path.join(ROOT, 'src-tauri', 'src', 'db_backup.rs');

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
});
