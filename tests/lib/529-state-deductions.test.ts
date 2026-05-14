import { describe, it, expect } from 'vitest';
import { get529DeductionForState } from '@/lib/529-state-deductions';

describe('get529DeductionForState', () => {
  it('returns deduction info for NY', () => {
    const info = get529DeductionForState('NY', 'MFJ');
    expect(info).not.toBeNull();
    expect(info!.maxAmount).toBe(10000);
  });

  it('returns deduction info for IL', () => {
    const info = get529DeductionForState('IL', 'SINGLE');
    expect(info).not.toBeNull();
    expect(info!.maxAmount).toBe(10000);
  });

  it('returns null for states with no 529 deduction', () => {
    expect(get529DeductionForState('CA', 'SINGLE')).toBeNull();
    expect(get529DeductionForState('TX', 'SINGLE')).toBeNull();
  });
});

describe('get529DeductionForState — bonus coverage', () => {
  it('returns the right amount for all four filing statuses in NY', () => {
    expect(get529DeductionForState('NY', 'SINGLE')!.maxAmount).toBe(5000);
    expect(get529DeductionForState('NY', 'MFJ')!.maxAmount).toBe(10000);
    expect(get529DeductionForState('NY', 'MFS')!.maxAmount).toBe(5000);
    expect(get529DeductionForState('NY', 'HOH')!.maxAmount).toBe(5000);
  });

  it('returns matching amounts for per-account states (VA) across SINGLE and MFJ', () => {
    const vaSingle = get529DeductionForState('VA', 'SINGLE');
    const vaMfj = get529DeductionForState('VA', 'MFJ');
    expect(vaSingle).not.toBeNull();
    expect(vaMfj).not.toBeNull();
    expect(vaSingle!.maxAmount).toBe(vaMfj!.maxAmount);
    expect(vaSingle!.maxAmount).toBe(4000);
  });

  it('doubles the SINGLE amount for MFJ in per-taxpayer states (IL)', () => {
    expect(get529DeductionForState('IL', 'SINGLE')!.maxAmount).toBe(10000);
    expect(get529DeductionForState('IL', 'MFJ')!.maxAmount).toBe(20000);
  });

  it('returns null for an invalid state code', () => {
    expect(get529DeductionForState('XX', 'SINGLE')).toBeNull();
    expect(get529DeductionForState('ZZ', 'MFJ')).toBeNull();
  });

  it('exposes the state code in the returned object', () => {
    const info = get529DeductionForState('PA', 'MFJ');
    expect(info).not.toBeNull();
    expect(info!.state).toBe('PA');
    expect(info!.maxAmount).toBe(36000);
  });

  it('flags the unlimited-deduction sentinel for NM via notes', () => {
    const info = get529DeductionForState('NM', 'SINGLE');
    expect(info).not.toBeNull();
    expect(info!.maxAmount).toBeGreaterThanOrEqual(999999);
    expect(info!.notes).toBeTruthy();
    expect(info!.notes!.toLowerCase()).toContain('unlimited');
  });
});
