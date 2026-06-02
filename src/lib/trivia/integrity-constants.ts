import { Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

/**
 * Shared constants for the trivia integrity harness (tests/data/trivia-bank.test.ts)
 * and the in-bank de-rot pre-checks (L3.3b). Factored here so the rule cannot
 * drift between the harness and the backfill checks — both read this ONE source.
 *
 * Design refs: plan L2.1 §2 / L2.4 / L3.3b / L2.5 (panel Finance H2, Testing M2).
 */

/**
 * High-liability topics requiring a real primary-source citation and the
 * no-rot-prone-figure-as-answer rule. (Taxes / Insurance / Credit & Debt / Death.)
 */
export const HIGH_LIABILITY_TOPICS: readonly Topic[] = [
  Topic.TAXES,
  Topic.INSURANCE,
  Topic.CREDIT_DEBT,
  Topic.DEATH,
];

export function isHighLiability(topic: Topic): boolean {
  return HIGH_LIABILITY_TOPICS.includes(topic);
}

/**
 * Statutory-constant ALLOWLIST (panel Finance H2). The D4 "no figure as the
 * graded answer" rule is scoped to INFLATION-ADJUSTED figures (the ones that ROT
 * each tax year: bracket thresholds, contribution/deferral limits, phase-out
 * ranges, the standard deduction, IRMAA tiers, gift/estate exclusions). Values
 * set by STATUTE (not indexed) are PERMITTED as answers and live here. A blanket
 * `$`/`%` ban would false-fail every one of these correct answers.
 *
 * Compared against the trimmed answer string. Keep this list spelled exactly as
 * the bank stores the answers.
 */
export const STATUTORY_ANSWER_ALLOWLIST: readonly string[] = [
  '$35,000', // SECURE 2.0 529→Roth lifetime cap
  '$10,000', // 529 K-12 annual cap
  '3.8%', // NIIT rate
  '0%', // LTCG rate schedule
  '15%', // LTCG rate schedule
  '20%', // LTCG rate schedule
  '10%', // §72(t) early-withdrawal penalty
  '73', // RMD age (SECURE 2.0 §107)
  '50%', // missed-RMD excise (pre-SECURE-2.0)
  '25%', // missed-RMD excise
];

/**
 * Detects a BARE rot-prone figure used as the graded answer: a whole answer
 * string that is essentially just a `$amount`, a `percent%`, or a bare number —
 * the shape an inflation-adjusted threshold/limit takes. Allowlisted statutory
 * constants are excluded by the caller. Figures embedded inside a longer
 * sentence (e.g. an explanation) are intentionally NOT matched — only answers
 * that ARE the figure.
 */
const BARE_FIGURE = /^\$?\d[\d,]*(?:\.\d+)?%?$/;

export function isBareRotFigureAnswer(answer: string): boolean {
  const a = answer.trim();
  if (STATUTORY_ANSWER_ALLOWLIST.includes(a)) return false;
  return BARE_FIGURE.test(a);
}

/** The graded answer string for a question. */
export function answerOf(q: Pick<TriviaQuestion, 'choices' | 'answerIndex'>): string {
  return q.choices[q.answerIndex];
}

/**
 * Default tolerance for math self-verification (panel Testing M2 / Backend M2).
 * The comparison ALWAYS applies a default — never strict `===` — so float drift
 * (0.1 + 0.2-class) can't false-fail correct math. Currency-cents granularity.
 */
export const DEFAULT_MATH_TOLERANCE = 0.01;
