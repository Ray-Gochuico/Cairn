import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { PropertiesRepo } from '@/domain/properties';
import { commitPropertyImport } from '@/lib/import/commit/property';
import type { PropertyResolved } from '@/lib/import/validators/property';
import type { PreviewRow } from '@/lib/import/types';
import { PropertyType } from '@/types/enums';

function baseResolved(name: string): PropertyResolved {
  return {
    householdId: 1,
    ownerPersonId: null,
    name,
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 500000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  };
}

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: PropertyResolved,
  existingId?: number,
): PreviewRow<PropertyResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitPropertyImport', () => {
  let db: SqliteAdapter;
  let repo: PropertiesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new PropertiesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts new properties', async () => {
    const res = await commitPropertyImport(
      [makeRow(0, 'new', baseResolved('Main')), makeRow(1, 'new', baseResolved('Cabin'))],
      { db, properties: repo, householdId: 1 },
    );
    expect(res.inserted).toBe(2);
  });

  it('updates an existing property on status=update', async () => {
    const id = await repo.create(baseResolved('Main'));
    const next = baseResolved('Main');
    next.currentEstimatedValue = 800000;
    const res = await commitPropertyImport(
      [makeRow(0, 'update', next, id)],
      { db, properties: repo, householdId: 1 },
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.currentEstimatedValue).toBe(800000);
  });
});
