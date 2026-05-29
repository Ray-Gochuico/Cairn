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
