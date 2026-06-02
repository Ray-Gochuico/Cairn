import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { SettingsRepo } from '@/domain/app-settings';
import { evaluateAndStampMonthlyPrompt, maybeRedirectToMonthly } from '@/lib/monthly-prompt';
import { MONTHLY_INPUT_GRACE_DAY } from '@/lib/input-pending';

// ─── evaluateAndStampMonthlyPrompt ──────────────────────────────────────────

describe('evaluateAndStampMonthlyPrompt', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('new month, early in month → returns true AND stamps', async () => {
    const today = new Date(2026, 5, 3); // June 3 (within grace)
    expect(await evaluateAndStampMonthlyPrompt(db, today)).toBe(true);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-06');
  });

  it('new month BUT late-month first open → suppress route (false) but STILL stamp', async () => {
    const today = new Date(2026, 5, 14); // June 14 (past grace)
    expect(await evaluateAndStampMonthlyPrompt(db, today)).toBe(false);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-06');
  });

  it('returns false and does not re-stamp on same-month re-open', async () => {
    await new SettingsRepo(db).update({ lastSeenMonth: '2026-06' });
    const today = new Date(2026, 5, 5);
    expect(await evaluateAndStampMonthlyPrompt(db, today)).toBe(false);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-06');
  });

  it('first-ever open (null), early in month → returns true and stamps', async () => {
    const today = new Date(2026, 0, 3); // Jan 3; seed row has NULL
    expect(await evaluateAndStampMonthlyPrompt(db, today)).toBe(true);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-01');
  });

  it('grace boundary — day === MONTHLY_INPUT_GRACE_DAY still routes', async () => {
    const onBoundary = new Date(2026, 5, MONTHLY_INPUT_GRACE_DAY);
    expect(await evaluateAndStampMonthlyPrompt(db, onBoundary)).toBe(true);
  });

  it('grace boundary — day === MONTHLY_INPUT_GRACE_DAY + 1 suppresses', async () => {
    // Need a fresh db for this sub-test since boundary test above stamped
    const db2 = new SqliteAdapter(':memory:');
    await runMigrations(db2, await loadAllMigrations());
    const pastBoundary = new Date(2026, 5, MONTHLY_INPUT_GRACE_DAY + 1);
    expect(await evaluateAndStampMonthlyPrompt(db2, pastBoundary)).toBe(false);
    await db2.close();
  });
});

// ─── maybeRedirectToMonthly ──────────────────────────────────────────────────

function fakeWin(pathname: string) {
  const calls: Array<[unknown, string, string?]> = [];
  return {
    win: {
      location: { pathname },
      history: {
        replaceState: ((s: unknown, t: string, u?: string) => {
          calls.push([s, t, u]);
        }) as History['replaceState'],
      },
    },
    calls,
  };
}

describe('maybeRedirectToMonthly', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('(a) path=/setup → no redirect (first-launch precedence)', async () => {
    const { win, calls } = fakeWin('/setup');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 3), win)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('(b) path=/ + new month, early in month → replaceState to /monthly?from=new-month AND stamps', async () => {
    const { win, calls } = fakeWin('/'); // seed row has NULL last_seen_month
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 3), win)).toBe(true);
    expect(calls).toEqual([[{}, '', '/monthly?from=new-month']]);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-06');
  });

  it('(c) path=/ + same month → no redirect (already stamped)', async () => {
    await new SettingsRepo(db).update({ lastSeenMonth: '2026-06' });
    const { win, calls } = fakeWin('/');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 20), win)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('(c2) path=/ + NEW month but late-month first open → no redirect, but DID stamp (grace suppression)', async () => {
    const { win, calls } = fakeWin('/'); // NULL → new month
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 14), win)).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await new SettingsRepo(db).get()).lastSeenMonth).toBe('2026-06');
  });

  it('(d) stamps exactly once per month at decide-time — a second same-month boot is a no-op', async () => {
    const a = fakeWin('/');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 3), a.win)).toBe(true);
    const b = fakeWin('/');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 4), b.win)).toBe(false);
    expect(b.calls).toHaveLength(0);
  });

  it('path="" (empty string) is treated as root and evaluates', async () => {
    const { win, calls } = fakeWin('');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 3), win)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('path=/monthly → no-op (already on the monthly page)', async () => {
    const { win, calls } = fakeWin('/monthly');
    expect(await maybeRedirectToMonthly(db, new Date(2026, 5, 3), win)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
