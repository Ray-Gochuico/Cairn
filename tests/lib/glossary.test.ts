import { describe, it, expect } from 'vitest';
import { getGlossaryEntry } from '@/lib/glossary';

describe('getGlossaryEntry — APR', () => {
  // Gates the trivia `beg-apr` seed question, whose `glossaryTerm: "APR"`
  // is asserted to resolve by the trivia bank-integrity test.
  it('resolves APR to a well-formed glossary entry', () => {
    const entry = getGlossaryEntry('APR');
    expect(entry).not.toBeNull();
    expect(entry!.term).toBe('APR');
    expect(entry!.shortDefinition).toMatch(/Annual Percentage Rate/i);
  });

  it('resolves APR case-insensitively (lower-case lookups work)', () => {
    expect(getGlossaryEntry('apr')).not.toBeNull();
  });
});

describe('getGlossaryEntry — ROTH 401(K)', () => {
  it('resolves and states the qualified-distribution condition', () => {
    const entry = getGlossaryEntry('ROTH 401(K)');
    expect(entry).not.toBeNull();
    expect(`${entry!.shortDefinition} ${entry!.fullDefinition ?? ''}`).toMatch(/qualified/i);
  });
});

describe('getGlossaryEntry — 401(k) Roth wording tightened', () => {
  it('no longer claims unconditional tax-free out', () => {
    const entry = getGlossaryEntry('401(K)');
    expect(entry!.fullDefinition).toMatch(/tax-free out on qualified withdrawals/i);
    expect(entry!.fullDefinition).not.toMatch(/post-tax in \/ tax-free out\b(?! on qualified)/i);
  });
});
