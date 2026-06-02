import type { BatchStatement, Database } from '@/db/db';
import { EquityGrantSchema, type EquityGrant } from '@/types/schema';
import type { GrantType } from '@/types/enums';

// Note on schema/SQL asymmetry: company_name is TEXT (nullable) at the SQL
// level but z.string().min(1) (required, non-empty) in the Zod schema. Since
// every write in this app goes through EquityGrantSchema.parse(), the nullable
// SQL column is never written as NULL in practice — but a row inserted via
// raw SQL (or a malformed migration) could be NULL. We pass company_name
// straight through to Zod, which will reject NULL with a clear error message.
// That is more debuggable than silently coercing to "" (which would hide
// the malformed row).
interface EquityGrantRow {
  id: number;
  household_id: number;
  owner_person_id: number;
  name: string;
  company_name: string | null;
  grant_date: string;
  strike_price: number;
  total_shares: number;
  vesting_schedule: string; // JSON-encoded VestingEntry[]
  current_fmv: number;
  // Grant-type discriminator (migration 0044). NOT NULL DEFAULT 'RSU' at the
  // SQL level; the CHECK guarantees one of RSU/ISO/NSO.
  grant_type: string;
  // Calculator inputs (migration 0027). All nullable — populated only when
  // the user used the in-form company-valuation helper.
  company_valuation: number | null;
  company_outstanding_shares: number | null;
  company_total_debt: number | null;
}

function rowToEquityGrant(row: EquityGrantRow): EquityGrant {
  // vesting_schedule is JSON-encoded; tolerate malformed/non-array payloads
  // by falling back to []. Schema validation below will reject anything that
  // doesn't satisfy the monotonicity + ends-at-1.0 refinements.
  let schedule: unknown[] = [];
  try {
    const parsed = JSON.parse(row.vesting_schedule);
    if (Array.isArray(parsed)) {
      schedule = parsed;
    }
  } catch {
    // leave as []
  }
  return EquityGrantSchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    name: row.name,
    companyName: row.company_name,
    grantDate: row.grant_date,
    strikePrice: row.strike_price,
    totalShares: row.total_shares,
    vestingSchedule: schedule,
    currentFmv: row.current_fmv,
    grantType: row.grant_type as GrantType,
    companyValuation: row.company_valuation,
    companyOutstandingShares: row.company_outstanding_shares,
    companyTotalDebt: row.company_total_debt,
  });
}

export class EquityGrantsRepo {
  constructor(private db: Database) {}

  async list(): Promise<EquityGrant[]> {
    const rows = await this.db.select<EquityGrantRow>(
      'SELECT * FROM equity_grants ORDER BY id ASC'
    );
    return rows.map(rowToEquityGrant);
  }

  async findById(id: number): Promise<EquityGrant | null> {
    const rows = await this.db.select<EquityGrantRow>(
      'SELECT * FROM equity_grants WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToEquityGrant(rows[0]);
  }

  /**
   * List all grants for a specific person. Used by the Equity Grants page
   * filter so the user can scope the table to one owner at a time.
   */
  async listForPerson(personId: number): Promise<EquityGrant[]> {
    const rows = await this.db.select<EquityGrantRow>(
      'SELECT * FROM equity_grants WHERE owner_person_id = ? ORDER BY id ASC',
      [personId]
    );
    return rows.map(rowToEquityGrant);
  }

  /**
   * Validate (Zod) and build the INSERT statement for one grant WITHOUT
   * executing. `create` executes it and returns the new id; import-commit
   * collects builders from many rows into one atomic `executeBatch`.
   *
   * Zod parse fills in defaults (e.g. companyValuation -> null when caller
   * omits the key), then we destructure the validated payload into the
   * INSERT. This avoids `undefined` reaching better-sqlite3 (which rejects
   * it) when callers leave the calculator fields off.
   */
  buildCreateStatement(grant: Omit<EquityGrant, 'id'>): BatchStatement {
    const parsed = EquityGrantSchema.omit({ id: true }).parse(grant);
    return {
      sql: `INSERT INTO equity_grants (
        household_id, owner_person_id, name, company_name,
        grant_date, strike_price, total_shares, vesting_schedule, current_fmv,
        grant_type,
        company_valuation, company_outstanding_shares, company_total_debt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        parsed.householdId,
        parsed.ownerPersonId,
        parsed.name,
        parsed.companyName,
        parsed.grantDate,
        parsed.strikePrice,
        parsed.totalShares,
        JSON.stringify(parsed.vestingSchedule),
        parsed.currentFmv,
        parsed.grantType,
        parsed.companyValuation,
        parsed.companyOutstandingShares,
        parsed.companyTotalDebt,
      ],
    };
  }

  async create(grant: Omit<EquityGrant, 'id'>): Promise<number> {
    const { sql, params } = this.buildCreateStatement(grant);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create equity grant: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  /**
   * Read the existing row, merge the patch, Zod-validate, and build the
   * UPDATE statement WITHOUT executing. The READ stays here (batched callers
   * keep it outside the atomic write set); only the write statement is
   * batched. Throws if the id does not exist.
   */
  async buildUpdateStatement(
    id: number,
    patch: Partial<Omit<EquityGrant, 'id' | 'householdId'>>
  ): Promise<BatchStatement> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`EquityGrant ${id} not found`);
    const merged = { ...existing, ...patch };
    EquityGrantSchema.parse(merged);

    return {
      sql: `UPDATE equity_grants SET
        owner_person_id = ?,
        name = ?,
        company_name = ?,
        grant_date = ?,
        strike_price = ?,
        total_shares = ?,
        vesting_schedule = ?,
        current_fmv = ?,
        grant_type = ?,
        company_valuation = ?,
        company_outstanding_shares = ?,
        company_total_debt = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params: [
        merged.ownerPersonId,
        merged.name,
        merged.companyName,
        merged.grantDate,
        merged.strikePrice,
        merged.totalShares,
        JSON.stringify(merged.vestingSchedule),
        merged.currentFmv,
        merged.grantType,
        merged.companyValuation,
        merged.companyOutstandingShares,
        merged.companyTotalDebt,
        id,
      ],
    };
  }

  async update(
    id: number,
    patch: Partial<Omit<EquityGrant, 'id' | 'householdId'>>
  ): Promise<void> {
    const { sql, params } = await this.buildUpdateStatement(id, patch);
    await this.db.execute(sql, params);
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM equity_grants WHERE id = ?', [id]);
  }
}
