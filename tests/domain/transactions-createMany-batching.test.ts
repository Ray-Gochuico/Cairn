// Regression guard for the P2-A4 Data Architecture finding:
// `TransactionsRepo.createMany` issues N separate INSERTs without a
// surrounding transaction, so each row pays the full SQLite WAL fsync /
// implicit-commit cost.
//
// PARITY-FIX UPDATE (w3d): `createMany` now batches the N inserts through the
// `db.executeBatch(..., {transaction:true})` single-connection primitive
// instead of a hand-rolled BEGIN/body/COMMIT expressed as three separate
// `db.execute` calls. Under prod's `@tauri-apps/plugin-sql` connection POOL
// those three calls scattered across connections and the "transaction"
// wrapped nothing; `executeBatch` pins the whole batch to one connection so
// it is genuinely atomic. The structural test below therefore asserts the
// NEW contract: exactly one `executeBatch` call carrying all N INSERTs with
// transaction:true, and NO per-row `db.execute` INSERTs.
//
// The perf test is a visibility-only sanity check: it logs the wallclock
// speedup but doesn't gate CI, because wallclock ratios on WAL+APFS are
// inherently noisy under parallel vitest workers. The structural test is
// what guarantees the batch wrap is present.
//
// We use a tempfile DB (not `:memory:`) because the bug this guards is
// about WAL fsync per-statement on real user databases. In-memory SQLite
// has no fsync, so the speedup there is only ~1x and the test would not
// catch a regression.
//
// Implementation guard: the public API must also remain ergonomic — a
// thrown error from any inner INSERT must roll the whole batch back and
// re-throw so partial writes are not visible after the failure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { TransactionsRepo } from '@/domain/transactions';
import type { Transaction } from '@/types/schema';

// 2000 rows: large enough for the fsync-per-row cost to dominate but small
// enough to stay well under a 5-second test budget. The original spec cited
// 1k rows, but at 1k the per-iteration noise compresses the speedup signal
// on a fast SSD. 2k gives a more stable ratio with the same total wallclock.
const N = 2000;

function makeRows(n: number): Array<Omit<Transaction, 'id'>> {
  const rows: Array<Omit<Transaction, 'id'>> = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      householdId: 1,
      date: '2026-03-05',
      merchant: `M${i}`,
      merchantRaw: null,
      amount: i,
      categoryId: null,
      sourceAccountId: null,
      propertyId: null,
      vehicleId: null,
      personId: null,
      sourcePdfFilename: 'bench.pdf',
      reimbursable: false,
      reimbursedAt: null,
      reimbursedAmount: null,
      isRecurring: false,
      notes: null,
    });
  }
  return rows;
}

describe('TransactionsRepo.createMany batching (P2-A4)', () => {
  let db: SqliteAdapter;
  let repo: TransactionsRepo;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'finance-batching-'));
    db = new SqliteAdapter(join(dir, 'test.db'));
    await runMigrations(db, await loadAllMigrations());
    repo = new TransactionsRepo(db);
  });

  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts all rows correctly via the batched path', async () => {
    const rows = makeRows(50);
    const ids = await repo.createMany(rows);
    expect(ids).toHaveLength(50);
    const all = await repo.list();
    expect(all).toHaveLength(50);
  });

  it('batches all inserts through one executeBatch({transaction:true}) — no per-row execute INSERTs', async () => {
    // The most direct guard for the parity fix: the N inserts must flow
    // through the single-connection `executeBatch` primitive, NOT a
    // hand-rolled BEGIN/body/COMMIT (which prod's connection pool scatters
    // across connections, wrapping nothing). We spy on BOTH `executeBatch`
    // and `execute` and assert exactly one batch carries all N INSERTs with
    // transaction:true, while NO INSERT leaks through a per-row `execute`.
    const batchCalls: Array<{ statements: { sql: string }[]; transaction: boolean | undefined }> = [];
    const origBatch = db.executeBatch.bind(db);
    db.executeBatch = (statements, options) => {
      batchCalls.push({
        statements: statements.map((s) => ({ sql: s.sql.trim().slice(0, 12).toUpperCase() })),
        transaction: options?.transaction,
      });
      return origBatch(statements, options);
    };

    const executeInserts: string[] = [];
    const origExecute = db.execute.bind(db);
    db.execute = (sql: string, params?: unknown[]) => {
      const head = sql.trim().slice(0, 12).toUpperCase();
      if (head.startsWith('INSERT')) executeInserts.push(head);
      return origExecute(sql, params);
    };

    const rows = makeRows(20);
    await repo.createMany(rows);

    // Exactly one atomic batch, carrying all 20 INSERTs, transaction:true.
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].transaction).toBe(true);
    const batchedInserts = batchCalls[0].statements.filter((s) => s.sql.startsWith('INSERT'));
    expect(batchedInserts).toHaveLength(20);
    // And no INSERT went through the per-row execute path (the old bug).
    expect(executeInserts).toHaveLength(0);
  });

  it('benchmarks batched vs unbatched inserts (logged, no hard assertion)', async () => {
    // Wallclock speedup is inherently noisy under vitest's parallel test
    // workers, so this test logs the ratio for visibility but doesn't gate
    // CI on it — the structural test above is the deterministic regression
    // guard for the BEGIN/COMMIT wrap. In isolation on WAL+APFS we see
    // ~4-5x; under contention the ratio compresses (occasionally <1x when
    // a worker steals disk bandwidth at the wrong moment).
    const SQL =
      `INSERT INTO transactions
        (household_id, date, merchant, amount, reimbursable, is_recurring)
       VALUES (?, ?, ?, ?, ?, ?)`;

    const dirCtrl = mkdtempSync(join(tmpdir(), 'finance-batching-ctrl-'));
    const dirBat = mkdtempSync(join(tmpdir(), 'finance-batching-bat-'));
    const dbCtrl = new SqliteAdapter(join(dirCtrl, 'test.db'));
    const dbBat = new SqliteAdapter(join(dirBat, 'test.db'));
    try {
      await runMigrations(dbCtrl, await loadAllMigrations());
      await runMigrations(dbBat, await loadAllMigrations());

      // Control: N implicit-commit INSERTs (pre-fix path).
      const controlStart = performance.now();
      for (let i = 0; i < N; i++) {
        await dbCtrl.execute(SQL, [1, '2026-03-05', 'CTRL' + i, i, 0, 0]);
      }
      const controlMs = performance.now() - controlStart;

      // Batched: same N inserts wrapped in a single BEGIN/COMMIT.
      const batchedStart = performance.now();
      await dbBat.execute('BEGIN');
      for (let i = 0; i < N; i++) {
        await dbBat.execute(SQL, [1, '2026-03-05', 'BAT' + i, i, 0, 0]);
      }
      await dbBat.execute('COMMIT');
      const batchedMs = performance.now() - batchedStart;

      const speedup = controlMs / batchedMs;
      // eslint-disable-next-line no-console
      console.log(
        `[createMany batching N=${N}, raw DB] control=${controlMs.toFixed(1)}ms batched=${batchedMs.toFixed(1)}ms speedup=${speedup.toFixed(2)}x`,
      );

      // Sanity: both paths produced N rows.
      const c1 = await dbCtrl.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
      const c2 = await dbBat.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
      expect(c1[0].n).toBe(N);
      expect(c2[0].n).toBe(N);
    } finally {
      await dbCtrl.close();
      await dbBat.close();
      rmSync(dirCtrl, { recursive: true, force: true });
      rmSync(dirBat, { recursive: true, force: true });
    }
  });

  it('a Zod-invalid row aborts BEFORE the batch runs so no rows are written', async () => {
    // Poisoning row 7's householdId trips Zod validation inside the statement
    // builder. Because `createMany` now validates+builds every statement
    // BEFORE issuing the batch, the throw happens pre-write: nothing is ever
    // inserted, the error surfaces, and the table is empty. (Same observable
    // contract as the old per-row BEGIN/ROLLBACK, reached one step earlier.)
    const rows = makeRows(20);
    // Cast to any so we can poison the row past TS' type guard.
    (rows[7] as unknown as { householdId: unknown }).householdId = 'not-a-number';

    await expect(repo.createMany(rows)).rejects.toThrow();

    const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(count[0].n, 'partial writes must not leak after a pre-batch validation failure').toBe(0);
  });

  it('rolls the whole batch back on a mid-batch SQL failure (executeBatch atomicity)', async () => {
    // This exercises the atomic primitive itself, not pre-batch validation: a
    // row whose source_account_id points at a non-existent account passes Zod
    // (any number is valid) but fails the FK constraint when the batch runs
    // (SqliteAdapter sets foreign_keys = ON). Because all N inserts run on ONE
    // connection inside a real transaction, the FK error rolls back EVERY row
    // — including the valid ones written earlier in the same batch.
    const rows = makeRows(5);
    // Row 3 references an account id that does not exist → FK violation at
    // INSERT time, deep inside the batch (after rows 0–2 have been written
    // within the same uncommitted transaction).
    rows[3].sourceAccountId = 999999;

    await expect(repo.createMany(rows)).rejects.toThrow();

    const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(count[0].n, 'a mid-batch SQL failure must roll back the entire batch').toBe(0);
  });
});
