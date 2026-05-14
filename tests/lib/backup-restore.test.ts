import { describe, it, expect } from 'vitest';
import { BackupSchema, serializeBackup, deserializeBackup } from '@/lib/backup-restore';

const emptyData = {
  household: null,
  persons: [],
  dependents: [],
  accounts: [],
  holdings: [],
  contributions: [],
  account_snapshots: [],
  loans: [],
  loan_payments: [],
  properties: [],
  vehicles: [],
  equity_grants: [],
  goals: [],
};

describe('BackupSchema', () => {
  it('accepts a valid backup object', () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      ...emptyData,
    };
    expect(() => BackupSchema.parse(backup)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => BackupSchema.parse({ version: 1 })).toThrow();
  });

  it('rejects wrong version type', () => {
    expect(() =>
      BackupSchema.parse({ version: 'one', exportedAt: '', ...emptyData }),
    ).toThrow();
  });
});

describe('serializeBackup', () => {
  it('produces valid JSON string with correct schema version', () => {
    const json = serializeBackup(emptyData);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
  });
});

describe('deserializeBackup', () => {
  it('returns parsed backup for valid JSON', () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-05-14T00:00:00Z',
      ...emptyData,
    });
    const result = deserializeBackup(json);
    expect(result.version).toBe(1);
    expect(result.persons).toEqual([]);
  });

  it('throws on malformed JSON', () => {
    expect(() => deserializeBackup('not-json')).toThrow();
  });

  it('throws on JSON that fails schema validation', () => {
    expect(() =>
      deserializeBackup(JSON.stringify({ version: 99, exportedAt: 'x' })),
    ).toThrow();
  });
});
