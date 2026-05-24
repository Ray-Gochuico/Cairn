import type { Database } from '@/db/db';
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
}

function nullableBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
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

  async create(account: Omit<Account, 'id'>): Promise<number> {
    AccountSchema.omit({ id: true }).parse(account);
    const result = await this.db.execute(
      `INSERT INTO accounts (
        household_id, owner_person_id, beneficiary_dependent_id,
        name, institution, type, crypto_wallet_address,
        auto_fetch_enabled, excluded_from_net_worth, allow_margin, state_of_plan,
        accent_color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create account: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Account, 'id' | 'householdId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Account ${id} not found`);
    const merged = { ...existing, ...patch };
    AccountSchema.parse(merged);

    await this.db.execute(
      `UPDATE accounts SET
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
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
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
        id,
      ]
    );
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
