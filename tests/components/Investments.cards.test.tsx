import { describe, it, expect } from 'vitest';
import { applyCardLayout, type InvestmentsCardEntry } from '@/lib/investments-card-layout';

describe('investments card registry contract', () => {
  it('keeps compact cards groupable: donuts are contiguous in the default order', () => {
    const reg: InvestmentsCardEntry[] = [
      { id: 'growth', label: 'g', size: 'wide', applicable: true, render: () => null },
      { id: 'allocation', label: 'a', size: 'compact', applicable: true, render: () => null },
      { id: 'per-company', label: 'p', size: 'compact', applicable: true, render: () => null },
      { id: 'sector', label: 's', size: 'compact', applicable: true, render: () => null },
    ];
    const out = applyCardLayout(reg, null).map((c) => c.size);
    expect(out).toEqual(['wide', 'compact', 'compact', 'compact']);
  });
});
