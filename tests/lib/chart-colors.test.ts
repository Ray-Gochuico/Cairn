import { describe, it, expect } from 'vitest';
import {
  colorForAccount,
  colorForTicker,
  colorForLoan,
  colorForEntityKey,
} from '@/lib/chart-colors';
import { WEDGE_PALETTE } from '@/components/charts/palette';

describe('colorForAccount', () => {
  it('returns the override when a non-empty hex is supplied', () => {
    expect(colorForAccount(1, '#123456')).toBe('#123456');
  });

  it('falls back to the deterministic default when override is null or undefined', () => {
    expect(colorForAccount(1, null)).toBe(colorForAccount(1));
    expect(colorForAccount(1, undefined)).toBe(colorForAccount(1));
  });

  it('returns the same default for the same account id on repeated calls', () => {
    expect(colorForAccount(42)).toBe(colorForAccount(42));
  });

  it('returns different defaults for neighboring account ids', () => {
    expect(colorForAccount(1)).not.toBe(colorForAccount(2));
  });

  it('returns a value from WEDGE_PALETTE', () => {
    expect(WEDGE_PALETTE).toContain(colorForAccount(123));
  });

  it('handles id = 0 without throwing', () => {
    expect(() => colorForAccount(0)).not.toThrow();
  });
});

describe('colorForTicker', () => {
  it('returns the override when a non-empty hex is supplied', () => {
    expect(colorForTicker('AAPL', '#abcdef')).toBe('#abcdef');
  });

  it('falls back to the deterministic default when override is null or undefined', () => {
    expect(colorForTicker('AAPL', null)).toBe(colorForTicker('AAPL'));
    expect(colorForTicker('AAPL', undefined)).toBe(colorForTicker('AAPL'));
  });

  it('returns a stable default for the same ticker on repeated calls', () => {
    expect(colorForTicker('MSFT')).toBe(colorForTicker('MSFT'));
  });

  it('returns a value from WEDGE_PALETTE', () => {
    expect(WEDGE_PALETTE).toContain(colorForTicker('VTI'));
  });

  it('handles the empty string without throwing', () => {
    expect(() => colorForTicker('')).not.toThrow();
  });
});

describe('colorForLoan', () => {
  it('returns a WEDGE_PALETTE color', () => {
    expect(WEDGE_PALETTE).toContain(colorForLoan(7));
  });
  it('is stable per id and differs for neighboring ids', () => {
    expect(colorForLoan(7)).toBe(colorForLoan(7));
    expect(colorForLoan(1)).not.toBe(colorForLoan(2));
  });
  it('returns the override when a non-empty hex is supplied', () => {
    expect(colorForLoan(3, '#123456')).toBe('#123456');
  });
  it('handles id = 0 without throwing', () => {
    expect(() => colorForLoan(0)).not.toThrow();
  });
});

describe('colorForEntityKey', () => {
  it('returns a WEDGE_PALETTE color and is stable per key', () => {
    expect(WEDGE_PALETTE).toContain(colorForEntityKey('property:1'));
    expect(colorForEntityKey('property:1')).toBe(colorForEntityKey('property:1'));
  });
  it('separates same-id different-kind keys', () => {
    expect(colorForEntityKey('property:1')).not.toBe(colorForEntityKey('vehicle:1'));
  });
  it('returns the override when a non-empty hex is supplied', () => {
    expect(colorForEntityKey('property:1', '#abcdef')).toBe('#abcdef');
  });
});
