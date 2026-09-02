import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { expectBasisDiscipline, type BasisRegistry } from './basis-discipline';
import {
  CALCULATORS_PAGE_ID,
  useDollarBasis,
  __resetDollarBasisForTests,
} from '@/lib/calculators/dollar-basis';

function GoodCard() {
  const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
  const conv = basis === 'today' ? "$100 (today's $)" : '$103 (future $)';
  return (
    <div>
      <span data-testid="fig-conv">{conv}</span>
      <span data-testid="fig-inv">$50</span>
      <p>
        <span data-testid="fig-pin">$200</span> — in today&#39;s dollars
      </p>
    </div>
  );
}
/** Blend-bug sentinel: a nominal value wearing a today label, never flipping. */
function MixedCard() {
  return (
    <div>
      <span data-testid="fig-conv">$103 (today&#39;s $)</span>
      <span data-testid="fig-inv">$50</span>
      <p>
        <span data-testid="fig-pin">$200</span> — in today&#39;s dollars
      </p>
    </div>
  );
}
/** Wrong-mark sentinel: value flips but keeps the today label in future mode. */
function WrongMarkCard() {
  const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
  const conv = basis === 'today' ? "$100 (today's $)" : "$103 (today's $)";
  return (
    <div>
      <span data-testid="fig-conv">{conv}</span>
      <span data-testid="fig-inv">$50</span>
      <p>
        <span data-testid="fig-pin">$200</span> — in today&#39;s dollars
      </p>
    </div>
  );
}
function UnregisteredCard() {
  return (
    <div>
      <GoodCard />
      <span>$55</span>
    </div>
  );
}

const REGISTRY: BasisRegistry = {
  figures: [
    { testId: 'fig-conv', cls: 'convertible' },
    { testId: 'fig-inv', cls: 'invariant' },
    { testId: 'fig-pin', cls: 'pinned', pinnedBasis: 'today' },
  ],
  charts: [],
};

describe('expectBasisDiscipline — sentinel self-tests (the detector must catch the bug class)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('passes a disciplined card', () => {
    expect(() => expectBasisDiscipline(<GoodCard />, REGISTRY)).not.toThrow();
  });

  it('catches the nominal-on-real blend (convertible that never flips)', () => {
    cleanup();
    expect(() => expectBasisDiscipline(<MixedCard />, REGISTRY)).toThrow(
      /byte-identical across bases/,
    );
  });

  it('catches a lying label (future value wearing a today mark)', () => {
    cleanup();
    expect(() => expectBasisDiscipline(<WrongMarkCard />, REGISTRY)).toThrow(/future mark/);
  });

  it('catches an unregistered dollar figure (completeness scan)', () => {
    cleanup();
    expect(() => expectBasisDiscipline(<UnregisteredCard />, REGISTRY)).toThrow(
      /UNREGISTERED dollar figure/,
    );
  });

  it('catches a registered figure the fixture failed to render', () => {
    cleanup();
    expect(() =>
      expectBasisDiscipline(<GoodCard />, {
        figures: [...REGISTRY.figures, { testId: 'fig-ghost', cls: 'invariant' }],
        charts: [],
      }),
    ).toThrow(/not rendered by the fixture/);
  });
});
