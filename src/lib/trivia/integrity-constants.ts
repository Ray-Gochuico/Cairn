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

/**
 * Obvious placeholder / non-primary sources that must NEVER be the citation for
 * a high-liability question (panel Finance H3). `"Cairn glossary"` is fine for
 * Foundations etc., but not for Taxes/Insurance/Credit&Debt/Death.
 */
const PLACEHOLDER_SOURCES = ['src', 'cairn glossary', '', 'the irs', 'irs'];

/**
 * Real primary-source tokens (BROADENED beyond IRS-only per panel Finance H3 —
 * these legit non-IRS sources already live in the bank and MUST pass):
 *  - IRS forms/guidance: Pub/Publication N, Form N, Notice YYYY-N, Rev. Proc/Rul YYYY-N
 *  - statute: IRC §, 26 U.S.C., §<digits>, a named federal Act (…Act of YYYY)
 *  - consumer-finance regs: Truth in Lending/Savings Act, Regulation Z/DD (or Reg Z/DD),
 *    generic CFR / Reg <letters>
 *  - named studies: Bengen (YYYY), Trinity Study, CMS, any (YYYY)-dated study
 *
 * NECESSARY, NOT SUFFICIENT: this proves a citation is *shaped* like a primary
 * source, NOT that it is correct/current — that is the human reviewer's job.
 */
const PRIMARY_SOURCE_PATTERNS: readonly RegExp[] = [
  /\b(?:IRS )?Pub(?:lication)?\.?\s*\d+/i,
  /\bForm\s*\d+/i,
  /\bNotice\s*\d{4}-\d+/i,
  /\bRev\.?\s*(?:Proc|Rul)\.?\s*\d{4}-\d+/i,
  /\bIRC\b/i,
  /\b26\s*U\.?S\.?C\.?/i,
  /§\s*\d/,
  /\bAct of \d{4}\b/i,
  /\bTax Cuts and Jobs Act\b/i,
  /\bTruth in (?:Lending|Savings) Act\b/i,
  /\bReg(?:ulation)?\.?\s*(?:Z|DD)\b/i,
  /\bReg(?:ulation)?\s+[A-Z]{1,2}\b/,
  /\bCFR\b/,
  /\bBengen\b/i,
  /\bTrinity Study\b/i,
  /\bCMS\b/,
  /\(\d{4}\)/, // a (YYYY)-dated named study
];

/**
 * True iff `source` is shaped like a real primary citation (and isn't a known
 * placeholder). Used by the harness for high-liability topics.
 */
export function isPrimarySourceCitation(source: string): boolean {
  const s = source.trim();
  if (s.length < 4) return false;
  if (PLACEHOLDER_SOURCES.includes(s.toLowerCase())) return false;
  return PRIMARY_SOURCE_PATTERNS.some((re) => re.test(s));
}

/**
 * Normalize a prompt for near-duplicate detection: lowercase, strip punctuation,
 * collapse whitespace.
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity of two normalized prompts. */
export function promptJaccard(a: string, b: string): number {
  const sa = new Set(normalizePrompt(a).split(' ').filter(Boolean));
  const sb = new Set(normalizePrompt(b).split(' ').filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Near-duplicate prompt threshold + bucketing (panel Testing L1). Pinned as
 * named consts so the dedup test is stable and stays inside testTimeout.
 * Bucket by `topic` (dupes cluster there) → each bucket is ~O((600/13)²) ≈ 2k
 * pairs, well within a single assertion; an un-bucketed O(n²) would be ~180k.
 */
export const JACCARD_THRESHOLD = 0.85;

/** Min reviewed-pool size before the answerIndex distribution band is enforced. */
export const ANSWER_INDEX_MIN_N = 100;
