import type { Database } from '@/db/db';
import { MerchantSeedSchema, type MerchantSeed } from '@/types/schema';

interface MerchantSeedRow {
  id: number;
  merchant_pattern: string;
  category_id: number;
}

function rowToMerchantSeed(row: MerchantSeedRow): MerchantSeed {
  return MerchantSeedSchema.parse({
    id: row.id,
    merchantPattern: row.merchant_pattern,
    categoryId: row.category_id,
  });
}

/** Read-only repo over merchant_seed_mapping. */
export class MerchantSeedRepo {
  constructor(private db: Database) {}

  async list(): Promise<MerchantSeed[]> {
    const rows = await this.db.select<MerchantSeedRow>(
      'SELECT id, merchant_pattern, category_id FROM merchant_seed_mapping ORDER BY id ASC',
    );
    return rows.map(rowToMerchantSeed);
  }
}
