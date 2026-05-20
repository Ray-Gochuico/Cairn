import type { PdfTextItem, ParsedTransaction } from '../types';
import { groupIntoRows, cleanMerchant, parseAmount } from '../layout';

export interface RowShapeConfig {
  /** Matches a date token at the start of a row. */
  dateRe: RegExp;
  /** Convert a successful `dateRe` match to a YYYY-MM-DD string (or null). */
  toIso: (m: RegExpExecArray) => string | null;
}

/**
 * Position-aware extraction shared by every issuer parser. Groups items
 * into rows; for each row, takes a leading date token and a trailing
 * currency amount, with the text between as the merchant. A row that has
 * neither a leading date nor an amount is folded into the previous
 * transaction as a wrapped-description continuation.
 */
export function extractRowsByShape(
  items: PdfTextItem[],
  config: RowShapeConfig,
): ParsedTransaction[] {
  const rows = groupIntoRows(items);
  const out: ParsedTransaction[] = [];

  for (const row of rows) {
    if (row.length === 0) continue;

    // Trailing amount: scan from the right for the first currency token.
    let amountIdx = -1;
    let amount: number | null = null;
    for (let k = row.length - 1; k >= 0; k--) {
      const a = parseAmount(row[k].str);
      if (a !== null) {
        amount = a;
        amountIdx = k;
        break;
      }
    }

    const dateMatch = config.dateRe.exec(row[0].str.trim());

    if (!dateMatch) {
      // Continuation row: append to the previous transaction's merchant.
      if (out.length > 0 && amount === null) {
        const cont = row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (cont) {
          const prev = out[out.length - 1];
          prev.merchantRaw = `${prev.merchantRaw} ${cont}`.trim();
          prev.merchant = cleanMerchant(prev.merchantRaw);
        }
      }
      continue;
    }

    if (amount === null || amountIdx <= 0) continue; // need a date AND an amount
    const iso = config.toIso(dateMatch);
    if (!iso) continue;

    const merchantRaw = row
      .slice(1, amountIdx)
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!merchantRaw) continue;

    out.push({ date: iso, merchantRaw, merchant: cleanMerchant(merchantRaw), amount });
  }

  return out;
}
