import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

/**
 * Write a finance.db exactly as the build that shipped schema `n` would have
 * left it: the first n registry migrations applied, n audit rows, and
 * user_version = n — the runner's own stamp (v1.7.1 U3 stamps each
 * migration's registry ordinal and ends at the last one passed; U1 chip b
 * deleted the re-stamp this helper needed before). Closing the adapter
 * checkpoints and removes the WAL, so the file is self-contained.
 * Refuses anything but a tmp folder or an isolated `*.smoke` profile folder
 * (CR-U-6; an allowlist, see assertSeedTargetAllowed).
 */
export async function seedSchemaFile(outPath: string, n: number): Promise<void> {
  assertSeedTargetAllowed(outPath); // BEFORE any fs call
  mkdirSync(path.dirname(outPath), { recursive: true });
  for (const p of [outPath, `${outPath}-wal`, `${outPath}-shm`]) rmSync(p, { force: true });
  const db = new SqliteAdapter(outPath);
  try {
    const all = await loadAllMigrations();
    await runMigrations(db, all.slice(0, n));
  } finally {
    await db.close();
  }
}

/** The installed app's identifier — its folder is the owner's real data (CR-U-6). */
const REAL_IDENTIFIER = 'com.raymondgochuico.cairn';

/**
 * CR-U-6 allowlist (plan review, PR-15): the target folder, with symlinks
 * resolved through its nearest existing ancestor, must sit inside the real
 * tmpdir or be named `*.smoke` (the isolated identifier). Compared
 * case-insensitively (APFS default). Throws before anything is created or
 * removed.
 *
 * Plus a hard denylist on top (the lane brief: refuse ANY path under the real
 * identifier): no segment of the requested or the resolved path may equal
 * the real identifier `com.raymondgochuico.cairn`, so a `*.smoke` folder
 * nested inside the real profile folder is refused too.
 */
export function assertSeedTargetAllowed(outPath: string): void {
  let probe = path.dirname(path.resolve(outPath));
  const rest: string[] = [];
  while (!existsSync(probe)) {
    rest.unshift(path.basename(probe));
    probe = path.dirname(probe);
  }
  const realDir = path.join(realpathSync.native(probe), ...rest).toLowerCase();
  const realTmp = realpathSync.native(tmpdir()).toLowerCase();
  const inTmp = realDir === realTmp || realDir.startsWith(realTmp + path.sep);
  const segments = [
    ...path.resolve(outPath).toLowerCase().split(/[\\/]/),
    ...realDir.split(/[\\/]/),
  ];
  const underRealProfile = segments.includes(REAL_IDENTIFIER);
  if (underRealProfile || (!inTmp && !path.basename(realDir).endsWith('.smoke'))) {
    throw new Error(`seedSchemaFile: refusing ${outPath}; only a tmp folder or an isolated *.smoke profile folder is allowed (CR-U-6)`);
  }
}
