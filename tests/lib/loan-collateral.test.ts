import { describe, it, expect } from 'vitest';
import { loanHasExcludedCollateral } from '@/lib/loan-collateral';

const loan = (over: Partial<{ id: number; linkedPropertyId: number | null; linkedVehicleId: number | null }> = {}) => ({
  id: 1,
  linkedPropertyId: null,
  linkedVehicleId: null,
  ...over,
});
const prop = (over: Partial<{ id: number; linkedLoanId: number | null; excludedFromNetWorth: boolean }> = {}) => ({
  id: 10,
  linkedLoanId: null,
  excludedFromNetWorth: false,
  ...over,
});
const veh = (over: Partial<{ id: number; excludedFromNetWorth: boolean }> = {}) => ({
  id: 20,
  excludedFromNetWorth: false,
  ...over,
});

describe('loanHasExcludedCollateral', () => {
  it('true via the property→loan direction (property.linkedLoanId)', () => {
    expect(
      loanHasExcludedCollateral(loan(), [prop({ linkedLoanId: 1, excludedFromNetWorth: true })], []),
    ).toBe(true);
  });

  it('true via the loan→property direction (loan.linkedPropertyId)', () => {
    expect(
      loanHasExcludedCollateral(loan({ linkedPropertyId: 10 }), [prop({ excludedFromNetWorth: true })], []),
    ).toBe(true);
  });

  it('true via an excluded linked vehicle', () => {
    expect(
      loanHasExcludedCollateral(loan({ linkedVehicleId: 20 }), [], [veh({ excludedFromNetWorth: true })]),
    ).toBe(true);
  });

  it('false when the linked collateral is included', () => {
    expect(
      loanHasExcludedCollateral(loan({ linkedPropertyId: 10 }), [prop()], [veh()]),
    ).toBe(false);
  });

  it('false when nothing links to the loan', () => {
    expect(
      loanHasExcludedCollateral(loan(), [prop({ excludedFromNetWorth: true })], [veh({ excludedFromNetWorth: true })]),
    ).toBe(false);
  });
});
