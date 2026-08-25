import { describe, it, expect } from 'vitest';
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
    answeredAt: '2026-07-01T00:00:00.000Z', basisJson: '{"branch":"signal"}',
  },
];

describe('vehicle_replacement thread', () => {
  it('registered after next_dollar; per-vehicle subject', () => {
    // Wave T2 appended home_purchase (registry order is the surface order).
    expect(INTERVIEW_THREADS.map((t) => t.id)).toEqual(['next_dollar', 'vehicle_replacement', 'home_purchase']);
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
