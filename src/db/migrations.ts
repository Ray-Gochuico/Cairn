import type { Database } from './db';

export interface Migration {
  version: string;
  sql: string;
}

export async function runMigrations(db: Database, migrations: Migration[]): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = await db.select<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  const appliedSet = new Set(applied.map((a) => a.version));

  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;

    // Strip line-level SQL comments (-- ...) before splitting, then split on
    // statement-terminating semicolons and drop empty fragments.
    const stripped = m.sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');

    const statements = stripped
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await db.execute(stmt);
    }
  }
}

export async function loadAllMigrations(): Promise<Migration[]> {
  const m0001 = (await import('./migrations/0001_initial.sql?raw')).default;
  return [
    { version: '0001_initial', sql: m0001 },
  ];
}
