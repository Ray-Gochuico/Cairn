import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DatePicker from '@/components/ui/DatePicker';

describe('DatePicker group semantics', () => {
  it('exposes a labeled group wrapping contextualized Year/Month/Day selects', () => {
    render(<DatePicker value="2026-07-02" onChange={() => {}} label="Purchase date" />);
    const group = screen.getByRole('group', { name: 'Purchase date' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Purchase date year' })).toHaveValue('2026');
    expect(screen.getByRole('combobox', { name: 'Purchase date month' })).toHaveValue('07');
    expect(screen.getByRole('combobox', { name: 'Purchase date day' })).toHaveValue('02');
  });
  it('falls back to bare Year/Month/Day names without a label', () => {
    render(<DatePicker value="" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeInTheDocument();
  });
});

describe('v1.8.0 A-2′: the default year cap is the LOCAL year + 1', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  const newestYear = () => {
    render(<DatePicker value="" onChange={() => {}} label="Purchase date" />);
    return (screen.getByRole('combobox', { name: 'Purchase date year' }) as HTMLSelectElement).options[1].value;
  };

  it('Los Angeles, Dec 31, 2025 19:00 PST (UTC Jan 1, 2026): 2026', () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
    expect(newestYear()).toBe('2026');
  });

  it('Pacific/Auckland, Jan 1, 2026 09:00 NZDT (UTC Dec 31, 2025): 2027', () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2025-12-31T20:00:00Z'));
    expect(newestYear()).toBe('2027');
  });
});
