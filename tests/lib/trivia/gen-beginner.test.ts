import { describe, it, expect } from 'vitest';
import { generateBeginnerQuestions } from '@/lib/trivia/gen-beginner';
import { TriviaBankSchema } from '@/lib/trivia/bank-schema';
import { QuestionFormat, Topic } from '@/types/enums';
import type { GlossaryEntry } from '@/lib/glossary';

const fixture: Record<string, GlossaryEntry> = {
  APR: { term: 'APR', shortDefinition: 'Annual Percentage Rate — the yearly cost of borrowing.' },
  APY: { term: 'APY', shortDefinition: 'Annual Percentage Yield — return after compounding.' },
  HSA: { term: 'HSA', shortDefinition: 'Health Savings Account — triple-tax-advantaged medical account.' },
  FSA: { term: 'FSA', shortDefinition: 'Flexible Spending Account — pre-tax money for medical expenses.' },
  RMD: { term: 'RMD', shortDefinition: 'Required Minimum Distribution from pre-tax retirement accounts.' },
};

describe('generateBeginnerQuestions', () => {
  it('emits one schema-valid Beginner question per entry', () => {
    const out = generateBeginnerQuestions(fixture);
    expect(out).toHaveLength(5);
    expect(() => TriviaBankSchema.parse(out)).not.toThrow();
    for (const q of out) {
      expect(q.difficulty).toBe('Beginner');
      expect(q.choices).toHaveLength(4);
      // the correct choice is the entry's own shortDefinition
      expect(q.choices[q.answerIndex]).toBe(fixture[q.glossaryTerm!.toUpperCase()].shortDefinition);
      // 3 distinct distractors
      expect(new Set(q.choices).size).toBe(4);
    }
  });

  it('is deterministic — same input yields byte-identical output', () => {
    expect(JSON.stringify(generateBeginnerQuestions(fixture))).toBe(
      JSON.stringify(generateBeginnerQuestions(fixture)),
    );
  });

  it('uses a beg- id prefix and sets glossaryTerm', () => {
    const out = generateBeginnerQuestions(fixture);
    const apr = out.find((q) => q.glossaryTerm === 'APR')!;
    expect(apr.id).toBe('beg-apr');
    expect(apr.prompt).toMatch(/which of these best describes/i);
  });

  it('falls back gracefully when fewer than 4 entries exist', () => {
    const tiny: Record<string, GlossaryEntry> = {
      APR: fixture.APR,
      APY: fixture.APY,
    };
    const out = generateBeginnerQuestions(tiny);
    // Not enough distinct distractors to make a valid 4-choice question → skip.
    expect(out).toEqual([]);
  });

  // L3.4 — repointed to the taxonomy: emitted rows are CANDIDATES for review,
  // never auto-servable. They carry format=definition + a safe default
  // topic=Foundations (glossary entries have no topic; the reviewer retopics on
  // curation) and reviewed=false (the load-filter keeps them out of the pool).
  it('emits taxonomy candidates: format=definition, default topic=Foundations, reviewed=false', () => {
    const out = generateBeginnerQuestions(fixture);
    for (const q of out) {
      expect(q.format).toBe(QuestionFormat.DEFINITION);
      expect(q.topic).toBe(Topic.FOUNDATIONS);
      expect(q.reviewed).toBe(false);
    }
  });
});
