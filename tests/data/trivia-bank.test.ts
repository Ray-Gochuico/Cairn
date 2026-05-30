import { describe, it, expect } from 'vitest';
import { TriviaBankSchema } from '@/lib/trivia/bank-schema';
import { getGlossaryEntry } from '@/lib/glossary';
import bank from '@/data/trivia/bank-v1.json';

describe('bank-v1.json integrity', () => {
  it('parses through TriviaBankSchema', () => {
    expect(() => TriviaBankSchema.parse(bank)).not.toThrow();
  });

  it('has unique ids', () => {
    const ids = (bank as Array<{ id: string }>).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every glossaryTerm resolves in the glossary', () => {
    const parsed = TriviaBankSchema.parse(bank);
    const unresolved = parsed
      .filter((q) => q.glossaryTerm)
      .filter((q) => getGlossaryEntry(q.glossaryTerm as string) === null)
      .map((q) => q.glossaryTerm);
    expect(unresolved).toEqual([]);
  });

  it('contains at least one Beginner and one Advanced question', () => {
    const parsed = TriviaBankSchema.parse(bank);
    expect(parsed.some((q) => q.difficulty === 'Beginner')).toBe(true);
    expect(parsed.some((q) => q.difficulty === 'Advanced')).toBe(true);
  });
});
