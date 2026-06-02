import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { evaluateAndStampMonthlyPrompt } from '@/lib/monthly-prompt';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('monthly-prompt boot safety', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });
  afterEach(async () => {
    await db.close();
  });

  it('latches within a month — a second boot the SAME month does not re-fire', async () => {
    expect(await evaluateAndStampMonthlyPrompt(db, new Date(2026, 5, 5))).toBe(true);  // first boot fires
    expect(await evaluateAndStampMonthlyPrompt(db, new Date(2026, 5, 6))).toBe(false); // re-open same month: latched off
    // NOTE: this React-free, stamp-idempotent design is precisely what lets us
    // AVOID the component-level latch the boot-gate-loop class requires; see the
    // canonical latch reference at src/legal/AppDisclaimerGate.tsx:69-76.
  });

  // PRIMARY guard — behavioral select()/execute() spy on the real adapter.
  it('touches ONLY app_settings at decide-time (no heavy boot compute)', async () => {
    const sqls: string[] = [];
    const realSelect = SqliteAdapter.prototype.select;
    const realExecute = SqliteAdapter.prototype.execute;

    const selectSpy = vi.spyOn(db, 'select').mockImplementation(async function (
      this: SqliteAdapter,
      sql: string,
      params?: unknown[],
    ) {
      sqls.push(sql);
      // delegate to the real impl so SettingsRepo.get() still returns the seed row
      return realSelect.call(this, sql, params as unknown[]);
    });
    const execSpy = vi.spyOn(db, 'execute').mockImplementation(async function (
      this: SqliteAdapter,
      sql: string,
      params?: unknown[],
    ) {
      sqls.push(sql);
      return realExecute.call(this, sql, params as unknown[]);
    });

    await evaluateAndStampMonthlyPrompt(db, new Date(2026, 5, 5)); // new month → read + stamp

    expect(sqls.length).toBeGreaterThan(0);
    // Every statement the orchestrator issued must hit app_settings only…
    for (const s of sqls) expect(s).toMatch(/app_settings/i);
    // …and NONE may touch the heavy tables isMonthlyInputPending would read.
    expect(
      sqls.some((s) => /account_snapshots|\bloans\b|\bholdings\b|\baccounts\b/i.test(s)),
    ).toBe(false);

    selectSpy.mockRestore();
    execSpy.mockRestore();
  });

  // SUPPLEMENTARY belt-and-suspenders — static source guard (NOT the primary coverage).
  it('(supplementary) orchestrator source imports no Zustand store and never calls isMonthlyInputPending', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/lib/monthly-prompt.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/@\/stores\//); // boot-gate-loop class is component+store; stay store-free
    expect(src).not.toMatch(/isMonthlyInputPending/); // heavy compute must never be wired into the boot read
  });
});
