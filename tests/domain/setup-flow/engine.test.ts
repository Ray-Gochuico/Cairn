import { describe, it, expect } from 'vitest';
import {
  visibleInstances, effectiveStatus, resumeTarget, partPosition, partStatus,
  resolveBindings, visibilityInputOf, nextInstance, prevInstance, GATE_ENTITY_COUNT,
} from '@/domain/setup-flow/engine';
import type { FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2, type SetupProgressV2 } from '@/lib/setup-progress';
import { makeHousehold, makePerson, makeLoan } from '../../factories';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(),
    persons: [], dependents: [], accounts: [], properties: [], housingPayments: [],
    vehicles: [], vehicleLeases: [], equityGrants: [], loans: [], transactions: [], goals: [],
    progress: defaultProgressV2(),
    todayIso: '2026-08-09',
    ...overrides,
  };
}
const progressWith = (patch: Partial<SetupProgressV2>): SetupProgressV2 => ({
  ...defaultProgressV2(), ...patch,
});

describe('setup-flow engine', () => {
  it('solo spine: 15 visible instances (no partner, no rent gate), in order', () => {
    const keys = visibleInstances(ctxWith()).map((i) => i.key);
    expect(keys).toEqual([
      'about_you', 'marital_filing', 'state_city', 'dependents_gate', 'expenses',
      'pay:you', 'retirement:you', 'benefits:you',
      'accounts_gate', 'home_gate', 'vehicles_gate', 'equity_gate',
      'loans_gate', 'import_gate', 'goals_gate',
    ]);
  });

  it('couple spine: Part 2 iterates WHOLE role blocks you → partner', () => {
    const ctx = ctxWith({
      progress: progressWith({ drafts: { partner: { name: 'Sam', dateOfBirth: '1991-02-03' } } }),
    });
    const part2 = visibleInstances(ctx).filter((i) => i.part === 2).map((i) => i.key);
    expect(part2).toEqual([
      'pay:you', 'retirement:you', 'benefits:you',
      'pay:partner', 'retirement:partner', 'benefits:partner',
    ]);
  });

  it('rent_gate appears once home_gate is skipped', () => {
    const ctx = ctxWith({ progress: progressWith({ statuses: { home_gate: 'skipped' } }) });
    expect(visibleInstances(ctx).map((i) => i.key)).toContain('rent_gate');
  });

  it('gate honesty: skipped-with-data and yes-with-zero are both in_progress', () => {
    const loans = [makeLoan({ id: 1 }), makeLoan({ id: 2 })];
    const skippedWithData = ctxWith({
      loans, progress: progressWith({ statuses: { loans_gate: 'skipped' } }),
    });
    const gate = { id: 'loans_gate' as const, key: 'loans_gate', part: 4 as const };
    expect(effectiveStatus(gate, skippedWithData)).toBe('in_progress');
    const yesWithZero = ctxWith({ progress: progressWith({ statuses: { loans_gate: 'completed' } }) });
    expect(effectiveStatus(gate, yesWithZero)).toBe('in_progress');
    // non-gate steps pass stored status through
    const q = { id: 'expenses' as const, key: 'expenses', part: 1 as const };
    expect(effectiveStatus(q, ctxWith({ progress: progressWith({ statuses: { expenses: 'skipped' } }) })))
      .toBe('skipped');
    expect(GATE_ENTITY_COUNT.loans_gate(skippedWithData)).toBe(2);
  });

  it('resume: valid incomplete cursor wins even over an earlier honesty-downgraded gate', () => {
    const ctx = ctxWith({
      loans: [makeLoan({ id: 1 })],
      progress: progressWith({
        statuses: {
          about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
          dependents_gate: 'skipped', expenses: 'completed',
          'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
          accounts_gate: 'skipped', // but ctx has no accounts → stays skipped-complete
          home_gate: 'skipped', rent_gate: 'skipped', vehicles_gate: 'skipped', equity_gate: 'skipped',
          loans_gate: 'in_progress',
        },
        cursor: { stepId: 'loans_gate' },
      }),
    });
    expect(resumeTarget(ctx)?.key).toBe('loans_gate');
  });

  it('resume: a completed cursor falls back to the FIRST visible incomplete instance', () => {
    const ctx = ctxWith({
      loans: [makeLoan({ id: 1 })], // loans exist but loans_gate was recorded skipped → honesty
      progress: progressWith({
        statuses: {
          about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
          dependents_gate: 'skipped', expenses: 'completed',
          'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
          accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
          vehicles_gate: 'skipped', equity_gate: 'skipped',
          loans_gate: 'skipped', import_gate: 'skipped', goals_gate: 'skipped',
        },
        cursor: { stepId: 'about_you' }, // completed → fall back
      }),
    });
    expect(resumeTarget(ctx)?.key).toBe('loans_gate'); // the honesty-downgraded gate
  });

  it('M4: the cursor wins over an EARLIER visible incomplete instance', () => {
    // accounts_gate is 'completed' with zero accounts → honesty-downgraded to
    // in_progress, i.e. an earlier visible incomplete instance exists. The
    // cursor points at loans_gate (in_progress) — the resume rule's cursor
    // clause must win; deleting that clause would land on accounts_gate.
    const ctx = ctxWith({
      progress: progressWith({
        statuses: {
          about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
          dependents_gate: 'skipped', expenses: 'completed',
          'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
          accounts_gate: 'completed', // 0 accounts → effectiveStatus in_progress
          home_gate: 'skipped', rent_gate: 'skipped',
          vehicles_gate: 'skipped', equity_gate: 'skipped',
          loans_gate: 'in_progress',
        },
        cursor: { stepId: 'loans_gate' },
      }),
    });
    expect(resumeTarget(ctx)?.key).toBe('loans_gate');
  });

  it('resume: everything complete → null (shell shows Finish)', () => {
    // NOTE: home_gate 'skipped' makes rent_gate VISIBLE (D-WF9), so a truly
    // all-complete record must carry a rent_gate status too — the plan's test
    // sketch omitted it, which left a visible incomplete step (the spec's
    // resume rule correctly lands there, not on Finish).
    const ctx = ctxWith({
      progress: progressWith({
        statuses: {
          about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
          dependents_gate: 'skipped', expenses: 'completed',
          'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
          accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
          vehicles_gate: 'skipped',
          equity_gate: 'skipped', loans_gate: 'skipped', import_gate: 'skipped', goals_gate: 'skipped',
        },
      }),
    });
    expect(resumeTarget(ctx)).toBeNull();
  });

  it('partPosition arithmetic (CW-2): solo expenses = 5 of 5; couple pay:partner = 4 of 6', () => {
    const solo = ctxWith();
    const expenses = visibleInstances(solo).find((i) => i.key === 'expenses')!;
    expect(partPosition(expenses, solo)).toEqual({ index: 5, count: 5 });
    const couple = ctxWith({
      progress: progressWith({ drafts: { partner: { name: 'Sam', dateOfBirth: '1991-02-03' } } }),
    });
    const payPartner = visibleInstances(couple).find((i) => i.key === 'pay:partner')!;
    expect(partPosition(payPartner, couple)).toEqual({ index: 4, count: 6 });
  });

  it('partStatus mirrors the section derivation rules over EFFECTIVE statuses', () => {
    const ctx = ctxWith({
      loans: [makeLoan({ id: 1 })],
      progress: progressWith({ statuses: { loans_gate: 'skipped' } }), // honesty → in_progress
    });
    expect(partStatus(4, ctx)).toBe('in_progress');
    expect(partStatus(1, ctx)).toBe('pending');
  });

  it('next/prev walk the visible instance order', () => {
    const ctx = ctxWith();
    const list = visibleInstances(ctx);
    expect(nextInstance(list[0], ctx)?.key).toBe('marital_filing');
    expect(prevInstance(list[0], ctx)).toBeNull();
    expect(nextInstance(list[list.length - 1], ctx)).toBeNull();
  });

  it('resolveBindings: explicit bindings win; else persons[0] / first-other fallback', () => {
    const a = makePerson({ id: 1, name: 'Alex' });
    const b = makePerson({ id: 2, name: 'Sam' });
    const noBindings = ctxWith({ persons: [a, b] });
    expect(resolveBindings(noBindings)).toEqual({ you: a, partner: b });
    const flipped = ctxWith({
      persons: [a, b],
      progress: progressWith({ bindings: { you: 2, partner: 1 } }),
    });
    expect(resolveBindings(flipped)).toEqual({ you: b, partner: a });
    expect(visibilityInputOf(noBindings).hasPartner).toBe(true);
    expect(visibilityInputOf(ctxWith({ persons: [a] })).hasPartner).toBe(false);
  });
});
