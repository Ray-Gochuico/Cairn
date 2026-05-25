import { describe, it, expect } from 'vitest';
import { summarizeLevers } from '@/lib/whatif/lever-summary';
import { emptyLeverPayload, type LeverPayload } from '@/lib/scenarios';

describe('summarizeLevers', () => {
  it('returns "No overrides" for an empty payload', () => {
    expect(summarizeLevers(emptyLeverPayload(), { loanNames: {} })).toBe('No overrides');
  });

  it('summarizes a single extra-loan-payment with named loan and Always window', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
    };
    expect(summarizeLevers(payload, { loanNames: { 1: 'Auto loan' } })).toBe(
      '+$300/mo on Auto loan (Always)',
    );
  });

  it('summarizes a windowed extra-loan-payment with start and end', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      extraLoanPayments: [
        { loanId: 1, extraMonthly: 300, start: '2026-07-01', end: '2029-06-01' },
      ],
    };
    expect(summarizeLevers(payload, { loanNames: { 1: 'Auto loan' } })).toBe(
      '+$300/mo on Auto loan (2026-07 → 2029-06)',
    );
  });

  it('falls back to "Loan #N" when a loan name is missing', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      extraLoanPayments: [{ loanId: 7, extraMonthly: 100 }],
    };
    expect(summarizeLevers(payload, { loanNames: {} })).toBe('+$100/mo on Loan #7 (Always)');
  });

  it('joins multiple lever categories with semicolons', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
      lumpSums: [
        { when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' },
      ],
    };
    const summary = summarizeLevers(payload, { loanNames: { 1: 'Auto loan' } });
    expect(summary).toContain('+$300/mo on Auto loan (Always)');
    expect(summary).toContain('Lump sum 2030-06: +$25,000');
    expect(summary.split('; ')).toHaveLength(2);
  });

  it('summarizes returns overrides as "Returns: 2 years overridden"', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      returns: {
        defaultRate: 0.07,
        overrides: { '2027': -0.15, '2028': 0.2 },
      },
    };
    expect(summarizeLevers(payload, { loanNames: {} })).toContain('Returns: 2 years overridden');
  });

  it('summarizes a contribution segment with year-range window', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      contributions: [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000 }],
    };
    expect(summarizeLevers(payload, { loanNames: {} })).toContain('Contribute +$1,000/mo (Y1-5)');
  });

  it('summarizes an open-ended contribution segment with ∞ end', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      contributions: [{ startMonth: 240, endMonth: null, monthlyAmount: 3000 }],
    };
    expect(summarizeLevers(payload, { loanNames: {} })).toContain('Contribute +$3,000/mo (Y21-∞)');
  });

  it('summarizes a non-default annual raise rate per person', () => {
    const payload: LeverPayload = {
      ...emptyLeverPayload(),
      income: {
        perPerson: [
          { annualRaiseRate: 0.05, events: [] },
          {
            annualRaiseRate: 0.04,
            events: [{ when: '2028-04-01', type: 'promotion', newSalary: 168000 }],
          },
        ],
      },
    };
    const summary = summarizeLevers(payload, { loanNames: {} });
    expect(summary).toContain('Raises: 5% / 4%');
    expect(summary).toContain('Income events: 1');
  });
});
