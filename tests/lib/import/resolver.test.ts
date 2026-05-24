import { describe, it, expect } from 'vitest';
import { resolveAccount, resolvePerson } from '@/lib/import/resolver';

const accounts = [
  { id: 1, name: 'Fidelity 401k' },
  { id: 2, name: 'Vanguard Brokerage' },
  { id: 3, name: 'Chase Checking' },
  { id: 4, name: 'Brokerage' },
  { id: 5, name: 'Brokerage' },
];

describe('resolveAccount', () => {
  it('matches by exact name (case-insensitive)', () => {
    expect(resolveAccount('Fidelity 401k', null, accounts)).toEqual({ ok: true, accountId: 1 });
    expect(resolveAccount('fidelity 401k', null, accounts)).toEqual({ ok: true, accountId: 1 });
    expect(resolveAccount('  Fidelity 401k  ', null, accounts)).toEqual({ ok: true, accountId: 1 });
  });

  it('returns not_found for an empty name with no explicit id', () => {
    expect(resolveAccount('', null, accounts)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when no account name matches', () => {
    expect(resolveAccount('Made Up Account', null, accounts)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns ambiguous when multiple accounts share a name', () => {
    expect(resolveAccount('Brokerage', null, accounts)).toEqual({
      ok: false,
      reason: 'ambiguous',
      matches: [4, 5],
    });
  });

  it('uses explicit id when provided, ignoring the name', () => {
    expect(resolveAccount('anything', 3, accounts)).toEqual({ ok: true, accountId: 3 });
  });

  it('returns not_found when explicit id does not exist', () => {
    expect(resolveAccount('Fidelity 401k', 999, accounts)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('resolvePerson', () => {
  const persons = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];

  it('matches by name (case-insensitive)', () => {
    expect(resolvePerson('alice', null, persons)).toEqual({ ok: true, personId: 1 });
  });

  it('returns ok with null id for empty name (joint convention)', () => {
    expect(resolvePerson('', null, persons)).toEqual({ ok: true, personId: null });
  });

  it('returns not_found for unknown name', () => {
    expect(resolvePerson('Carol', null, persons)).toEqual({ ok: false, reason: 'not_found' });
  });
});
