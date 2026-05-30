import { describe, it, expect } from 'vitest';
import { TriviaQuestionSchema, TriviaBankSchema } from '@/lib/trivia/bank-schema';

const valid = {
  id: 'beg-apr',
  version: 1,
  difficulty: 'Beginner' as const,
  tags: ['Borrowing', 'rates'],
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
});
