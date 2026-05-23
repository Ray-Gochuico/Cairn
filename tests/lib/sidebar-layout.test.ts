import { describe, it, expect } from 'vitest';
import { applySidebarLayout, type SidebarSectionShape } from '@/lib/sidebar-layout';
import type { SidebarLayoutEntry } from '@/types/schema';

const defaults: SidebarSectionShape[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '📊' },
      { to: '/net-worth', label: 'Net Worth', icon: '💎' },
      { to: '/budget', label: 'Budget', icon: '📋' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/investments', label: 'Investments', icon: '📈' },
      { to: '/spending', label: 'Spending', icon: '💸' },
    ],
  },
];

describe('applySidebarLayout', () => {
  it('returns the defaults untouched when the layout is null', () => {
    expect(applySidebarLayout(defaults, null)).toEqual(defaults);
  });

  it('drops items whose overlay entry is hidden', () => {
    const layout: SidebarLayoutEntry[] = [
      { to: '/', hidden: false },
      { to: '/net-worth', hidden: true },
      { to: '/budget', hidden: false },
      { to: '/investments', hidden: false },
      { to: '/spending', hidden: false },
    ];
    const result = applySidebarLayout(defaults, layout);
    expect(result[0].items.map((i) => i.to)).toEqual(['/', '/budget']);
  });

  it('sorts the visible items of a section by their overlay order', () => {
    const layout: SidebarLayoutEntry[] = [
      { to: '/budget', hidden: false },
      { to: '/', hidden: false },
      { to: '/net-worth', hidden: false },
      { to: '/investments', hidden: false },
      { to: '/spending', hidden: false },
    ];
    const result = applySidebarLayout(defaults, layout);
    expect(result[0].items.map((i) => i.to)).toEqual(['/budget', '/', '/net-worth']);
  });

  it('appends items absent from the overlay at the end of their section, visible', () => {
    // The overlay knows nothing about /budget — it must still appear, last.
    const layout: SidebarLayoutEntry[] = [
      { to: '/net-worth', hidden: false },
      { to: '/', hidden: false },
      { to: '/investments', hidden: false },
      { to: '/spending', hidden: false },
    ];
    const result = applySidebarLayout(defaults, layout);
    expect(result[0].items.map((i) => i.to)).toEqual(['/net-worth', '/', '/budget']);
  });

  it('preserves section order and section labels', () => {
    const layout: SidebarLayoutEntry[] = [
      { to: '/spending', hidden: false },
      { to: '/investments', hidden: false },
    ];
    const result = applySidebarLayout(defaults, layout);
    expect(result.map((s) => s.label)).toEqual(['Overview', 'Money']);
    expect(result[1].items.map((i) => i.to)).toEqual(['/spending', '/investments']);
  });

  it('does not mutate the input defaults array', () => {
    const layout: SidebarLayoutEntry[] = [{ to: '/budget', hidden: true }];
    applySidebarLayout(defaults, layout);
    expect(defaults[0].items.map((i) => i.to)).toEqual(['/', '/net-worth', '/budget']);
  });
});
