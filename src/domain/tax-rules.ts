import type { Database } from '@/db/db';
import { TaxRuleSchema, type TaxRule, type JurisdictionType, type FilingStatus } from '@/types/schema';

interface TaxRuleRow {
  id: number;
  year: number;
  jurisdiction_type: string;
  jurisdiction_code: string;
  filing_status: string;
  brackets: string;
  standard_deduction: number;
}

function rowToTaxRule(row: TaxRuleRow): TaxRule {
  return TaxRuleSchema.parse({
    id: row.id,
    year: row.year,
    jurisdictionType: row.jurisdiction_type,
    jurisdictionCode: row.jurisdiction_code,
    filingStatus: row.filing_status,
    brackets: JSON.parse(row.brackets),
    standardDeduction: row.standard_deduction,
  });
}

export class TaxRulesRepo {
  constructor(private db: Database) {}

  async listForYear(year: number): Promise<TaxRule[]> {
    const rows = await this.db.select<TaxRuleRow>(
      'SELECT * FROM tax_rules WHERE year = ? ORDER BY jurisdiction_type, jurisdiction_code, filing_status',
      [year]
    );
    return rows.map(rowToTaxRule);
  }

  async lookup(
    year: number,
    jurisdictionType: JurisdictionType,
    jurisdictionCode: string,
    filingStatus: FilingStatus
  ): Promise<TaxRule | null> {
    const rows = await this.db.select<TaxRuleRow>(
      'SELECT * FROM tax_rules WHERE year = ? AND jurisdiction_type = ? AND jurisdiction_code = ? AND filing_status = ? LIMIT 1',
      [year, jurisdictionType, jurisdictionCode, filingStatus]
    );
    return rows.length > 0 ? rowToTaxRule(rows[0]) : null;
  }
}
