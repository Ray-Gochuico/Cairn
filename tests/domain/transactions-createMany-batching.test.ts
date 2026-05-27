// Regression guard for the P2-A4 Data Architecture finding:
// `TransactionsRepo.createMany` issues N separate INSERTs without a
// surrounding transaction, so each row pays the full SQLite WAL fsync /
// implicit-commit cost.
//
// The strong guard is the structural test (`groups all inserts into a
// single SQL transaction`) which spies on `db.execute` and asserts that
// exactly one BEGIN + one COMMIT bracket all the row INSERTs. This will
// catch a regression that removes the transaction wrap regardless of
// hardware/disk speed.
//
// The perf test is a visibility-only sanity check: it logs the wallclock
// speedup but doesn't gate CI, because wallclock ratios on WAL+APFS are
// inherently noisy under parallel vitest workers. The structural test is
// what guarantees the wrap is present.
//
// We use a tempfile DB (not `:memory:`) because the bug this guards is
// about WAL fsync per-statement on real user databases. In-memory SQLite
// has no fsync, so the speedup there is only ~1x and the test would not
// catch a regression.
//
// Implementation guard: the public API must also remain ergonomic — a
// thrown error from any inner INSERT must ROLLBACK and re-throw so
// partial writes are not visible after the failure.
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

  it('groups all inserts into a single SQL transaction (no per-row commits)', async () => {
    // The most direct guard: the BEGIN/COMMIT wrap must actually be issued.
    // We spy on `db.execute` and assert that exactly one BEGIN + one COMMIT
    // bracket the N INSERT statements (or BEGIN + ROLLBACK on failure).
    // This catches a regression that pure timing might miss on a fast machine.
    const calls: string[] = [];
    const origExecute = db.execute.bind(db);
    db.execute = (sql: string, params?: unknown[]) => {
      calls.push(sql.trim().slice(0, 12).toUpperCase());
      return origExecute(sql, params);
    };

    const rows = makeRows(20);
    await repo.createMany(rows);

    // First call must be BEGIN, last must be COMMIT, all INSERTs in between.
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1);
    const inserts = calls.filter((c) => c.startsWith('INSERT'));
    expect(inserts).toHaveLength(20);
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

  it('ROLLBACKs on a mid-batch failure so no partial rows are visible', async () => {
    // Tampering with row 7 by giving it an invalid householdId trips Zod
    // validation (TransactionSchema is parsed in `create`). The batched
    // transaction should ROLLBACK; the table should still be empty.
    const rows = makeRows(20);
    // Cast to any so we can poison the row past TS' type guard.
    (rows[7] as unknown as { householdId: unknown }).householdId = 'not-a-number';

    await expect(repo.createMany(rows)).rejects.toThrow();

    const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(count[0].n, 'partial writes must not leak after rollback').toBe(0);
  });
});
