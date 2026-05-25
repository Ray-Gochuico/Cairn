import type { Database } from '@/db/db';
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

  async upsertSectors(
    fundTicker: string,
    sectors: { sector: string; weight: number }[],
    asOfDate: string
  ): Promise<void> {
    await this.db.execute('DELETE FROM fund_sectors WHERE fund_ticker = ?', [fundTicker]);
    for (const s of sectors) {
      FundSectorSchema.parse({
        fundTicker,
        sector: s.sector,
        weight: s.weight,
        asOfDate,
      });
      await this.db.execute(
        'INSERT INTO fund_sectors (fund_ticker, sector, weight, as_of_date) VALUES (?, ?, ?, ?)',
        [fundTicker, s.sector, s.weight, asOfDate]
      );
    }
  }
}
