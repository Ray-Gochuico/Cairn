import { describe, it, expect } from 'vitest';
import { anyInterviewAsk } from '@/domain/interview/census';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { PropertyType } from '@/types/enums';
import { makeHousehold, makeProperty, makeVehicle } from '../../factories';
import { fixtureCtx } from '../../lib/interview/fixture';
import type { HousingPayment } from '@/types/schema';

const rent = (): HousingPayment => ({
  id: 1, householdId: 1, ownerPersonId: null, name: 'Rent',
  monthlyAmount: 2200, startDate: '2025-01-01', endDate: null,
} as HousingPayment);
const owner = () => [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })];
const CATS = [
  { id: 2, name: 'Vehicles', parentCategoryId: null, type: 'NEED' },
  { id: 18, name: 'Vehicle Maintenance', parentCategoryId: 2, type: 'NEED' },
] as never[];

describe('anyInterviewAsk (R4 D-R4-9 — the G9 census)', () => {
  it('false when no strip thread surfaces (owner, no vehicles, no dependents/529, cash-only balances)', () => {
    expect(anyInterviewAsk(fixtureCtx({ properties: owner() }))).toBe(false);
  });
  it('true when the home thread asks (a renter with no stored answer)', () => {
    expect(anyInterviewAsk(fixtureCtx({ housingPayments: [rent()] }))).toBe(true);
  });
  it('false once every surfaced thread replies', () => {
    const answers = new Map<string, InterviewAnswer>([[
      answerKey('home_purchase', 'q_want_house', ''),
      { id: 1, householdId: 1, threadId: 'home_purchase', questionId: 'q_want_house', subjectKey: '',
        valueJson: '"no"', questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"not-owner"}' },
    ]]);
    expect(anyInterviewAsk(fixtureCtx({ housingPayments: [rent()], interviewAnswers: answers }))).toBe(false);
  });
  it('true for a per-vehicle ask (a firing age signal)', () => {
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 6000 }),
      properties: owner(), categories: CATS,
      vehicles: [makeVehicle({ id: 7, name: 'Old Wagon', year: 2014 })],
    });
    expect(anyInterviewAsk(ctx)).toBe(true);
  });
});
