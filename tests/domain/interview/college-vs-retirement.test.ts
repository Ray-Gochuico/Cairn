import { describe, it, expect } from 'vitest';
import { evaluateThread } from '@/domain/interview/evaluate';
import { COLLEGE_VS_RETIREMENT_THREAD } from '@/domain/interview/threads/college-vs-retirement';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { AccountType, FilingStatus } from '@/types/enums';
import {
  computeCollegeTarget, project529Real,
} from '@/lib/interview/college-tradeoff';
import {
  getTuition, TUITION_BASE_ACADEMIC_YEAR, TUITION_REAL_GROWTH,
} from '@/data/tuition-reference';
import { makeAccount, makeDependent, makeHousehold } from '../../factories';
import { fixtureCtx, snap } from '../../lib/interview/fixture';

// Clean-math household: moderate 5% nominal, 3% inflation → the Task-3
// anchor numbers ($78,225 on 10k + $500/mo over 120 months).
const HH = makeHousehold({
  state: 'CA', // absent from the 529 DEDUCTION table → CI-C15 path (CA IS
  //             in the tuition state table → state-specific basis + CI-C23)
  inflationAssumption: 0.03,
  growthScenarios: [{ label: 'moderate', rate: 0.05 }],
});

const plan529 = makeAccount({ id: 9, type: AccountType.ACCOUNT_529, name: 'College 529' });

// today 2026-08-01 (fixture default); dob 2018-08-15 → age 96 months →
// 120 months to 18 → start 2036-08 ("August 2036").
const kid = makeDependent({ id: 1, name: 'Maya', dateOfBirth: '2018-08-15' });

const row = (questionId: string, valueJson: string, basisBranch: string): [string, InterviewAnswer] => [
  answerKey('college_vs_retirement', questionId, ''),
  {
    id: 1, householdId: 1, threadId: 'college_vs_retirement', questionId,
    subjectKey: '', valueJson, questionVersion: 1,
    answeredAt: '2026-07-01T00:00:00.000Z', basisJson: JSON.stringify({ branch: basisBranch }),
  },
];

// The brokerage makes the FI target REACHABLE (portfolio 800k vs the
// 5000×12/0.04 = $1.5M target at (1.05/1.03)−1 real ≈ 33 finite years) so
// reply_tradeoff's retirement side is the CI-C9 delta line, not CI-C10.
// If it lands fi-unreachable at execution, raise THIS snapshot — never
// touch the thread copy.
const brokerage = makeAccount({ id: 2, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' });

const fullCtx = (answers = new Map<string, InterviewAnswer>()) => fixtureCtx({
  household: HH,
  dependents: [kid],
  accounts: [plan529, brokerage],
  snapshots: [snap(9, 10_000), snap(2, 800_000)],
  interviewAnswers: answers,
});

describe('college_vs_retirement thread', () => {
  it('registered LAST, household scope, no per-instance subject', () => {
    expect(INTERVIEW_THREADS.map((t) => t.id)).toContain('college_vs_retirement');
    expect(INTERVIEW_THREADS[INTERVIEW_THREADS.length - 1].id).toBe('college_vs_retirement');
    expect(COLLEGE_VS_RETIREMENT_THREAD.title).toBe('College vs. retirement'); // CI-C1
    expect(COLLEGE_VS_RETIREMENT_THREAD.subject).toBeUndefined();
  });

  it('D-T3-2: neither dependents nor 529 → hidden (no false surfacing)', () => {
    expect(evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, fixtureCtx({ household: HH }), ''))
      .toEqual({ state: 'hidden' });
  });

  it('D-T3-5: an excluded-from-net-worth 529 does not surface the thread', () => {
    const ctx = fixtureCtx({
      household: HH,
      accounts: [makeAccount({ id: 9, type: AccountType.ACCOUNT_529, excludedFromNetWorth: true })],
    });
    expect(evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '')).toEqual({ state: 'hidden' });
  });

  it('dependent + 529 → asks q_monthly_amount (CI-C3), basis pinned to has-529', () => {
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, fullCtx(), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_monthly_amount');
    expect(r.node.prompt).toBe('About how much goes toward college savings each month?');
    expect(r.node.staleAfterMonths).toBe(12);
    expect(r.pinBasis?.branch).toBe('has-529');
  });

  it('529 but no dependents → asks q_target_year (CI-C2, stale 24mo, T2 compound arm)', () => {
    const ctx = fixtureCtx({ household: HH, accounts: [plan529], snapshots: [snap(9, 10_000)] });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_target_year');
    expect(r.node.prompt).toBe('When would college costs start?');
    expect(r.node.staleAfterMonths).toBe(24);
    // D-T3-9 as-shipped: T2's compound amount-month-year arm is the only
    // month-year control in the frozen kernel; the thread reads only its
    // targetMonth (see the '$123' leak guard below).
    expect(r.node.answer.kind).toBe('amount-month-year');
    expect(r.pinBasis?.branch).toBe('no-dependents-529');
  });

  it('dependent but no 529 → reply_tuition_only with CI-C22 + CI-C15 + CI-C17', () => {
    const ctx = fixtureCtx({ household: HH, dependents: [kid] });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply.kind).toBe('plan');
    if (r.reply.kind !== 'plan') return;
    expect(r.reply.title).toBe('College for Maya'); // CI-C4
    expect(r.reply.lines[1]).toBe('No 529 account is tracked in this app — nothing to project on the savings side.'); // CI-C22
    expect(r.reply.assumes).toContain('No state deduction encoded for CA.'); // CI-C15
    expect(r.reply.assumes[r.reply.assumes.length - 1])
      .toBe(`Published ${TUITION_BASE_ACADEMIC_YEAR} prices — verify with the school.`); // CI-C17 LAST
  });

  it('full tradeoff reply: every line byte-exact (composition of the pinned pure fns)', () => {
    const r = evaluateThread(
      COLLEGE_VS_RETIREMENT_THREAD, fullCtx(new Map([row('q_monthly_amount', '500', 'has-529')])), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') return;

    const t = getTuition('PUBLIC_4YR_IN_STATE', 'CA');
    const growth = TUITION_REAL_GROWTH.PUBLIC_4YR_IN_STATE;
    const target = computeCollegeTarget({
      annualTodayDollars: t.tuitionFees + t.housingFood,
      realGrowthPctPerYear: growth.pctPerYear, startMonthsAhead: 120,
    });
    const fv = project529Real({
      balanceTodayDollars: 10_000, monthlyDollars: 500, months: 120,
      nominalAnnualRate: 0.05, annualInflation: 0.03,
    });
    const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

    expect(r.reply.title).toBe('College for Maya');
    expect(r.reply.lines[0]).toBe(
      `Four years at public four-year in-state starting August 2036: ≈ ${fmt(target)} in today's dollars.`); // CI-C5
    expect(r.reply.lines[1]).toBe(
      `$10,000 across 529 accounts plus $500/mo grows to ≈ ${fmt(fv)} by August 2036 — moderate scenario, inflation-adjusted.`); // CI-C7 (≈ $78,225 — the Task-3 anchor)
    const gap = Math.round(target - fv);
    expect(r.reply.lines[2]).toBe(
      gap > 0 ? `About ${fmt(gap)} short of the target at this pace.`
        : gap < 0 ? `About ${fmt(-gap)} past the target at this pace.`
          : 'On the target at this pace.'); // CI-C8
    // fixtureCtx has expenses + 4% SWR → FI computable; the delta line's shape:
    expect(r.reply.lines[3]).toMatch(
      /^The same \$500\/mo toward retirement instead: ≈ \d+(\.\d)? years sooner to your FI target — two identical projections, one with this monthly amount added\.$/); // CI-C9
    // CI-C6 as AMENDED (review f2, coordinator ruling): a negative rate
    // reads as direction words — 'declining {x}% a year after inflation' —
    // never a hyphen-minus 'grown -{x}%'. Positive rates keep the original
    // 'grown {x}% a year above inflation' shape.
    expect(r.reply.assumes[0]).toBe(
      growth.pctPerYear < 0
        ? `Based on: published ${TUITION_BASE_ACADEMIC_YEAR} prices (${t.stateSpecific ? 'CA in-state tuition and fees' : 'national averages'}), declining ${Number(Math.abs(growth.pctPerYear).toFixed(2))}% a year after inflation.`
        : `Based on: published ${TUITION_BASE_ACADEMIC_YEAR} prices (${t.stateSpecific ? 'CA in-state tuition and fees' : 'national averages'}), grown ${Number(growth.pctPerYear.toFixed(2))}% a year above inflation.`); // CI-C6 (amended)
    // The current dataset's in-state rate IS negative — byte-pin the arm the
    // ternary above actually exercises, so it can never go inert:
    expect(r.reply.assumes[0]).toContain('declining 0.69% a year after inflation.');
    expect(JSON.stringify(r.reply)).not.toContain('grown -');
    expect(r.reply.assumes).toContain('These dollars count toward exactly one side.'); // CI-C12
    expect(r.reply.assumes).toContain("529 balances aren't counted in the FI target — education-earmarked."); // CI-C13
    expect(r.reply.assumes).toContain('No state deduction encoded for CA.'); // CI-C15
    expect(r.reply.assumes).toContain('Housing and food use the national average.'); // CI-C23 (CA hits the state table)
    expect(r.reply.assumes[r.reply.assumes.length - 1])
      .toBe(`Published ${TUITION_BASE_ACADEMIC_YEAR} prices — verify with the school.`); // CI-C17 LAST
    // Sentinel leak guard (D-T3-11): 999,999 must never render anywhere.
    expect(JSON.stringify(r.reply)).not.toContain('999,999');
  });

  it('multi-dependent: the soonest-to-18 is used and named (CI-C20)', () => {
    const ctx = fixtureCtx({
      household: HH,
      dependents: [makeDependent({ id: 2, name: 'Zoe', dateOfBirth: '2020-01-10' }), kid],
      accounts: [plan529], snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.title).toBe('College for Maya');
    expect(r.reply.assumes).toContain('Using Maya — the first to reach 18.'); // CI-C20
  });

  it('already-18 dependent: start now + CI-C21, never negative months', () => {
    const ctx = fixtureCtx({
      household: HH,
      dependents: [makeDependent({ id: 3, name: 'Ada', dateOfBirth: '2005-03-02' })],
      accounts: [plan529], snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.lines[0]).toContain('starting August 2026'); // ctx.today's month
    expect(r.reply.assumes).toContain("Ada is 18 or older — using today's published prices."); // CI-C21
  });

  it('no-dependents path: stored target month drives the card + CI-C19; the compound amount never renders', () => {
    const ctx = fixtureCtx({
      household: HH, accounts: [plan529], snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([
        // The compound arm forces an amount; the thread reads ONLY targetMonth.
        row('q_target_year', JSON.stringify({ amountDollars: 123, targetMonth: '2030-09' }), 'no-dependents-529'),
        row('q_monthly_amount', '500', 'has-529'),
      ]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.title).toBe('College plan'); // CI-C4 variant
    expect(r.reply.lines[0]).toContain('starting September 2030');
    expect(r.reply.assumes).toContain('Using your entered start date — no dependents are tracked in this app.'); // CI-C19
    expect(JSON.stringify(r.reply)).not.toContain('$123'); // captured-but-unused, never rendered
  });

  it('529 with no snapshot: CI-C7b, never a fabricated $0 balance', () => {
    const ctx = fixtureCtx({
      household: HH, dependents: [kid], accounts: [plan529], snapshots: [],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.lines[1]).toMatch(
      /^No balance snapshot for the 529 yet — \$500\/mo alone grows to ≈ \$[\d,]+ by August 2036 — moderate scenario, inflation-adjusted\.$/); // CI-C7b
  });

  it('determinism: identical ctx twice → deep-equal replies', () => {
    const answers = new Map([row('q_monthly_amount', '500', 'has-529')]);
    expect(evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, fullCtx(answers), ''))
      .toEqual(evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, fullCtx(answers), ''));
  });

  // ── Review f1: the deduction-hint branches, pinned where they actually flow ──

  it('CI-C16: an unlimited-sentinel state (NM) renders the exact hint and the sentinel NEVER leaks as dollars', () => {
    const nmHH = makeHousehold({
      state: 'NM', // UNLIMITED_DEDUCTION_SENTINEL for every filing status
      inflationAssumption: 0.03,
      growthScenarios: [{ label: 'moderate', rate: 0.05 }],
    });
    const ctx = fixtureCtx({
      household: nmHH, dependents: [kid],
      accounts: [plan529, brokerage],
      snapshots: [snap(9, 10_000), snap(2, 800_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.assumes).toContain(
      'NM allows an unlimited 529 deduction — confirm with the state DOR.'); // CI-C16
    // D-T3-11 leak guard on the path where the sentinel actually flows: a
    // dropped sentinel branch renders formatCurrency(999_999) = '$999,999'.
    const json = JSON.stringify(r.reply);
    expect(json).not.toContain('999,999');
    expect(json).not.toContain('$999');
  });

  it('CI-C14: a capped state (NY, MFJ) renders the exact hint including the filing label', () => {
    const nyHH = makeHousehold({
      state: 'NY', filingStatus: FilingStatus.MFJ, // NY MFJ cap: $10,000
      inflationAssumption: 0.03,
      growthScenarios: [{ label: 'moderate', rate: 0.05 }],
    });
    const ctx = fixtureCtx({
      household: nyHH, dependents: [kid],
      accounts: [plan529, brokerage],
      snapshots: [snap(9, 10_000), snap(2, 800_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.assumes).toContain(
      'NY allows deducting up to $10,000 of 529 contributions for married filing jointly filers — confirm with the state DOR.'); // CI-C14
  });

  it('CI-C18 + CI-C6 national variant: a state missing from the tuition table (DC) degrades honestly', () => {
    const dcHH = makeHousehold({
      state: 'DC', // in neither the 50-state tuition table nor the deduction table
      inflationAssumption: 0.03,
      growthScenarios: [{ label: 'moderate', rate: 0.05 }],
    });
    const ctx = fixtureCtx({
      household: dcHH, dependents: [kid],
      accounts: [plan529, brokerage],
      snapshots: [snap(9, 10_000), snap(2, 800_000)],
      interviewAnswers: new Map([row('q_monthly_amount', '500', 'has-529')]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected reply');
    expect(r.reply.assumes).toContain(
      'No DC in-state figure encoded — using the national average.'); // CI-C18 (table non-empty, DC absent)
    // CI-C6, national-averages + amended declining variant, byte-exact:
    expect(r.reply.assumes[0]).toBe(
      `Based on: published ${TUITION_BASE_ACADEMIC_YEAR} prices (national averages), declining 0.69% a year after inflation.`);
    expect(r.reply.assumes).toContain('No state deduction encoded for DC.'); // CI-C15
    // National basis ⇒ no CI-C23 housing note (its condition is state-specific):
    expect(r.reply.assumes).not.toContain('Housing and food use the national average.');
  });

  // ── Review f3: corrupt compound row (D-GI16) ──

  it('D-GI16: a corrupt q_target_year compound row re-asks as unanswered with no prior-answer preamble', () => {
    const ctx = fixtureCtx({
      household: HH, accounts: [plan529], snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([
        // Schema-invalid: amountDollars missing, targetMonth a number.
        row('q_target_year', '{"targetMonth":12}', 'no-dependents-529'),
      ]),
    });
    const r = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, ctx, '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_target_year');
    expect(r.reason).toBe('unanswered');
    expect(r.priorAnswer).toBeNull();
  });
});
