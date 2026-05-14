import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentTaxYear, resolveTaxYear, type TaxYearResult } from '@/lib/current-tax-year';

describe('resolveTaxYear', () => {
  it('returns current year with isCurrent=true when current year is in the seeded set', () => {
    const seededYears = [2025, 2026];
    const calendarYear = 2026;
    const result = resolveTaxYear(calendarYear, seededYears);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: true });
  });

  it('falls back to most-recent seeded year with isCurrent=false when current year is not seeded', () => {
    const seededYears = [2025, 2026];
    const calendarYear = 2027;
    const result = resolveTaxYear(calendarYear, seededYears);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: false });
  });

  it('returns isCurrent=false when seeded set is empty', () => {
    const result = resolveTaxYear(2026, []);
    expect(result.isCurrent).toBe(false);
    expect(result.year).toBeNull();
  });

  it('returns isCurrent=true when only one year is seeded and it matches', () => {
    const result = resolveTaxYear(2026, [2026]);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: true });
  });

  it('falls back to most-recent (not nearest) when calendar year is older than seeded set', () => {
    const result = resolveTaxYear(2024, [2025, 2026]);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: false });
  });

  it('handles unsorted seededYears via Math.max', () => {
    const result = resolveTaxYear(2027, [2026, 2024, 2025]);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: false });
  });
});

describe('getCurrentTaxYear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the system clock to resolve against the seeded set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const result = getCurrentTaxYear([2025, 2026]);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: true });
  });

  it('falls back to most-recent seeded year when current calendar year is not seeded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-01-01T00:00:00Z'));
    const result = getCurrentTaxYear([2025, 2026]);
    expect(result).toEqual<TaxYearResult>({ year: 2026, isCurrent: false });
  });
});
