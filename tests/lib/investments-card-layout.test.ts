import { describe, it, expect } from 'vitest';
import {
  applyCardLayout,
  type InvestmentsCardEntry,
} from '@/lib/investments-card-layout';

// Minimal registry entries; render is irrelevant to the pure helper.
const entry = (
  id: string,
  size: 'wide' | 'compact' = 'wide',
  applicable = true,
): InvestmentsCardEntry => ({ id, label: id, size, applicable, render: () => null });

const REG: InvestmentsCardEntry[] = [
  entry('a'),
  entry('b'),
  entry('c'),
  entry('cond', 'wide', false), // not applicable
];

describe('applyCardLayout', () => {
  it('null layout → applicable defaults in declaration order', () => {
    expect(applyCardLayout(REG, null).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders by the overlay and drops hidden', () => {
    const layout = [
      { id: 'c', hidden: false },
      { id: 'a', hidden: true },
      { id: 'b', hidden: false },
    ];
    expect(applyCardLayout(REG, layout).map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('appends applicable cards missing from the overlay (new cards auto-appear)', () => {
    const layout = [{ id: 'b', hidden: false }];
    expect(applyCardLayout(REG, layout).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('never includes non-applicable cards, even if listed in the overlay', () => {
    const layout = [{ id: 'cond', hidden: false }, { id: 'a', hidden: false }];
    // 'cond' is dropped (not applicable); 'a' is kept by layout position;
    // 'b' and 'c' are applicable but absent from layout → appended per the
    // semantic contract ("append any applicable card not in layout").
    expect(applyCardLayout(REG, layout).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the registry', () => {
    const before = REG.map((e) => e.id);
    applyCardLayout(REG, [{ id: 'c', hidden: false }]);
    expect(REG.map((e) => e.id)).toEqual(before);
  });
});

describe('applyCardLayout — unknown SAVED ids (W14 time-series retirement)', () => {
  it('ignores saved layout ids that no longer exist in the registry', () => {
    const layout = [
      { id: 'time-series', hidden: false }, // retired card, still in saved rows
      { id: 'b', hidden: false },
      { id: 'a', hidden: false },
    ];
    expect(applyCardLayout(REG, layout).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });
});
