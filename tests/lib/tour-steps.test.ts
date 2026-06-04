import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, deriveTourSteps } from '@/lib/tour-steps';
import { DEFAULT_SECTIONS } from '@/components/layout/Sidebar';

const CORE_TOS = ['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings'];
const ALL_DEFAULT_TOS = DEFAULT_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

describe('TOUR_STEPS config', () => {
  it('has exactly one step per DEFAULT_SECTIONS tab (no gaps, no extras)', () => {
    const stepTos = TOUR_STEPS.map((s) => s.to).sort();
    expect(stepTos).toEqual([...ALL_DEFAULT_TOS].sort());
  });

  it('flags exactly the six core tabs as core', () => {
    const core = TOUR_STEPS.filter((s) => s.core).map((s) => s.to).sort();
    expect(core).toEqual([...CORE_TOS].sort());
  });

  it('gives every step a non-empty title and body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveTourSteps', () => {
  it('core mode = core ∩ visible, in config order', () => {
    // Pass visible tabs in a scrambled order; output must follow TOUR_STEPS order.
    const visible = ['/settings', '/investments', '/loans', '/', '/budget', '/net-worth', '/calculators'];
    const steps = deriveTourSteps(visible, 'core');
    expect(steps.map((s) => s.to)).toEqual([
      '/', '/net-worth', '/budget', '/investments', '/calculators', '/settings',
    ]);
    expect(steps.every((s) => s.core)).toBe(true);
  });

  it('all mode = full visible ∩ config, in config order (core first by layout)', () => {
    const visible = ['/', '/net-worth', '/budget', '/investments', '/loans', '/calculators', '/settings'];
    const steps = deriveTourSteps(visible, 'all');
    // Every visible tab that has a config entry, in DEFAULT_SECTIONS order.
    expect(steps.map((s) => s.to)).toEqual([
      '/', '/net-worth', '/budget', '/investments', '/loans', '/calculators', '/settings',
    ]);
  });

  it('all mode drops a visible tab with no config entry (intersection, not union)', () => {
    const steps = deriveTourSteps(['/', '/net-worth', '/totally-unknown'], 'all');
    expect(steps.map((s) => s.to)).toEqual(['/', '/net-worth']);
  });

  it('core walk shrinks when a core tab is hidden', () => {
    // /budget hidden by the user's sidebarLayout → not in visibleTos.
    const visible = ['/', '/net-worth', '/investments', '/calculators', '/settings'];
    const steps = deriveTourSteps(visible, 'core');
    expect(steps.map((s) => s.to)).toEqual([
      '/', '/net-worth', '/investments', '/calculators', '/settings',
    ]);
  });

  it('all mode equals core when no non-core tabs are visible (empty remainder)', () => {
    const visible = [...CORE_TOS];
    const core = deriveTourSteps(visible, 'core');
    const all = deriveTourSteps(visible, 'all');
    // Same steps in both modes → the overlay must NOT offer "See the rest".
    expect(all.map((s) => s.to)).toEqual(core.map((s) => s.to));
  });

  it('preserves config order even with duplicate / empty visible input', () => {
    expect(deriveTourSteps([], 'core')).toEqual([]);
    expect(deriveTourSteps([], 'all')).toEqual([]);
    const dup = deriveTourSteps(['/', '/', '/net-worth'], 'core');
    expect(dup.map((s) => s.to)).toEqual(['/', '/net-worth']); // no duplicate steps
  });
});
