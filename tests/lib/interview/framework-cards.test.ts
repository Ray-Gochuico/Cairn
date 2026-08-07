import { describe, it, expect } from 'vitest';
import { buildFrameworkCards } from '@/lib/interview/framework-cards';
import { fixtureCtx } from './waterfall.test';

describe('buildFrameworkCards', () => {
  const cards = buildFrameworkCards({ amountCents: 1_000_000, cadence: 'one-time' }, fixtureCtx());

  it('three cards in policy order with the CI-4 titles', () => {
    expect(cards.map((c) => c.title)).toEqual([
      'Conservative — "Safety first."',
      'Moderate — "The standard order."',
      'Aggressive — "Growth-weighted."',
    ]);
  });

  it('rows carry CI-7 labels + formatted amounts and sum to the input', () => {
    expect(cards[0].rows).toEqual([
      { label: 'High-rate debt (≥ 8%)', amount: '$3,000' },
      { label: 'Emergency fund — to 6× expenses', amount: '$6,000' },
      { label: 'Debt in the 5–8% band', amount: '$1,000' },
    ]);
  });

  it('assumes groups: provenance only when a projection rendered; constants; skipped reasons', () => {
    const aggressive = cards[2]; // invest headline → projection → CI-22 present
    expect(aggressive.assumes.some((a) => a.group === 'provenance' && a.text.startsWith('Growth: 6% nominal'))).toBe(true);
    expect(aggressive.assumes.some((a) => a.group === 'constants' && a.text === 'Debt bands: 5% and 8% — app defaults.')).toBe(true);
    expect(aggressive.assumes.some((a) => a.group === 'skipped' && a.text === 'Debt between 5–8% stays at minimum payments in this framework.')).toBe(true);
    const conservative = cards[0]; // EF headline, no projection → no CI-22
    expect(conservative.assumes.some((a) => a.group === 'provenance' && a.text.startsWith('Growth:'))).toBe(false);
  });

  it('the fixed footer is on every card (CI-5)', () => {
    for (const c of cards) {
      expect(c.footer).toBe('One mechanical framework applied to your numbers — not advice, not a recommendation.');
    }
  });

  it('Moderate assumed 6× → CI-26 row + the inline jobStability ask target', () => {
    const moderate = cards[1];
    expect(moderate.assumes.some((a) => a.text === 'Assumes a 6× expense reserve — no job-stability answer on file. Answer below to use 3×.')).toBe(true);
    expect(moderate.askJobStability).toEqual({ personId: 1, name: fixtureCtx().persons[0].name });
  });

  it('B6 with no targets stays one Invest row + CI-20', () => {
    const aggressive = cards[2];
    expect(aggressive.rows.find((r) => r.label === 'Invest')).toBeDefined();
    expect(aggressive.assumes.some((a) => a.text === 'No target allocation set — shown as one investing amount.')).toBe(true);
  });
});
