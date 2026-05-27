import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Lock the seeded 2026 federal tax data to actual IRS-published values
// (Rev. Proc. 2025-32, Tax Foundation 2026 brackets). The original
// 0002_seed_tax_rules.sql claimed "2026" but seeded Rev. Proc. 2023-34
// (tax year 2024). Migration 0031 fixes this; this test prevents a future
// re-seed migration from re-introducing stale numbers.
//
// Sources:
//   - Tax Foundation 2026 brackets:
//     https://taxfoundation.org/data/all/federal/2026-tax-brackets/
//   - IRS Rev. Proc. 2025-32 (Oct 2025)

function loadAllMigrationsFromDisk() {
  // Read every 0NNN_*.sql in src/db/migrations sorted by version. Doing
  // this on disk (vs. the loader's Vite import) keeps the test runner
  // independent of build-time module resolution.
  const dir = resolve(__dirname, '../../src/db/migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((file) => ({
    version: file.replace(/\.sql$/, ''),
    sql: readFileSync(resolve(dir, file), 'utf-8'),
  }));
}

describe('tax_rules seeded values — real 2026 IRS data', () => {
  let db: SqliteAdapter;

  beforeAll(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, loadAllMigrationsFromDisk());
  });

  afterAll(async () => {
    await db.close();
  });

  describe('federal standard deductions (Rev. Proc. 2025-32)', () => {
    it('SINGLE = $16,100', async () => {
      const rows = await db.select<{ standard_deduction: number }>(
        `SELECT standard_deduction FROM tax_rules
         WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND filing_status = 'SINGLE'`,
      );
      expect(rows[0].standard_deduction).toBe(16100);
    });

    it('MFJ = $32,200', async () => {
      const rows = await db.select<{ standard_deduction: number }>(
        `SELECT standard_deduction FROM tax_rules
         WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND filing_status = 'MFJ'`,
      );
      expect(rows[0].standard_deduction).toBe(32200);
    });

    it('MFS = $16,100', async () => {
      const rows = await db.select<{ standard_deduction: number }>(
        `SELECT standard_deduction FROM tax_rules
         WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND filing_status = 'MFS'`,
      );
      expect(rows[0].standard_deduction).toBe(16100);
    });

    it('HOH = $24,150', async () => {
      const rows = await db.select<{ standard_deduction: number }>(
        `SELECT standard_deduction FROM tax_rules
         WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND filing_status = 'HOH'`,
      );
      expect(rows[0].standard_deduction).toBe(24150);
    });
  });

  describe('federal income tax brackets — bracket top sentinels', () => {
    interface Bracket {
      min: number;
      max: number | null;
      rate: number;
    }
    async function getBrackets(status: string): Promise<Bracket[]> {
      const rows = await db.select<{ brackets: string }>(
        `SELECT brackets FROM tax_rules
         WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND filing_status = ?`,
        [status],
      );
      return JSON.parse(rows[0].brackets) as Bracket[];
    }

    it('SINGLE 10% top = $12,400, 22% top = $105,700, 37% bottom = $640,600', async () => {
      const brackets = await getBrackets('SINGLE');
      expect(brackets[0].rate).toBe(0.10);
      expect(brackets[0].max).toBe(12400);
      // 22% bracket
      const twentyTwo = brackets.find((b) => b.rate === 0.22);
      expect(twentyTwo?.max).toBe(105700);
      // 37% bracket starts at $640,600
      const top = brackets.find((b) => b.rate === 0.37);
      expect(top?.min).toBe(640600);
      expect(top?.max).toBeNull();
    });

    it('MFJ 10% top = $24,800, 22% top = $211,400, 37% bottom = $768,700', async () => {
      const brackets = await getBrackets('MFJ');
      expect(brackets[0].rate).toBe(0.10);
      expect(brackets[0].max).toBe(24800);
      const twentyTwo = brackets.find((b) => b.rate === 0.22);
      expect(twentyTwo?.max).toBe(211400);
      const top = brackets.find((b) => b.rate === 0.37);
      expect(top?.min).toBe(768700);
    });

    it('HOH 10% top = $17,700, 12% top = $67,450', async () => {
      const brackets = await getBrackets('HOH');
      expect(brackets[0].rate).toBe(0.10);
      expect(brackets[0].max).toBe(17700);
      const twelve = brackets.find((b) => b.rate === 0.12);
      expect(twelve?.max).toBe(67450);
    });

    it('MFS shares SINGLE schedule up through 35% (treasury/IRS convention)', async () => {
      const brackets = await getBrackets('MFS');
      expect(brackets[0].max).toBe(12400);
      const twentyTwo = brackets.find((b) => b.rate === 0.22);
      expect(twentyTwo?.max).toBe(105700);
    });
  });

  describe('contribution limits constants — 2026 values', () => {
    it('SS wage base = $184,500 and DCFSA cap = $7,500 (OBBBA)', async () => {
      // Pulled from the in-memory constants file rather than tax_rules.
      const { CONTRIBUTION_LIMITS_2026 } = await import('@/lib/contribution-limits');
      expect(CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE).toBe(184500);
      expect(CONTRIBUTION_LIMITS_2026.DCFSA_MFJ_SINGLE_HOH).toBe(7500);
      expect(CONTRIBUTION_LIMITS_2026.DCFSA_MFS).toBe(3750);
    });
  });
});
