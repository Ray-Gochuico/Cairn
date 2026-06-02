import { describe, it, expect } from 'vitest';
import {
  isHighLiability,
  isBareRotFigureAnswer,
  isPrimarySourceCitation,
  normalizePrompt,
  promptJaccard,
  parseNumericAnswer,
  STATUTORY_ANSWER_ALLOWLIST,
  JACCARD_THRESHOLD,
  DEFAULT_MATH_TOLERANCE,
} from '@/lib/trivia/integrity-constants';
import { Topic } from '@/types/enums';

describe('isHighLiability', () => {
  it('flags the four liability topics and nothing else', () => {
    expect(isHighLiability(Topic.TAXES)).toBe(true);
    expect(isHighLiability(Topic.INSURANCE)).toBe(true);
    expect(isHighLiability(Topic.CREDIT_DEBT)).toBe(true);
    expect(isHighLiability(Topic.DEATH)).toBe(true);
    expect(isHighLiability(Topic.FOUNDATIONS)).toBe(false);
    expect(isHighLiability(Topic.INVESTMENTS)).toBe(false);
  });
});

describe('isBareRotFigureAnswer', () => {
  it('flags a bare inflation-adjusted dollar/percent/number answer', () => {
    expect(isBareRotFigureAnswer('$47,025')).toBe(true);
    expect(isBareRotFigureAnswer('$14,600')).toBe(true);
    expect(isBareRotFigureAnswer('22.5%')).toBe(true);
    expect(isBareRotFigureAnswer('103000')).toBe(true);
  });

  it('exempts allowlisted statutory constants', () => {
    for (const v of STATUTORY_ANSWER_ALLOWLIST) {
      expect(isBareRotFigureAnswer(v)).toBe(false);
    }
    expect(isBareRotFigureAnswer('$35,000')).toBe(false); // 529→Roth cap
    expect(isBareRotFigureAnswer('73')).toBe(false); // RMD age
    expect(isBareRotFigureAnswer('3.8%')).toBe(false); // NIIT
  });

  it('does NOT flag a figure embedded in a sentence (only bare answers)', () => {
    expect(isBareRotFigureAnswer('The IRS adjusts it for inflation each year')).toBe(false);
    expect(isBareRotFigureAnswer('Up to $10,000/year per student')).toBe(false);
  });
});

describe('isPrimarySourceCitation', () => {
  it('accepts the real primary sources already in the bank', () => {
    for (const s of [
      'Truth in Lending Act (Regulation Z)',
      'Truth in Savings Act (Regulation DD)',
      'Bengen (1994); Trinity Study (1998)',
      'IRS Pub 590-B; IRC §72(t)',
      'SECURE 2.0 Act of 2022, §126; IRS Notice 2024-2',
      'IRS Form 8960; IRC §1411',
      'Tax Cuts and Jobs Act §11032',
      'IRS Pub 590-B; CMS IRMAA guidelines',
      'IRS Rev. Proc. 2023-34 (2024 inflation adjustments)',
    ]) {
      expect(isPrimarySourceCitation(s)).toBe(true);
    }
  });

  it('rejects placeholders and vague non-primary sources', () => {
    expect(isPrimarySourceCitation('src')).toBe(false);
    expect(isPrimarySourceCitation('Cairn glossary')).toBe(false);
    expect(isPrimarySourceCitation('the IRS')).toBe(false);
    expect(isPrimarySourceCitation('IRS')).toBe(false);
    expect(isPrimarySourceCitation('   ')).toBe(false);
    expect(isPrimarySourceCitation('some blog post')).toBe(false);
  });
});

describe('normalizePrompt / promptJaccard', () => {
  it('normalizes punctuation and case', () => {
    expect(normalizePrompt('What is an APR?!')).toBe('what is an apr');
  });

  it('scores identical prompts at 1 and disjoint at 0', () => {
    expect(promptJaccard('what is an apr', 'what is an apr')).toBe(1);
    expect(promptJaccard('alpha bravo', 'charlie delta')).toBe(0);
  });

  it('catches a near-duplicate above the pinned threshold', () => {
    const a = 'Which of these best describes a Roth IRA account?';
    const b = 'Which of these best describes a Roth IRA?';
    expect(promptJaccard(a, b)).toBeGreaterThan(JACCARD_THRESHOLD);
  });

  it('keeps genuinely different prompts below the threshold', () => {
    const a = 'What age do RMDs begin under SECURE 2.0?';
    const b = 'Which income is subject to the net investment income tax?';
    expect(promptJaccard(a, b)).toBeLessThan(JACCARD_THRESHOLD);
  });
});

describe('parseNumericAnswer', () => {
  it('strips currency, separators, percent and trailing units', () => {
    expect(parseNumericAnswer('$600')).toBe(600);
    expect(parseNumericAnswer('$1,210')).toBe(1210);
    expect(parseNumericAnswer('4%')).toBe(4);
    expect(parseNumericAnswer('9 years')).toBe(9);
    expect(parseNumericAnswer('12 shares')).toBe(12);
    expect(parseNumericAnswer('$1,000,000')).toBe(1000000);
  });

  it('returns NaN when no number is present', () => {
    expect(Number.isNaN(parseNumericAnswer('not a number'))).toBe(true);
  });
});

describe('DEFAULT_MATH_TOLERANCE', () => {
  it('is currency-cents granularity', () => {
    expect(DEFAULT_MATH_TOLERANCE).toBe(0.01);
  });
});
