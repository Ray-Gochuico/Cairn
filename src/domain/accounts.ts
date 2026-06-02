import type { BatchStatement, Database } from '@/db/db';
import { AccountSchema, type Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

interface AccountRow {
  id: number;
  household_id: number;
  owner_person_id: number | null;
  beneficiary_dependent_id: number | null;
  name: string;
  institution: string | null;
  type: AccountType;
  crypto_wallet_address: string | null;
  auto_fetch_enabled: number;
  excluded_from_net_worth: number;
  allow_margin: number;
  state_of_plan: string | null;
  accent_color: string | null;
  has_employer_match: number | null;
  employer_match_pct: number | null;
  employer_match_limit_pct: number | null;
  allows_mega_backdoor_rollover: number | null;
  has_high_fees: number | null;
  apy_rate: number | null;
}

function nullableBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
}

/**
 * Map nullable boolean → SQLite INTEGER (0/1) or NULL for write side.
 * Inverse of {@link nullableBool}.
 */
function boolToInt(v: boolean | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function rowToAccount(row: AccountRow): Account {
  return AccountSchema.parse({
    id: row.id,
    householdId: row.household_id,
    ownerPersonId: row.owner_person_id,
    beneficiaryDependentId: row.beneficiary_dependent_id,
    name: row.name,
    institution: row.institution,
    type: row.type,
    cryptoWalletAddress: row.crypto_wallet_address,
    autoFetchEnabled: row.auto_fetch_enabled === 1,
    excludedFromNetWorth: row.excluded_from_net_worth === 1,
    allowMargin: row.allow_margin === 1,
    stateOfPlan: row.state_of_plan,
    accentColor: row.accent_color ?? null,
    hasEmployerMatch: nullableBool(row.has_employer_match),
    employerMatchPct: row.employer_match_pct,
    employerMatchLimitPct: row.employer_match_limit_pct,
    allowsMegaBackdoorRollover: nullableBool(row.allows_mega_backdoor_rollover),
    hasHighFees: nullableBool(row.has_high_fees),
    apyRate: row.apy_rate,
  });
}

export class AccountsRepo {
  constructor(private db: Database) {}

  async list(): Promise<Account[]> {
    const rows = await this.db.select<AccountRow>(
      'SELECT * FROM accounts ORDER BY id ASC'
    );
    return rows.map(rowToAccount);
  }

  async findById(id: number): Promise<Account | null> {
    const rows = await this.db.select<AccountRow>(
      'SELECT * FROM accounts WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToAccount(rows[0]);
  }

  /**
   * Validate (Zod) and build the INSERT statement for one account WITHOUT
   * executing. `create` executes it and returns the new id; import-commit
   * collects builders from many rows into one atomic `executeBatch`.
   */
  buildCreateStatement(account: Omit<Account, 'id'>): BatchStatement {
    AccountSchema.omit({ id: true }).parse(account);
    return {
      sql: `INSERT INTO accounts (
        household_id, owner_person_id, beneficiary_dependent_id,
        name, institution, type, crypto_wallet_address,
        auto_fetch_enabled, excluded_from_net_worth, allow_margin, state_of_plan,
        accent_color, apy_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        account.householdId,
        account.ownerPersonId ?? null,
        account.beneficiaryDependentId ?? null,
        account.name,
        account.institution ?? null,
        account.type,
        account.cryptoWalletAddress ?? null,
        account.autoFetchEnabled ? 1 : 0,
        account.excludedFromNetWorth ? 1 : 0,
        account.allowMargin ? 1 : 0,
        account.stateOfPlan ?? null,
        account.accentColor ?? null,
        account.apyRate ?? null,
      ],
    };
  }

  async create(account: Omit<Account, 'id'>): Promise<number> {
    const { sql, params } = this.buildCreateStatement(account);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create account: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  /**
   * Read the existing row, merge the patch, Zod-validate, and build the
   * UPDATE statement WITHOUT executing. The READ stays here (callers that
   * batch keep it outside the atomic write set); only the returned write
   * statement goes into a batch. Throws if the id does not exist.
   */
  async buildUpdateStatement(
    id: number,
    patch: Partial<Omit<Account, 'id' | 'householdId'>>
  ): Promise<BatchStatement> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Account ${id} not found`);
    const merged = { ...existing, ...patch };
    AccountSchema.parse(merged);

    return {
      sql: `UPDATE accounts SET
        owner_person_id = ?,
        beneficiary_dependent_id = ?,
        name = ?,
        institution = ?,
        type = ?,
        crypto_wallet_address = ?,
        auto_fetch_enabled = ?,
        excluded_from_net_worth = ?,
        allow_margin = ?,
        state_of_plan = ?,
        accent_color = ?,
        apy_rate = ?,
        has_employer_match = ?,
        employer_match_pct = ?,
        employer_match_limit_pct = ?,
        allows_mega_backdoor_rollover = ?,
        has_high_fees = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params: [
        merged.ownerPersonId ?? null,
        merged.beneficiaryDependentId ?? null,
        merged.name,
        merged.institution ?? null,
        merged.type,
        merged.cryptoWalletAddress ?? null,
        merged.autoFetchEnabled ? 1 : 0,
        merged.excludedFromNetWorth ? 1 : 0,
        merged.allowMargin ? 1 : 0,
        merged.stateOfPlan ?? null,
        merged.accentColor ?? null,
        merged.apyRate ?? null,
        boolToInt(merged.hasEmployerMatch),
        merged.employerMatchPct ?? null,
        merged.employerMatchLimitPct ?? null,
        boolToInt(merged.allowsMegaBackdoorRollover),
        boolToInt(merged.hasHighFees),
        id,
      ],
    };
  }

  async update(
    id: number,
    patch: Partial<Omit<Account, 'id' | 'householdId'>>
  ): Promise<void> {
    const { sql, params } = await this.buildUpdateStatement(id, patch);
    await this.db.execute(sql, params);
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM accounts WHERE id = ?', [id]);
  }

  async listForPerson(personId: number): Promise<Account[]> {
    const rows = await this.db.select<AccountRow>(
      'SELECT * FROM accounts WHERE owner_person_id = ? ORDER BY id ASC',
      [personId]
    );
    return rows.map(rowToAccount);
  }

  async listFor529Beneficiary(dependentId: number): Promise<Account[]> {
    const rows = await this.db.select<AccountRow>(
      `SELECT * FROM accounts
       WHERE type = ? AND beneficiary_dependent_id = ?
       ORDER BY id ASC`,
      [AccountType.ACCOUNT_529, dependentId]
    );
    return rows.map(rowToAccount);
  }
}
