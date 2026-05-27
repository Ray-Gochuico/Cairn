import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Migration 0032 seeds 2026 LTCG (0% / 15% / 20%) brackets into tax_rules
// under jurisdiction_type = 'FEDERAL_LTCG'. This test pins the breakpoints
// to the values Tax Foundation publishes for 2026 (mirroring IRS Rev. Proc.
// 2025-32). Catches accidental drift in a future re-seed migration.
//
// Source: https://taxfoundation.org/data/all/federal/2026-tax-brackets/

interface Bracket {
  min: number;
  max: number | null;
  rate: number;
}

function loadAllMigrationsFromDisk() {
  const dir = resolve(__dirname, '../../src/db/migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((file) => ({
    version: file.replace(/\.sql$/, ''),
    sql: readFileSync(resolve(dir, file), 'utf-8'),
  }));
}

describe('tax_rules — 2026 LTCG brackets (FEDERAL_LTCG)', () => {
  let db: SqliteAdapter;

  beforeAll(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, loadAllMigrationsFromDisk());
  });

  afterAll(async () => {
    await db.close();
  });

  async function ltcg(filingStatus: string): Promise<Bracket[]> {
    const rows = await db.select<{ brackets: string }>(
      `SELECT brackets FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'
       AND jurisdiction_code = 'US' AND filing_status = ?`,
      [filingStatus],
    );
    expect(rows.length).toBe(1);
    return JSON.parse(rows[0].brackets) as Bracket[];
  }

  it('SINGLE: 0% to $49,450; 15% to $545,500; 20% above', async () => {
    const b = await ltcg('SINGLE');
    expect(b).toEqual([
      { min: 0,      max: 49450,  rate: 0.0 },
      { min: 49450,  max: 545500, rate: 0.15 },
      { min: 545500, max: null,   rate: 0.20 },
    ]);
  });

  it('MFJ: 0% to $98,900; 15% to $613,700; 20% above', async () => {
    const b = await ltcg('MFJ');
    expect(b).toEqual([
      { min: 0,      max: 98900,  rate: 0.0 },
      { min: 98900,  max: 613700, rate: 0.15 },
      { min: 613700, max: null,   rate: 0.20 },
    ]);
  });

  it('HOH: 0% to $66,200; 15% to $579,600; 20% above', async () => {
    const b = await ltcg('HOH');
    expect(b).toEqual([
      { min: 0,      max: 66200,  rate: 0.0 },
      { min: 66200,  max: 579600, rate: 0.15 },
      { min: 579600, max: null,   rate: 0.20 },
    ]);
  });

  it('MFS: half-MFJ — 0% to $49,450; 15% to $306,850; 20% above', async () => {
    const b = await ltcg('MFS');
    expect(b).toEqual([
      { min: 0,      max: 49450,  rate: 0.0 },
      { min: 49450,  max: 306850, rate: 0.15 },
      { min: 306850, max: null,   rate: 0.20 },
    ]);
  });

  it('seeds standard_deduction = 0 (LTCG schedule stacks on ordinary post-SD)', async () => {
    const rows = await db.select<{ standard_deduction: number }>(
      `SELECT standard_deduction FROM tax_rules
       WHERE year = 2026 AND jurisdiction_type = 'FEDERAL_LTCG'`,
    );
    expect(rows.length).toBe(4); // SINGLE, MFJ, MFS, HOH
    rows.forEach((r) => expect(r.standard_deduction).toBe(0));
  });
});
