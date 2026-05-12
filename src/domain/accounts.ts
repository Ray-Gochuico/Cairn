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
  state_of_plan: string | null;
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
    stateOfPlan: row.state_of_plan,
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
        auto_fetch_enabled, excluded_from_net_worth, state_of_plan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        account.stateOfPlan ?? null,
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
        state_of_plan = ?,
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
        merged.stateOfPlan ?? null,
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
