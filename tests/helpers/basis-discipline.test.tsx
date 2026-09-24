import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { expectBasisDiscipline, type BasisRegistry } from './basis-discipline';
import {
  CALCULATORS_PAGE_ID,
  WHATIF_PAGE_ID,
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

/* ── W-I: the rows hook — chart DATA, not only the caption. Every clause has a
   witness; each `it` fails if — and only if — its clause is missing from
   tests/helpers/basis-discipline.tsx. ───────────────────────────────────── */

function mkDataChartCard(
  caption: (b: DollarBasis) => string,
  rows: (b: DollarBasis) => string,
  hookOutside = false,
) {
  return function DataChartCard() {
    const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
    const hook = <div data-testid="rows" data-rows={rows(basis)} />;
    return (
      <div>
        <BaselineBody />
        <span data-testid="cap">{caption(basis)}</span>
        <div data-testid="chart">{hookOutside ? null : hook}</div>
        {hookOutside ? hook : null}
      </div>
    );
  };
}
const dataRegistry = (cls: 'convertible' | 'pinned', pinnedBasis?: DollarBasis): BasisRegistry => ({
  figures: REGISTRY.figures,
  charts: [{ chartTestId: 'chart', captionTestId: 'cap', cls, pinnedBasis, rowsTestId: 'rows' }],
});
const PINNED_CAP = () => "Balance (today's $)";
const CONV_CAP = (b: DollarBasis) => (b === 'today' ? "Balance (today's $)" : 'Balance (future $)');
const SAME_ROWS = () => '[{"year":0,"p50":100}]';
const FLIP_ROWS = (b: DollarBasis) =>
  b === 'today' ? '[{"year":0,"p50":100}]' : '[{"year":0,"p50":103}]';

describe('expectBasisDiscipline — the W-I rows hook (chart DATA across bases)', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('PINNED DATA: byte-identical rows pass; rows that change across bases fail (D-UB13: history is never re-inflated)', () => {
    const Good = mkDataChartCard(PINNED_CAP, SAME_ROWS);
    expect(() => expectBasisDiscipline(<Good />, dataRegistry('pinned', 'today'))).not.toThrow();
    cleanup();
    const Reinflated = mkDataChartCard(PINNED_CAP, FLIP_ROWS);
    expect(() => expectBasisDiscipline(<Reinflated />, dataRegistry('pinned', 'today'))).toThrow(
      /chart: pinned\(today\) chart DATA changed across bases/,
    );
  });

  it('CONVERTIBLE DATA: rows must differ; identical rows fail (a chart that never re-bases)', () => {
    const Good = mkDataChartCard(CONV_CAP, FLIP_ROWS);
    expect(() => expectBasisDiscipline(<Good />, dataRegistry('convertible'))).not.toThrow();
    cleanup();
    const Stuck = mkDataChartCard(CONV_CAP, SAME_ROWS);
    expect(() => expectBasisDiscipline(<Stuck />, dataRegistry('convertible'))).toThrow(
      /chart: convertible chart DATA byte-identical across bases/,
    );
  });

  it('CONTRACT: a declared hook rendered OUTSIDE the chart subtree does not count', () => {
    const Outside = mkDataChartCard(PINNED_CAP, SAME_ROWS, true);
    expect(() => expectBasisDiscipline(<Outside />, dataRegistry('pinned', 'today'))).toThrow(
      /rows hook "rows" not rendered inside "chart"/,
    );
  });

  it('CONTRACT: a hook element without a data-rows attribute throws', () => {
    function NoAttr() {
      return (
        <div>
          <BaselineBody />
          <span data-testid="cap">Balance (today&#39;s $)</span>
          <div data-testid="chart">
            <div data-testid="rows" />
          </div>
        </div>
      );
    }
    expect(() => expectBasisDiscipline(<NoAttr />, dataRegistry('pinned', 'today'))).toThrow(
      /rows hook "rows" carries no data-rows attribute/,
    );
  });

  it('CONTRACT: a hook carrying ZERO rows throws — the pinned clause may not pass vacuously (MINOR 14)', () => {
    // `[]` in both bases satisfies rT === rF: a pinned chart would "prove" its
    // history is never re-inflated while carrying no history at all.
    const EMPTY = () => '[]';
    const EmptyPinned = mkDataChartCard(PINNED_CAP, EMPTY);
    expect(() => expectBasisDiscipline(<EmptyPinned />, dataRegistry('pinned', 'today'))).toThrow(
      /rows hook "rows" in "chart" carries zero rows/,
    );
    cleanup();
    const EmptyConvertible = mkDataChartCard(CONV_CAP, EMPTY);
    expect(() =>
      expectBasisDiscipline(<EmptyConvertible />, dataRegistry('convertible')),
    ).toThrow(/carries zero rows/);
    cleanup();
    // an empty attribute value is just as vacuous
    const Blank = mkDataChartCard(PINNED_CAP, () => '');
    expect(() => expectBasisDiscipline(<Blank />, dataRegistry('pinned', 'today'))).toThrow(
      /carries zero rows/,
    );
    cleanup();
    // …and one row is enough to be a witness (the guard is a floor, not a shape check)
    const OneRow = mkDataChartCard(PINNED_CAP, SAME_ROWS);
    expect(() => expectBasisDiscipline(<OneRow />, dataRegistry('pinned', 'today'))).not.toThrow();
  });

  it('OPTIONAL: a chart registered without rowsTestId keeps the caption-only contract (W2 registrations untouched)', () => {
    const RowsFlipButUnhooked = mkDataChartCard(PINNED_CAP, FLIP_ROWS);
    expect(() =>
      expectBasisDiscipline(<RowsFlipButUnhooked />, chartRegistry('pinned', 'today')),
    ).not.toThrow();
  });
});

/* ── W5.1 (D-W51-9): sweep-helper PLUMBING — opts.pageId and opts.root. The
   frozen registration types and every per-class assertion above are untouched;
   each `it` fails if — and only if — its option is missing from
   tests/helpers/basis-discipline.tsx. ───────────────────────────────────── */

function WhatIfGoodCard() {
  const [basis] = useDollarBasis(WHATIF_PAGE_ID);
  return (
    <span data-testid="fig-conv">{basis === 'today' ? "$100 (today's $)" : '$103 (future $)'}</span>
  );
}
const ONE_CONV: BasisRegistry = { figures: [{ testId: 'fig-conv', cls: 'convertible' }], charts: [] };
const ONE_INV: BasisRegistry = { figures: [{ testId: 'fig-inv', cls: 'invariant' }], charts: [] };

describe('expectBasisDiscipline — W5.1 options (plumbing, not contract)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('pageId: a whatif consumer flips under WHATIF_PAGE_ID and is caught as frozen under the default', () => {
    cleanup();
    expect(() => expectBasisDiscipline(<WhatIfGoodCard />, ONE_CONV, { pageId: WHATIF_PAGE_ID })).not.toThrow();
    cleanup();
    expect(() => expectBasisDiscipline(<WhatIfGoodCard />, ONE_CONV)).toThrow(/byte-identical across bases/);
  });

  it('root: portaled figures (Radix Dialog) are invisible to the container and visible from document.body', () => {
    const Portaled = () => createPortal(<span data-testid="fig-inv">$50</span>, document.body);
    cleanup();
    expect(() => expectBasisDiscipline(<Portaled />, ONE_INV)).toThrow(/not rendered by the fixture/);
    cleanup();
    expect(() => expectBasisDiscipline(<Portaled />, ONE_INV, { root: document.body })).not.toThrow();
  });
});

/* ── v1.7.0 B2: a pinned figure's basis statement may live on a declared
   ELEMENT (markTestId) when copy law keeps both the figure and its parent
   bare — the Stress Test card's CP-10/11/16 rows vs its card-level CP-18
   line. Opt-in, pinned-only; each `it` fails when its clause in
   tests/helpers/basis-discipline.tsx is missing OR loosened (MARK / BOTH
   BASES distinguish the arm's text and per-basis reads, not its absence). ── */

function mkMarkedCard(markText: (b: DollarBasis) => string | null) {
  return function MarkedCard() {
    const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
    const mark = markText(basis);
    return (
      <div>
        <div>
          <span data-testid="fig-far">$300</span>
        </div>
        {mark !== null && <p data-testid="basis-line">{mark}</p>}
      </div>
    );
  };
}
const FAR_PINNED: BasisRegistry = {
  figures: [{ testId: 'fig-far', cls: 'pinned', pinnedBasis: 'today', markTestId: 'basis-line' }],
  charts: [],
};
const FAR_PINNED_UNLINKED: BasisRegistry = {
  figures: [{ testId: 'fig-far', cls: 'pinned', pinnedBasis: 'today' }],
  charts: [],
};
const CP18 = "All figures in today's dollars — the window's inflation is already taken out.";

describe('expectBasisDiscipline — B2 markTestId (the statement is a declared element)', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('LINK: a bare pinned figure passes ONLY through markTestId — unlinked, the W5 node-or-parent rule still rejects it', () => {
    const Card = mkMarkedCard(() => CP18);
    expect(() => expectBasisDiscipline(<Card />, FAR_PINNED)).not.toThrow();
    cleanup();
    expect(() => expectBasisDiscipline(<Card />, FAR_PINNED_UNLINKED)).toThrow(
      /fig-far\[0\]: pinned\(today\) mark missing in today render/,
    );
  });

  it('MARK: the linked element must carry the pinnedBasis mark — a bare statement fails', () => {
    const Bare = mkMarkedCard(() => 'All figures as recorded.');
    expect(() => expectBasisDiscipline(<Bare />, FAR_PINNED)).toThrow(
      /fig-far\[0\]: pinned\(today\) mark missing in today render/,
    );
  });

  it('BOTH BASES: a statement that flips with the page fails in the future render', () => {
    const Flipping = mkMarkedCard((b) => (b === 'today' ? "in today's dollars" : 'in future dollars'));
    expect(() => expectBasisDiscipline(<Flipping />, FAR_PINNED)).toThrow(
      /fig-far\[0\]: pinned\(today\) mark missing in future render/,
    );
  });

  it('RENDERED: a linked element the fixture never renders throws', () => {
    const Missing = mkMarkedCard(() => null);
    expect(() => expectBasisDiscipline(<Missing />, FAR_PINNED)).toThrow(
      /mark element "basis-line" for "fig-far" not rendered by the fixture/,
    );
  });

  it('CONTRACT: markTestId on a non-pinned figure throws (it is a pinned-figure option)', () => {
    const Card = mkMarkedCard(() => CP18);
    expect(() =>
      expectBasisDiscipline(<Card />, {
        figures: [{ testId: 'fig-far', cls: 'invariant', markTestId: 'basis-line' }],
        charts: [],
      }),
    ).toThrow(/fig-far: markTestId is a pinned-figure option/);
  });
});
