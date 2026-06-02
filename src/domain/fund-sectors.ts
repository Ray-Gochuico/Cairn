import type { BatchStatement, Database } from '@/db/db';
import { FundSectorSchema, type FundSector } from '@/types/schema';

interface FundSectorRow {
  fund_ticker: string;
  sector: string;
  weight: number;
  as_of_date: string;
}

function rowToFundSector(row: FundSectorRow): FundSector {
  return FundSectorSchema.parse({
    fundTicker: row.fund_ticker,
    sector: row.sector,
    weight: row.weight,
    asOfDate: row.as_of_date,
  });
}

export class FundSectorsRepo {
  constructor(private db: Database) {}

  async listForFund(fundTicker: string): Promise<FundSector[]> {
    const rows = await this.db.select<FundSectorRow>(
      'SELECT * FROM fund_sectors WHERE fund_ticker = ? ORDER BY weight DESC',
      [fundTicker]
    );
    return rows.map(rowToFundSector);
  }

  async listAll(): Promise<FundSector[]> {
    const rows = await this.db.select<FundSectorRow>(
      'SELECT * FROM fund_sectors ORDER BY fund_ticker ASC, weight DESC'
    );
    return rows.map(rowToFundSector);
  }

  /**
   * Latest as-of date for a fund's sector rows, or null when no rows exist.
   * Used by syncStaleFunds to decide whether to refetch sectorWeightings
   * independently of fund_holdings staleness — a fresh fund_holdings row
   * doesn't imply a fresh fund_sectors row (true for any user who refreshed
   * before migration 0021 introduced the table).
   */
  async getAsOf(fundTicker: string): Promise<string | null> {
    const rows = await this.db.select<{ as_of_date: string }>(
      'SELECT as_of_date FROM fund_sectors WHERE fund_ticker = ? ORDER BY as_of_date DESC LIMIT 1',
      [fundTicker]
    );
    return rows.length === 0 ? null : rows[0].as_of_date;
  }

  async upsertSectors(
    fundTicker: string,
    sectors: { sector: string; weight: number }[],
    asOfDate: string
  ): Promise<void> {
    // Atomicity (force-quit safety): the DELETE + per-row INSERTs are wrapped in
    // a single executeBatch transaction so a crash mid-loop can never leave a
    // fund's sector breakdown deleted/partially-written (which would skew the
    // sector donut for up to 90 days until the next sync). Behaviour-preserving:
    // same DELETE, same per-row INSERTs, same params, same order, same
    // validation — just committed all-or-nothing on one connection. Validation
    // runs while BUILDING the statements (before the batch) so a bad row rejects
    // before any write, exactly as the pre-transaction loop did.
    const statements: BatchStatement[] = [
      { sql: 'DELETE FROM fund_sectors WHERE fund_ticker = ?', params: [fundTicker] },
    ];
    for (const s of sectors) {
      FundSectorSchema.parse({
        fundTicker,
        sector: s.sector,
        weight: s.weight,
        asOfDate,
      });
      statements.push({
        sql: 'INSERT INTO fund_sectors (fund_ticker, sector, weight, as_of_date) VALUES (?, ?, ?, ?)',
        params: [fundTicker, s.sector, s.weight, asOfDate],
      });
    }
    await this.db.executeBatch(statements, { transaction: true });
  }
}
