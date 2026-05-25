// src/lib/import/parse-csv.ts
import type { RawRow } from '@/lib/import/types';

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  headers: string[];
  rows: RawRow[];
  errors: ParseError[];
}

/**
 * RFC-4180 CSV parser. Returns headers, data rows keyed by header, and
 * any per-line errors encountered. Errors are reported but parsing
 * continues with the next line.
 */
export function parseCsv(text: string): ParseResult {
  const errors: ParseError[] = [];
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const allLines = tokenizeIntoLines(cleaned, errors);

  while (allLines.length > 0 && allLines[allLines.length - 1].fields.every((f) => f === '')) {
    allLines.pop();
  }

  if (allLines.length === 0) {
    return { headers: [], rows: [], errors };
  }

  const headerLine = allLines[0];
  const headers = headerLine.fields;
  const rows: RawRow[] = [];

  for (let i = 1; i < allLines.length; i++) {
    const { fields, lineNumber } = allLines[i];
    if (fields.length !== headers.length) {
      errors.push({
        line: lineNumber,
        message: `Row has ${fields.length} columns, expected ${headers.length}`,
      });
      continue;
    }
    const row: RawRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j];
    }
    rows.push(row);
  }

  return { headers, rows, errors };
}

interface Line {
  fields: string[];
  lineNumber: number;
}

function tokenizeIntoLines(text: string, errors: ParseError[]): Line[] {
  const lines: Line[] = [];
  let currentFields: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let logicalLineStart = 1;
  let physicalLine = 1;
  let i = 0;

  const finishField = () => {
    currentFields.push(currentField);
    currentField = '';
  };
  const finishLine = () => {
    lines.push({ fields: currentFields, lineNumber: logicalLineStart });
    currentFields = [];
    logicalLineStart = physicalLine + 1;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        currentField += '\n';
        physicalLine += 1;
        i += 1;
        continue;
      }
      if (ch === '\r') {
        currentField += '\n';
        if (text[i + 1] === '\n') i += 1;
        physicalLine += 1;
        i += 1;
        continue;
      }
      currentField += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (currentField === '') {
        inQuotes = true;
        i += 1;
        continue;
      }
      currentField += ch;
      i += 1;
      continue;
    }
    if (ch === ',') {
      finishField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      finishField();
      finishLine();
      if (text[i + 1] === '\n') i += 1;
      physicalLine += 1;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      finishField();
      finishLine();
      physicalLine += 1;
      i += 1;
      continue;
    }
    currentField += ch;
    i += 1;
  }

  if (inQuotes) {
    errors.push({
      line: logicalLineStart,
      message: 'Row has an unterminated quoted field',
    });
    return lines;
  }
  if (currentField !== '' || currentFields.length > 0) {
    finishField();
    finishLine();
  }

  return lines;
}
