import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluateThread } from '@/domain/interview/evaluate';
import { VEHICLE_REPLACEMENT_THREAD } from '@/domain/interview/threads/vehicle-replacement';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { makeHousehold, makeVehicle } from '../../factories';
import { fixtureCtx } from '../../lib/interview/fixture';

const CATS = [
  { id: 2, name: 'Vehicles', parentCategoryId: null, type: 'NEED' },
  { id: 18, name: 'Vehicle Maintenance', parentCategoryId: 2, type: 'NEED' },
] as never[];

const signalCtx = (answers: Map<string, InterviewAnswer> = new Map()) => fixtureCtx({
  household: makeHousehold({
    monthlyExpenseBaseline: 6000,
    growthScenarios: [{ label: 'low', rate: 0.03 }, { label: 'moderate', rate: 0.05 }, { label: 'high', rate: 0.07 }],
  }),
  vehicles: [makeVehicle({ id: 7, name: 'Old Wagon', year: 2014, currentEstimatedValue: 8000 })],
  categories: CATS,
  interviewAnswers: answers,
});

const row = (questionId: string, valueJson: string, version = 1): [string, InterviewAnswer] => [
  answerKey('vehicle_replacement', questionId, 'vehicle:7'),
  {
    id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId,
    subjectKey: 'vehicle:7', valueJson, questionVersion: version,
    answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
  },
];

describe('vehicle_replacement thread', () => {
  it('registered after next_dollar; per-vehicle subject', () => {
    // Wave T2 appended home_purchase (registry order is the surface order).
    expect(INTERVIEW_THREADS.map((t) => t.id)).toEqual(['next_dollar', 'vehicle_replacement', 'home_purchase', 'college_vs_retirement']);
    expect(VEHICLE_REPLACEMENT_THREAD.subject).toEqual({ kind: 'vehicle' });
  });

  it('no signal → hidden (quiet 2022 car with no data)', () => {
    const ctx = fixtureCtx({ vehicles: [makeVehicle({ id: 7, year: 2022 })], categories: CATS });
    expect(evaluateThread(VEHICLE_REPLACEMENT_THREAD, ctx, 'vehicle:7')).toEqual({ state: 'hidden' });
  });

  it('age signal fires → asks q_keep_horizon with the vehicle named and the basis pinned', () => {
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, signalCtx(), 'vehicle:7');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_keep_horizon');
    const prompt = typeof r.node.prompt === 'function' ? r.node.prompt(signalCtx(), 'vehicle:7') : r.node.prompt;
    expect(prompt).toBe('Are there plans to replace Old Wagon?');
    expect(r.pinBasis?.branch).toBe('signal');
    expect((r.pinBasis?.facts as { firing: string[] }).firing).toEqual(['age']);
  });

  it("'no-plans' → reply_no_plans with CI-41 basis + CI-46, staleAfterMonths 12", () => {
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, signalCtx(new Map([row('q_keep_horizon', '"no-plans"')])), 'vehicle:7');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply).toEqual({
      kind: 'info',
      lines: [
        'Based on: model year (2014).',
        'Nothing computed — you said no replacement plans. This question comes back in 12 months.',
      ],
    });
  });

  it("'replace-within-2y' → asks the budget; answered → the plan reply with hand-computed math", () => {
    const asking = evaluateThread(VEHICLE_REPLACEMENT_THREAD, signalCtx(new Map([row('q_keep_horizon', '"replace-within-2y"')])), 'vehicle:7');
    expect(asking.state).toBe('ask');
    if (asking.state === 'ask') expect(asking.node.id).toBe('q_replacement_budget');

    const answered = signalCtx(new Map([row('q_keep_horizon', '"replace-within-2y"'), row('q_replacement_budget', '30000')]));
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, answered, 'vehicle:7');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply.kind).toBe('plan');
    if (r.reply.kind !== 'plan') return;
    // Hand-computed: 12-month horizon (within-2y midpoint), budget $30,000,
    // moderate 5%: linear = 30,000/12 = $2,500/mo; annuity PMT at r=0.05/12,
    // n=12: 30,000×0.0041667/((1.0041667)^12 − 1) = 125/0.0511619 = $2,443.
    expect(r.reply.lines).toEqual([
      'Current value: $8,000',
      'Based on: model year (2014).',
      'Saving $2,500/mo covers a $30,000 replacement by August 2027; about $2,443/mo if savings grow at 5% (moderate scenario).',
    ]);
    expect(r.reply.assumes).toContain(
      "Assumes no trade-in credit — the current car's value isn't netted against the target.",
    );
  });

  it('CI-42: the repair honesty line is verbatim when the repair signal fires', () => {
    // Pin (CB-8, Wave A deviation #8): the string shipped unpinned. Drive a
    // plan reply whose firing includes 'repairs' — $1,500 categorized repair
    // spend in the trailing 12 months (≥ the $1,200 threshold).
    const ctx = fixtureCtx({
      household: makeHousehold({
        monthlyExpenseBaseline: 6000,
        growthScenarios: [{ label: 'low', rate: 0.03 }, { label: 'moderate', rate: 0.05 }, { label: 'high', rate: 0.07 }],
      }),
      vehicles: [makeVehicle({ id: 7, name: 'Old Wagon', year: 2014, currentEstimatedValue: 8000 })],
      categories: CATS,
      transactions: [
        { date: '2026-05-01', amount: 1500, categoryId: 18, vehicleId: 7, reimbursable: false, reimbursedAt: null } as never,
      ],
      interviewAnswers: new Map([
        row('q_keep_horizon', '"replace-within-2y"'),
        row('q_replacement_budget', '30000'),
      ]),
    });
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, ctx, 'vehicle:7');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply.lines).toContain(
      'Repair spend counts categorized imported transactions only — categorization is merchant-name matching.',
    );
  });

  it('the answered basis invalidates when the branch changes (CI-37 machinery)', () => {
    // Pin says the answer sat on a DIFFERENT branch string → re-ask.
    const stale = new Map([row('q_keep_horizon', '"no-plans"')]);
    stale.get(answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'))!.basisJson = '{"branch":"quiet"}';
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, signalCtx(stale), 'vehicle:7');
    expect(r.state).toBe('ask');
    if (r.state === 'ask') expect(r.reason).toBe('basis-changed');
  });
});

describe('U8/U9 — the horizon month and the goal months come from the LOCAL month, never a Date (ruling 1)', () => {
  const planned = (today: Date, horizon: string) => {
    const ctx = { ...signalCtx(new Map([row('q_keep_horizon', `"${horizon}"`), row('q_replacement_budget', '30000')])), today };
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, ctx, 'vehicle:7');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected a plan reply');
    return r.reply.lines[2];
  };

  it('day-31 overflow: Aug 31 + 42 months reads February 2030 with 42 months of saving (shipped: "March 2030", 43 months, $698/$638)', () => {
    // linear 30,000 / 42 = 714.29 → $714; annuity PMT at r = 0.05/12, n = 42:
    // (1+r)^42 = 1.190815 → 30,000 × 0.0041667 / 0.190815 = $655.09 → $655.
    expect(planned(new Date(2026, 7, 31), 'replace-2-5y')).toBe(
      'Saving $714/mo covers a $30,000 replacement by February 2030; about $655/mo if savings grow at 5% (moderate scenario).',
    );
  });

  it('day-31 control: Jan 31 + 12 months reads January 2027 (both idioms agree — January has 31 days)', () => {
    expect(planned(new Date(2026, 0, 31), 'replace-within-2y')).toContain('by January 2027;');
  });
});

describe('U9 — Pacific/Auckland: the local 1st counts months from the LOCAL month through the utcNoonOf bridge', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'Pacific/Auckland'; });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  it('local Sep 1 2026 + 12 months → "by September 2027", 12 months ($2,500 / $2,443) — the UTC day read August', () => {
    const ctx = { ...signalCtx(new Map([row('q_keep_horizon', '"replace-within-2y"'), row('q_replacement_budget', '30000')])), today: new Date(2026, 8, 1) };
    const r = evaluateThread(VEHICLE_REPLACEMENT_THREAD, ctx, 'vehicle:7');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected a plan reply');
    expect(r.reply.lines[2]).toBe(
      'Saving $2,500/mo covers a $30,000 replacement by September 2027; about $2,443/mo if savings grow at 5% (moderate scenario).',
    );
  });
});
