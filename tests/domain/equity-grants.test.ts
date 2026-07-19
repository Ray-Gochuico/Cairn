import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { PersonsRepo } from '@/domain/persons';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');
const loadEquityGrantCompanyValuationMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0027_equity_grant_company_valuation.sql'), 'utf-8');
const loadEquityGrantTypeMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0044_equity_grant_type.sql'), 'utf-8');

const seedPerson = async (
  personsRepo: PersonsRepo,
  name = 'Alex',
): Promise<number> => {
  return personsRepo.create({
    householdId: 1,
    name,
    dateOfBirth: '1988-03-15',
    targetRetirementAge: 55,
    annualSalaryPretax: 140000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    pretax401kPct: 0.10,
    healthInsuranceMonthlyPremium: 250,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 300,
    hsaEligible: true,
  });
};

const standardVestingSchedule = [
  { date: '2024-01-15', cumulativePct: 0.25 },
  { date: '2025-01-15', cumulativePct: 0.50 },
  { date: '2026-01-15', cumulativePct: 0.75 },
  { date: '2027-01-15', cumulativePct: 1.0 },
];

const makeGrant = async (
  repo: EquityGrantsRepo,
  ownerPersonId: number,
  overrides: Partial<Parameters<EquityGrantsRepo['create']>[0]> = {},
): Promise<number> => {
  return repo.create({
    householdId: 1,
    ownerPersonId,
    name: 'New Hire RSU Grant',
    companyName: 'Acme Corp',
    grantDate: '2023-01-15',
    strikePrice: 0,
    totalShares: 1200,
    vestingSchedule: standardVestingSchedule,
    currentFmv: 145.50,
    grantType: 'RSU',
    ...overrides,
  });
};

describe('EquityGrantsRepo', () => {
  let db: SqliteAdapter;
  let repo: EquityGrantsRepo;
  let personsRepo: PersonsRepo;
  let personId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0027_equity_grant_company_valuation', sql: loadEquityGrantCompanyValuationMigration() },
      { version: '0044_equity_grant_type', sql: loadEquityGrantTypeMigration() },
    ]);
    repo = new EquityGrantsRepo(db);
    personsRepo = new PersonsRepo(db);
    personId = await seedPerson(personsRepo);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty list when no grants exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a grant and returns its id', async () => {
    const id = await makeGrant(repo, personId);
    expect(id).toBeGreaterThan(0);
  });

  it('lists grants in id order', async () => {
    const a = await makeGrant(repo, personId, { name: 'Grant A' });
    const b = await makeGrant(repo, personId, { name: 'Grant B', companyName: 'Beta Co' });
    const c = await makeGrant(repo, personId, { name: 'Grant C', companyName: 'Gamma Inc' });

    const all = await repo.list();
    expect(all).toHaveLength(3);
    expect(all.map((g) => g.id)).toEqual([a, b, c]);
    expect(all.map((g) => g.name)).toEqual(['Grant A', 'Grant B', 'Grant C']);
    expect(all[1].companyName).toBe('Beta Co');
    expect(all[2].companyName).toBe('Gamma Inc');
  });

  it('finds a grant by id', async () => {
    const id = await makeGrant(repo, personId, {
      name: 'Performance Grant',
      companyName: 'Initech',
      strikePrice: 12.34,
      totalShares: 500,
      currentFmv: 99.99,
    });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Performance Grant');
    expect(found?.companyName).toBe('Initech');
    expect(found?.strikePrice).toBe(12.34);
    expect(found?.totalShares).toBe(500);
    expect(found?.currentFmv).toBe(99.99);
    expect(found?.grantDate).toBe('2023-01-15');
    expect(found?.ownerPersonId).toBe(personId);
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(9999)).toBeNull();
  });

  it('lists grants for a specific person', async () => {
    const personA = personId;
    const personB = await seedPerson(personsRepo, 'Bailey');

    await makeGrant(repo, personA, { name: 'A1' });
    await makeGrant(repo, personB, { name: 'B1' });
    await makeGrant(repo, personA, { name: 'A2' });

    const aGrants = await repo.listForPerson(personA);
    expect(aGrants).toHaveLength(2);
    expect(aGrants.map((g) => g.name)).toEqual(['A1', 'A2']);
    expect(aGrants.every((g) => g.ownerPersonId === personA)).toBe(true);

    const bGrants = await repo.listForPerson(personB);
    expect(bGrants).toHaveLength(1);
    expect(bGrants[0].name).toBe('B1');
    expect(bGrants[0].ownerPersonId).toBe(personB);
  });

  it('listForPerson returns empty array when no grants for that person', async () => {
    expect(await repo.listForPerson(personId)).toEqual([]);
  });

  it('updates a grant FMV (and round-trips vestingSchedule unchanged)', async () => {
    const id = await makeGrant(repo, personId);
    await repo.update(id, { currentFmv: 200.25 });

    const updated = await repo.findById(id);
    expect(updated?.currentFmv).toBe(200.25);
    // Other fields unchanged
    expect(updated?.name).toBe('New Hire RSU Grant');
    expect(updated?.totalShares).toBe(1200);
    // vestingSchedule round-trips byte-for-byte
    expect(updated?.vestingSchedule).toEqual(standardVestingSchedule);
  });

  it('updates a grant vestingSchedule and persists the new schedule', async () => {
    const id = await makeGrant(repo, personId);
    const newSchedule = [
      { date: '2024-06-01', cumulativePct: 0.10 },
      { date: '2025-06-01', cumulativePct: 0.40 },
      { date: '2026-06-01', cumulativePct: 0.70 },
      { date: '2027-06-01', cumulativePct: 1.0 },
    ];
    await repo.update(id, { vestingSchedule: newSchedule });

    const updated = await repo.findById(id);
    expect(updated?.vestingSchedule).toEqual(newSchedule);
    // FMV unchanged
    expect(updated?.currentFmv).toBe(145.50);
  });

  it('deletes a grant', async () => {
    const id = await makeGrant(repo, personId);
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
    expect(await repo.findById(id)).toBeNull();
  });

  it('round-trips a multi-row vestingSchedule through findById', async () => {
    const detailedSchedule = [
      { date: '2024-01-15', cumulativePct: 0.0625 },
      { date: '2024-04-15', cumulativePct: 0.125 },
      { date: '2024-07-15', cumulativePct: 0.1875 },
      { date: '2024-10-15', cumulativePct: 0.25 },
      { date: '2025-01-15', cumulativePct: 0.3125 },
      { date: '2025-04-15', cumulativePct: 0.375 },
      { date: '2025-07-15', cumulativePct: 0.4375 },
      { date: '2025-10-15', cumulativePct: 0.50 },
      { date: '2026-01-15', cumulativePct: 0.5625 },
      { date: '2026-04-15', cumulativePct: 0.625 },
      { date: '2026-07-15', cumulativePct: 0.6875 },
      { date: '2026-10-15', cumulativePct: 0.75 },
      { date: '2027-01-15', cumulativePct: 0.8125 },
      { date: '2027-04-15', cumulativePct: 0.875 },
      { date: '2027-07-15', cumulativePct: 0.9375 },
      { date: '2027-10-15', cumulativePct: 1.0 },
    ];
    const id = await makeGrant(repo, personId, { vestingSchedule: detailedSchedule });

    const found = await repo.findById(id);
    expect(found?.vestingSchedule).toEqual(detailedSchedule);
    expect(found?.vestingSchedule).toHaveLength(16);

    // list() should round-trip identically too
    const all = await repo.list();
    expect(all[0].vestingSchedule).toEqual(detailedSchedule);
  });

  it('rejects invalid vesting schedule on create (non-monotonic dates)', async () => {
    await expect(
      makeGrant(repo, personId, {
        vestingSchedule: [
          { date: '2025-01-15', cumulativePct: 0.25 },
          { date: '2024-01-15', cumulativePct: 0.50 },  // earlier date after later
          { date: '2026-01-15', cumulativePct: 1.0 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid vesting schedule on create (does not reach 1.0)', async () => {
    await expect(
      makeGrant(repo, personId, {
        vestingSchedule: [
          { date: '2024-01-15', cumulativePct: 0.25 },
          { date: '2025-01-15', cumulativePct: 0.50 },
          { date: '2026-01-15', cumulativePct: 0.75 },
          // missing the 1.0 entry
        ],
      }),
    ).rejects.toThrow();
  });

  it('rejects empty companyName on create', async () => {
    await expect(
      makeGrant(repo, personId, { companyName: '' }),
    ).rejects.toThrow();
  });

  it('D9 (Wave 18): exposes updated_at as a read-only updatedAt string on list + findById', async () => {
    const id = await makeGrant(repo, personId);
    const listed = await repo.list();
    expect(typeof listed[0]?.updatedAt).toBe('string');
    expect(listed[0]!.updatedAt!.length).toBeGreaterThan(0);
    const found = await repo.findById(id);
    expect(typeof found?.updatedAt).toBe('string');
    // The UPDATE path refreshes the stamp column (no crash on write either —
    // the optional field never feeds the write statements).
    await repo.update(id, { currentFmv: 123 });
    const after = await repo.findById(id);
    expect(typeof after?.updatedAt).toBe('string');
  });

  it('round-trips the three calculator fields through create + findById', async () => {
    const id = await makeGrant(repo, personId, {
      companyValuation: 10_000_000,
      companyOutstandingShares: 5_000_000,
      companyTotalDebt: 2_000_000,
    });
    const out = await repo.findById(id);
    expect(out?.companyValuation).toBe(10_000_000);
    expect(out?.companyOutstandingShares).toBe(5_000_000);
    expect(out?.companyTotalDebt).toBe(2_000_000);
  });

  it('persists nulls when calculator fields are omitted', async () => {
    const id = await makeGrant(repo, personId);
    const out = await repo.findById(id);
    expect(out?.companyValuation).toBeNull();
    expect(out?.companyOutstandingShares).toBeNull();
    expect(out?.companyTotalDebt).toBeNull();
  });

  it('persists explicit nulls when calculator fields are passed as null', async () => {
    const id = await makeGrant(repo, personId, {
      companyValuation: null,
      companyOutstandingShares: null,
      companyTotalDebt: null,
    });
    const out = await repo.findById(id);
    expect(out?.companyValuation).toBeNull();
    expect(out?.companyOutstandingShares).toBeNull();
    expect(out?.companyTotalDebt).toBeNull();
  });

  it('updates the calculator fields via update()', async () => {
    const id = await makeGrant(repo, personId);
    await repo.update(id, {
      companyValuation: 5_000_000,
      companyOutstandingShares: 1_000_000,
      companyTotalDebt: 0,
    });
    const out = await repo.findById(id);
    expect(out?.companyValuation).toBe(5_000_000);
    expect(out?.companyOutstandingShares).toBe(1_000_000);
    expect(out?.companyTotalDebt).toBe(0);
    // Other persisted fields unchanged
    expect(out?.currentFmv).toBe(145.50);
    expect(out?.totalShares).toBe(1200);
  });

  it('list() round-trips the three calculator fields', async () => {
    await makeGrant(repo, personId, {
      name: 'With calculator',
      companyValuation: 12_345_678,
      companyOutstandingShares: 1_234_567,
      companyTotalDebt: 123_456,
    });
    const [out] = await repo.list();
    expect(out.companyValuation).toBe(12_345_678);
    expect(out.companyOutstandingShares).toBe(1_234_567);
    expect(out.companyTotalDebt).toBe(123_456);
  });

  it('listForPerson() round-trips the three calculator fields', async () => {
    await makeGrant(repo, personId, {
      name: 'Per-person',
      companyValuation: 9_000_000,
      companyOutstandingShares: 3_000_000,
      companyTotalDebt: 1_000_000,
    });
    const [out] = await repo.listForPerson(personId);
    expect(out.companyValuation).toBe(9_000_000);
    expect(out.companyOutstandingShares).toBe(3_000_000);
    expect(out.companyTotalDebt).toBe(1_000_000);
  });
});
