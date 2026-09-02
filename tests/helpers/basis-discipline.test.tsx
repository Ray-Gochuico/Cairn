import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { expectBasisDiscipline, type BasisRegistry } from './basis-discipline';
import {
  CALCULATORS_PAGE_ID,
  useDollarBasis,
  __resetDollarBasisForTests,
} from '@/lib/calculators/dollar-basis';
import type { DollarBasis } from '@/lib/calculators/dollar-basis';

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

/* ── Review fix: a witness for EVERY clause the sweep advertises ───────────
   The five sentinels above cover the convertible/label/completeness clauses.
   The pinned, invariant, direction, node-count and chart-caption clauses had
   no fixture, so a refactor that silently dropped one of them stayed green.
   Each `it` below fails if — and only if — its clause is removed from
   tests/helpers/basis-discipline.tsx. ─────────────────────────────────── */

interface Cell {
  conv: string;
  inv: string;
  pin: string;
  pinTail: string;
}
/** The disciplined baseline every sentinel below perturbs in ONE place. */
const DISCIPLINED = (basis: DollarBasis): Cell => ({
  conv: basis === 'today' ? "$100 (today's $)" : '$103 (future $)',
  inv: '$50',
  pin: '$200',
  pinTail: " — in today's dollars",
});

/** Build a card fixture from a one-field perturbation of the baseline. */
function mkCard(patch: (basis: DollarBasis) => Partial<Cell>) {
  return function PatchedCard() {
    const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
    const c = { ...DISCIPLINED(basis), ...patch(basis) };
    return (
      <div>
        <span data-testid="fig-conv">{c.conv}</span>
        <span data-testid="fig-inv">{c.inv}</span>
        <p>
          <span data-testid="fig-pin">{c.pin}</span>
          {c.pinTail}
        </p>
      </div>
    );
  };
}

/** The unperturbed body, shared by the chart and node-count fixtures. */
const BaselineBody = mkCard(() => ({}));

/** A card plus a registered chart (caption + a chart subtree with a $ inside). */
function mkChartCard(caption: (basis: DollarBasis) => string) {
  return function ChartCard() {
    const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
    return (
      <div>
        <BaselineBody />
        <span data-testid="cap">{caption(basis)}</span>
        <div data-testid="chart">
          <span>$1,234</span>
        </div>
      </div>
    );
  };
}

const chartRegistry = (
  cls: 'convertible' | 'pinned',
  pinnedBasis?: DollarBasis,
): BasisRegistry => ({
  figures: REGISTRY.figures,
  charts: [{ chartTestId: 'chart', captionTestId: 'cap', cls, pinnedBasis }],
});

describe('expectBasisDiscipline — every advertised clause has a sentinel', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('DIRECTION: a convertible that SHRINKS in Future $ fails (deflation direction)', () => {
    const Shrinking = mkCard((b) => ({
      conv: b === 'today' ? "$103 (today's $)" : '$100 (future $)',
    }));
    expect(() => expectBasisDiscipline(<Shrinking />, REGISTRY)).toThrow(
      /future value must exceed today value/,
    );
  });

  it('LABEL (today arm): a convertible with no today mark in Today $ fails', () => {
    const NoTodayMark = mkCard((b) => ({ conv: b === 'today' ? '$100' : '$103 (future $)' }));
    expect(() => expectBasisDiscipline(<NoTodayMark />, REGISTRY)).toThrow(
      /today render must carry a today mark/,
    );
  });

  it('INVARIANT: a figure registered invariant that drifts across bases fails', () => {
    const Drift = mkCard((b) => ({ inv: b === 'today' ? '$50' : '$51' }));
    expect(() => expectBasisDiscipline(<Drift />, REGISTRY)).toThrow(
      /fig-inv\[0\]: invariant but changed across bases/,
    );
  });

  it('PINNED (value): a pinned figure whose value FLIPS in Future $ fails', () => {
    const PinnedLiar = mkCard((b) => ({ pin: b === 'today' ? '$200' : '$206' }));
    expect(() => expectBasisDiscipline(<PinnedLiar />, REGISTRY)).toThrow(
      /fig-pin\[0\]: pinned but value changed across bases/,
    );
  });

  it('PINNED (mark, future arm): a pinned figure that loses its today mark in Future $ fails', () => {
    const MarkDropsInFuture = mkCard((b) => ({
      pinTail: b === 'today' ? " — in today's dollars" : ' — in future dollars',
    }));
    expect(() => expectBasisDiscipline(<MarkDropsInFuture />, REGISTRY)).toThrow(
      /pinned\(today\) mark missing in future render/,
    );
  });

  it('PINNED (mark, today arm): a pinned figure with no basis mark at all fails', () => {
    const NoMark = mkCard(() => ({ pinTail: ' — a number with no basis' }));
    expect(() => expectBasisDiscipline(<NoMark />, REGISTRY)).toThrow(
      /pinned\(today\) mark missing in today render/,
    );
  });

  it('PINNED (contract): a pinned figure registered without pinnedBasis throws', () => {
    expect(() =>
      expectBasisDiscipline(<BaselineBody />, {
        figures: [
          { testId: 'fig-conv', cls: 'convertible' },
          { testId: 'fig-inv', cls: 'invariant' },
          { testId: 'fig-pin', cls: 'pinned' }, // pinnedBasis omitted
        ],
        charts: [],
      }),
    ).toThrow(/pinned figure missing pinnedBasis/);
  });

  it('NODE COUNT: a registered figure that disappears in one basis fails', () => {
    function Vanishing() {
      const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
      return (
        <div>
          <BaselineBody />
          {basis === 'today' && <span data-testid="fig-inv">$50</span>}
        </div>
      );
    }
    expect(() => expectBasisDiscipline(<Vanishing />, REGISTRY)).toThrow(
      /node count changed across bases \(2 → 1\)/,
    );
  });

  it('PARSE: a convertible that flips to a figure with no parseable $ throws', () => {
    const NoFigure = mkCard((b) => ({ conv: b === 'today' ? "$100 (today's $)" : '(future $)' }));
    expect(() => expectBasisDiscipline(<NoFigure />, REGISTRY)).toThrow(/no parseable \$ figure/);
  });

  it('CHART: a disciplined convertible caption passes (and the chart interior is exempt)', () => {
    const Good = mkChartCard((b) => (b === 'today' ? "Balance (today's $)" : 'Balance (future $)'));
    expect(() => expectBasisDiscipline(<Good />, chartRegistry('convertible'))).not.toThrow();
  });

  it('CHART (today arm): a caption missing the today mark in Today $ fails', () => {
    const Wrong = mkChartCard(() => 'Balance (future $)');
    expect(() => expectBasisDiscipline(<Wrong />, chartRegistry('convertible'))).toThrow(
      /cap: today caption lacks a today mark/,
    );
  });

  it('CHART (future arm): a caption missing the future mark in Future $ fails', () => {
    const Wrong = mkChartCard(() => "Balance (today's $)");
    expect(() => expectBasisDiscipline(<Wrong />, chartRegistry('convertible'))).toThrow(
      /cap: future caption lacks a future mark/,
    );
  });

  it('CHART (pinned): a pinned caption keeps its declared mark in BOTH bases, or fails', () => {
    const Pinned = mkChartCard(() => "Balance (today's $)");
    expect(() =>
      expectBasisDiscipline(<Pinned />, chartRegistry('pinned', 'today')),
    ).not.toThrow();
    cleanup();
    const Flipping = mkChartCard((b) =>
      b === 'today' ? "Balance (today's $)" : 'Balance (future $)',
    );
    expect(() => expectBasisDiscipline(<Flipping />, chartRegistry('pinned', 'today'))).toThrow(
      /cap: pinned\(today\) caption mark missing in one basis/,
    );
  });

  it('CHART (contract): a pinned chart registered without pinnedBasis throws', () => {
    const Pinned = mkChartCard(() => "Balance (today's $)");
    expect(() => expectBasisDiscipline(<Pinned />, chartRegistry('pinned'))).toThrow(
      /pinned chart missing pinnedBasis/,
    );
  });

  it('CHART: a registered caption the fixture never rendered fails', () => {
    const Good = mkChartCard((b) => (b === 'today' ? "Balance (today's $)" : 'Balance (future $)'));
    expect(() =>
      expectBasisDiscipline(<Good />, {
        figures: REGISTRY.figures,
        charts: [
          { chartTestId: 'chart', captionTestId: 'cap-ghost', cls: 'convertible' },
        ],
      }),
    ).toThrow(/chart caption "cap-ghost" missing/);
  });
});
