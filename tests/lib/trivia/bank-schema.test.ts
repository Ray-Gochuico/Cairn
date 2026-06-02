import { describe, it, expect } from 'vitest';
import { TriviaQuestionSchema, TriviaBankSchema } from '@/lib/trivia/bank-schema';
import { QuestionFormat, Topic, Subtopic } from '@/types/enums';

const valid = {
  id: 'beg-apr',
  version: 1,
  difficulty: 'Beginner' as const,
  format: QuestionFormat.DEFINITION,
  topic: Topic.CREDIT_DEBT,
  glossaryTerm: 'APR',
  prompt: 'What does APR stand for?',
  choices: ['Annual Percentage Rate', 'Average Payment Ratio', 'Adjusted Principal Reduction', 'Annualized Portfolio Return'],
  answerIndex: 0,
  explanation: 'APR is the yearly cost of borrowing…',
  source: 'Truth in Lending Act (Regulation Z)',
};

describe('TriviaQuestionSchema', () => {
  it('accepts a valid question', () => {
    expect(() => TriviaQuestionSchema.parse(valid)).not.toThrow();
  });

  it('accepts a question with no glossaryTerm', () => {
    const { glossaryTerm: _omit, ...rest } = valid;
    expect(() => TriviaQuestionSchema.parse(rest)).not.toThrow();
  });

  it('rejects a non-4 choice list', () => {
    expect(() =>
      TriviaQuestionSchema.parse({ ...valid, choices: ['a', 'b', 'c'] }),
    ).toThrow();
  });

  it('rejects answerIndex outside 0..3', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, answerIndex: 4 })).toThrow();
  });

  it('rejects an unknown difficulty (Mixed is a preference, not a tag)', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, difficulty: 'Mixed' })).toThrow();
  });

  it('TriviaBankSchema parses an array of questions', () => {
    expect(() => TriviaBankSchema.parse([valid])).not.toThrow();
  });

  // --- Taxonomy fields (L3.2) ---

  it('requires format — a row missing it fails', () => {
    const { format: _omit, ...rest } = valid;
    expect(() => TriviaQuestionSchema.parse(rest)).toThrow();
  });

  it('requires topic — a row missing it fails', () => {
    const { topic: _omit, ...rest } = valid;
    expect(() => TriviaQuestionSchema.parse(rest)).toThrow();
  });

  it('rejects a bogus format value', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, format: 'essay' })).toThrow();
  });

  it('rejects a bogus topic value', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, topic: 'Crypto' })).toThrow();
  });

  it('rejects a bogus subtopic value', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, subtopic: 'Pets' })).toThrow();
  });

  it('treats subtopic as optional', () => {
    expect(() => TriviaQuestionSchema.parse({ ...valid, subtopic: Subtopic.HEALTH })).not.toThrow();
    expect(() => TriviaQuestionSchema.parse(valid)).not.toThrow(); // omitted → fine
  });

  it('drops the legacy free-text tags key (non-strict transition)', () => {
    const withTags = { ...valid, tags: ['Borrowing', 'rates'] };
    const parsed = TriviaQuestionSchema.parse(withTags) as Record<string, unknown>;
    expect('tags' in parsed).toBe(false);
  });

  // --- Review gate fields (D3) ---

  it('defaults reviewed to false when omitted', () => {
    const parsed = TriviaQuestionSchema.parse(valid);
    expect(parsed.reviewed).toBe(false);
  });

  it('accepts reviewed=true with optional reviewedBy/reviewedAt', () => {
    const parsed = TriviaQuestionSchema.parse({
      ...valid,
      reviewed: true,
      reviewedBy: 'user',
      reviewedAt: '2026-06-01',
    });
    expect(parsed.reviewed).toBe(true);
    expect(parsed.reviewedBy).toBe('user');
    expect(parsed.reviewedAt).toBe('2026-06-01');
  });
});
