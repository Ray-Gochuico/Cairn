/**
 * v1.8.0 W4 (C040, build-flag ⚑): a contribution import never calls an
 * employer match a copy of the paycheck deferral it matches.
 *
 * The duplicate key was account + date + amount, so a dollar-for-dollar
 * EMPLOYER_MATCH next to a saved PAYCHECK deferral on the same day — the
 * normal match — was flagged 'duplicate' and skipped by default, and match
 * history undercounted. A match now carries its own marker in the key. Every
 * other source keeps the plain key (a row entered by hand and re-imported as
 * PAYCHECK is still caught), and the person is not part of the key. The other
 * direction is the chosen trade-off: a saved match re-imported from a CSV with
 * no source column reads as new, because the row does not say it is a match
 * (⚑ D-W4L1-4). The saved
 * side (buildContributionDuplicateKeys) and the imported side (the validator)
 * share one helper. Clock-free: literal dates only.
 */
import { describe, it, expect } from 'vitest';
import { validateContributionRow } from '@/lib/import/validators/contribution';
import { buildContributionDuplicateKeys } from '@/lib/import/conflict-detector';
import { createImportPreviewStore } from '@/stores/import-preview-store';
import { ContributionSource } from '@/types/enums';
import type { Contribution } from '@/types/schema';
import type { ValidationContext } from '@/lib/import/types';

const saved = (source: Contribution['source']): Contribution => ({
  id: 1, accountId: 1, personId: 1, date: '2026-10-31', amount: 250, source,
});
const ctxFor = (existing: Contribution[]): ValidationContext => ({
  accounts: [{ id: 1, name: '401k' }],
  persons: [{ id: 1, name: 'Ray' }],
  existingContributionDupKeys: buildContributionDuplicateKeys(existing),
});
const row = (source?: string) => ({
  account_name: '401k',
  contribution_date: '2026-10-31',
  amount: '250',
  person_name: 'Ray',
  ...(source ? { source } : {}),
});

describe('contribution duplicate key: an employer match is never a copy of the deferral (C040)', () => {
  it('an EMPLOYER_MATCH equal to a saved PAYCHECK deferral on the same day is new', () => {
    const r = validateContributionRow(row('EMPLOYER_MATCH'), 0, ctxFor([saved(ContributionSource.PAYCHECK)]));
    expect(r.status).toBe('new');
  });

  it('a PAYCHECK deferral equal to a saved EMPLOYER_MATCH on the same day is new', () => {
    const r = validateContributionRow(row('PAYCHECK'), 0, ctxFor([saved(ContributionSource.EMPLOYER_MATCH)]));
    expect(r.status).toBe('new');
  });

  it('through the preview store, that match is committed by default', () => {
    const store = createImportPreviewStore(
      'contribution',
      { headers: Object.keys(row('EMPLOYER_MATCH')), rows: [row('EMPLOYER_MATCH')], errors: [] },
      ctxFor([saved(ContributionSource.PAYCHECK)]),
    );
    expect(store.getState().derivedRows[0].status).toBe('new');
    expect(store.getState().committableRows()).toHaveLength(1);
  });

  it('a saved EMPLOYER_MATCH re-imported is still a duplicate', () => {
    const r = validateContributionRow(row('EMPLOYER_MATCH'), 0, ctxFor([saved(ContributionSource.EMPLOYER_MATCH)]));
    expect(r.status).toBe('duplicate');
  });

  it('a saved MANUAL row re-imported as PAYCHECK is still a duplicate (the source is not in the key)', () => {
    const r = validateContributionRow(row('PAYCHECK'), 0, ctxFor([saved(ContributionSource.MANUAL)]));
    expect(r.status).toBe('duplicate');
  });

  it('a saved PAYCHECK row re-imported with no source (MANUAL) is still a duplicate', () => {
    const r = validateContributionRow(row(), 0, ctxFor([saved(ContributionSource.PAYCHECK)]));
    expect(r.status).toBe('duplicate');
  });

  it('a saved EMPLOYER_MATCH re-imported with no source (read as MANUAL) is new: a row is a match only when it says so (⚑ D-W4L1-4)', () => {
    const r = validateContributionRow(row(), 0, ctxFor([saved(ContributionSource.EMPLOYER_MATCH)]));
    expect(r.status).toBe('new');
  });

  it('the person is not in the key: a saved row with no person still catches the same row with one', () => {
    const r = validateContributionRow(row('PAYCHECK'), 0, ctxFor([{ ...saved(ContributionSource.PAYCHECK), personId: null }]));
    expect(r.status).toBe('duplicate');
  });

  it('the saved-side key: plain for every source but EMPLOYER_MATCH, which is marked', () => {
    const keys = buildContributionDuplicateKeys([
      { accountId: 1, personId: null, date: '2026-01-15', amount: 500, source: ContributionSource.PAYCHECK },
      { accountId: 1, personId: null, date: '2026-01-15', amount: 500, source: ContributionSource.EMPLOYER_MATCH },
    ]);
    expect([...keys].sort()).toEqual(['1::2026-01-15::500', '1::2026-01-15::500::match']);
  });
});
