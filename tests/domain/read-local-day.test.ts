/**
 * C046 (v1.8.0 W4): "not in the future" is a WRITE rule. Re-checked on every
 * read, one row dated past the reading machine's local day (entered while a
 * time zone ahead, or under a clock later corrected backward) threw inside
 * list() and emptied the whole list. The six rowTo* mappers now parse with
 * read schemas; every write path keeps the cap. Clock-free: a row moved past
 * today is dated 2999-12-31 by raw SQL, and the zone case fakes Date only, at
 * literal instants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { ContributionsRepo } from '@/domain/contributions';
import { VehiclesRepo } from '@/domain/vehicles';
import { PropertiesRepo } from '@/domain/properties';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { PersonsRepo } from '@/domain/persons';
import { DependentsRepo } from '@/domain/dependents';
import { useContributionsStore } from '@/stores/contributions-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { localTodayISO } from '@/lib/dates';
import { ContributionSource } from '@/types/enums';
import { makeAccount, makeDependent, makeEquityGrant, makePerson, makeProperty, makeVehicle } from '../factories';

const AHEAD = '2999-12-31';
const ORIGINAL_TZ = process.env.TZ;

describe('C046: a row dated past today still loads (the cap is checked on write only)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    // The capped writes and every load() read the local day: pin it (CR-W4-6).
    // The Tokyo case moves the clock itself.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00'));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    await db.close();
  });

  it('contributions: one row dated ahead does not hide the others (the store loads 3 of 3, no error)', async () => {
    const acct = await new AccountsRepo(db).create(makeAccount({ name: '401k' }));
    for (const date of ['2026-09-15', '2026-10-15', AHEAD]) {
      await db.execute(
        "INSERT INTO contributions (account_id, person_id, date, amount, source) VALUES (?, NULL, ?, 500, 'PAYCHECK')",
        [acct, date],
      );
    }
    await useContributionsStore.getState().load();
    const s = useContributionsStore.getState();
    expect({ loaded: s.contributions.length, error: s.error }).toEqual({ loaded: 3, error: null });
  });

  it('vehicles: the store loads 2 of 2 when one purchase date is ahead', async () => {
    const repo = new VehiclesRepo(db);
    await repo.create(makeVehicle({ name: 'Daily driver', purchaseDate: '2021-05-01' }));
    const ahead = await repo.create(makeVehicle({ name: 'New car', purchaseDate: '2026-11-01' }));
    await db.execute('UPDATE vehicles SET purchase_date = ? WHERE id = ?', [AHEAD, ahead]);
    await useVehiclesStore.getState().load();
    const s = useVehiclesStore.getState();
    expect({ loaded: s.vehicles.length, error: s.error }).toEqual({ loaded: 2, error: null });
  });

  it('a Tokyo-day entry written through the repo still loads in Los Angeles before LA reaches that day', async () => {
    const acct = await new AccountsRepo(db).create(makeAccount({ name: '401k' }));
    const repo = new ContributionsRepo(db);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    await repo.create({ accountId: acct, personId: null, date: '2026-09-15', amount: 500, source: ContributionSource.PAYCHECK });
    await repo.create({ accountId: acct, personId: null, date: '2026-10-01', amount: 500, source: ContributionSource.PAYCHECK });
    // 2026-11-15 01:00 in Tokyo is 2026-11-14 16:00Z: the repo accepts "today".
    process.env.TZ = 'Asia/Tokyo';
    vi.setSystemTime(new Date('2026-11-14T16:00:00Z'));
    const tokyoToday = localTodayISO();
    await repo.create({ accountId: acct, personId: null, date: tokyoToday, amount: 750, source: ContributionSource.PAYCHECK });
    // 2026-11-15T02:00Z is 2026-11-14 18:00 in Los Angeles.
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-11-15T02:00:00Z'));
    const laToday = localTodayISO();
    await useContributionsStore.getState().load();
    const s = useContributionsStore.getState();
    expect({ tokyoToday, laToday, loaded: s.contributions.length, error: s.error })
      .toEqual({ tokyoToday: '2026-11-15', laToday: '2026-11-14', loaded: 3, error: null });
  });

  it('persons: list() returns a person whose date of birth is ahead', async () => {
    const repo = new PersonsRepo(db);
    await repo.create(makePerson({ name: 'Alex', dateOfBirth: '1990-01-01' }));
    const id = await repo.create(makePerson({ name: 'Sam', dateOfBirth: '1992-02-02' }));
    await db.execute('UPDATE persons SET date_of_birth = ? WHERE id = ?', [AHEAD, id]);
    const list = await repo.list();
    expect([list.length, list.find((p) => p.id === id)?.dateOfBirth]).toEqual([2, AHEAD]);
  });

  it('dependents: list() returns a dependent whose date of birth is ahead', async () => {
    const repo = new DependentsRepo(db);
    await repo.create(makeDependent({ name: 'Riley', dateOfBirth: '2016-05-12' }));
    const id = await repo.create(makeDependent({ name: 'Jo', dateOfBirth: '2020-03-03' }));
    await db.execute('UPDATE dependents SET date_of_birth = ? WHERE id = ?', [AHEAD, id]);
    const list = await repo.list();
    expect([list.length, list.find((d) => d.id === id)?.dateOfBirth]).toEqual([2, AHEAD]);
  });

  it('properties: list() returns a property whose purchase date is ahead', async () => {
    const repo = new PropertiesRepo(db);
    await repo.create(makeProperty({ name: 'Home', purchaseDate: '2019-06-01' }));
    const id = await repo.create(makeProperty({ name: 'Cabin', purchaseDate: '2026-10-01' }));
    await db.execute('UPDATE properties SET purchase_date = ? WHERE id = ?', [AHEAD, id]);
    const list = await repo.list();
    expect([list.length, list.find((p) => p.id === id)?.purchaseDate]).toEqual([2, AHEAD]);
  });

  it('equity grants: list() returns a grant whose grant date is ahead', async () => {
    const owner = await new PersonsRepo(db).create(makePerson({ name: 'Alex', dateOfBirth: '1990-01-01' }));
    const repo = new EquityGrantsRepo(db);
    await repo.create(makeEquityGrant({ ownerPersonId: owner, name: 'RSU 2024', grantDate: '2024-03-01' }));
    const id = await repo.create(makeEquityGrant({ ownerPersonId: owner, name: 'RSU 2026', grantDate: '2026-10-01' }));
    await db.execute('UPDATE equity_grants SET grant_date = ? WHERE id = ?', [AHEAD, id]);
    const list = await repo.list();
    expect([list.length, list.find((g) => g.id === id)?.grantDate]).toEqual([2, AHEAD]);
  });

  it('the write rule is unchanged: creating a contribution dated ahead is still refused', async () => {
    const acct = await new AccountsRepo(db).create(makeAccount({ name: '401k' }));
    await expect(
      new ContributionsRepo(db).create({ accountId: acct, personId: null, date: AHEAD, amount: 1, source: ContributionSource.PAYCHECK }),
    ).rejects.toThrow('Date cannot be in the future');
  });
});
