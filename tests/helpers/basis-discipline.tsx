import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CALCULATORS_PAGE_ID, useDollarBasisStore } from '@/lib/calculators/dollar-basis';
import type { DollarBasis } from '@/lib/calculators/dollar-basis';
import type { RegisteredChart, RegisteredFigure } from '@/lib/calculators/basis-view';

export interface BasisRegistry {
  figures: RegisteredFigure[];
  charts: RegisteredChart[];
}

const TODAY_MARKS = ["in today's dollars", "(today's $)"] as const;
const FUTURE_MARKS = ['in future dollars', '(future $)'] as const;
/** $-followed-by-digit — control labels like "Today's $" don't match. */
const DOLLAR_RE = /\$\s?\d/;
/** A-13 (v1.7.1, CR-C3-3): glossary tooltip BODIES are out of the completeness
 *  scan — the hook glossary-tooltip.tsx stamps on its PopoverPrimitive.Content.
 *  ONLY this: portaled Radix Dialogs (the lever popovers, Manage scenarios)
 *  and every other portal stay in (self-test "IN: a $ inside a portaled
 *  Radix Dialog"). */
const GLOSSARY_TOOLTIP_SELECTOR = '[data-glossary-tooltip]';

function hasMark(text: string, basis: DollarBasis): boolean {
  return (basis === 'today' ? TODAY_MARKS : FUTURE_MARKS).some((m) => text.includes(m));
}
function parseDollars(text: string): number {
  const m = text.match(/\$[\d,]+/);
  if (!m) throw new Error(`basis sweep: no parseable $ figure in "${text}"`);
  return Number(m[0].replace(/[$,]/g, ''));
}

/**
 * W-I review (MINOR 14): does the hook actually carry rows? `[]` (or an empty
 * attribute) is byte-identical to itself across bases, so a pinned chart whose
 * series collapsed would "prove" its history is never re-inflated while
 * carrying no history at all. A non-JSON value is its own witness — only
 * emptiness is vacuous.
 */
function hasRows(data: string): boolean {
  const trimmed = data.trim();
  if (trimmed === '') return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.length > 0;
  } catch {
    return true;
  }
  return true;
}

interface FigureSnap {
  text: string;
  parentText: string;
}
interface Snapshot {
  figures: Map<string, FigureSnap[]>;
  captions: Map<string, string>;
  /** W-I: chartTestId → the hook's data-rows attribute (only for charts that declare rowsTestId). */
  rows: Map<string, string>;
  /** B2: figure testId → the declared mark element's text (only for figures that declare markTestId). */
  marks: Map<string, string>;
  looseDollarTexts: string[];
}

function collect(container: HTMLElement, registry: BasisRegistry): Snapshot {
  const figures = new Map<string, FigureSnap[]>();
  const marks = new Map<string, string>();
  for (const f of registry.figures) {
    if (f.markTestId !== undefined && f.cls !== 'pinned') {
      throw new Error(`${f.testId}: markTestId is a pinned-figure option (contract violation)`);
    }
    if (f.markTestId !== undefined) {
      const markEl = container.querySelector<HTMLElement>(`[data-testid="${f.markTestId}"]`);
      if (!markEl) {
        throw new Error(
          `basis sweep: mark element "${f.markTestId}" for "${f.testId}" not rendered by the fixture`,
        );
      }
      marks.set(f.testId, markEl.textContent ?? '');
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(`[data-testid="${f.testId}"]`),
    );
    if (nodes.length === 0) {
      throw new Error(`basis sweep: registered figure "${f.testId}" not rendered by the fixture`);
    }
    figures.set(
      f.testId,
      nodes.map((n) => ({
        text: n.textContent ?? '',
        parentText: n.parentElement?.textContent ?? n.textContent ?? '',
      })),
    );
  }
  const captions = new Map<string, string>();
  const rows = new Map<string, string>();
  for (const c of registry.charts) {
    const cap = container.querySelector<HTMLElement>(`[data-testid="${c.captionTestId}"]`);
    if (!cap) throw new Error(`basis sweep: chart caption "${c.captionTestId}" missing`);
    captions.set(c.captionTestId, cap.textContent ?? '');
    if (c.rowsTestId) {
      // W-I: the data hook is read INSIDE the chart subtree, so two charts
      // sharing the mock's testid can never cross-read each other's rows.
      const chart = container.querySelector<HTMLElement>(`[data-testid="${c.chartTestId}"]`);
      if (!chart)
        throw new Error(`basis sweep: chart "${c.chartTestId}" missing (rowsTestId declared)`);
      const hook = chart.querySelector<HTMLElement>(`[data-testid="${c.rowsTestId}"]`);
      if (!hook) {
        throw new Error(
          `basis sweep: rows hook "${c.rowsTestId}" not rendered inside "${c.chartTestId}" (mock recharts with a data-rows element in this fixture)`,
        );
      }
      const data = hook.getAttribute('data-rows');
      if (data === null) {
        throw new Error(`basis sweep: rows hook "${c.rowsTestId}" carries no data-rows attribute`);
      }
      if (!hasRows(data)) {
        throw new Error(
          `basis sweep: rows hook "${c.rowsTestId}" in "${c.chartTestId}" carries zero rows — nothing to pin`,
        );
      }
      rows.set(c.chartTestId, data);
    }
  }
  // Completeness scan: every $-digit text node outside registered chart
  // subtrees must sit inside a registered figure's testid element.
  const chartSelectors = registry.charts.map((c) => `[data-testid="${c.chartTestId}"]`);
  const figureSelectors = registry.figures.map((f) => `[data-testid="${f.testId}"]`);
  const looseDollarTexts: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (!DOLLAR_RE.test(text)) continue;
    const el = n.parentElement;
    if (!el) continue;
    if (el.closest(GLOSSARY_TOOLTIP_SELECTOR)) continue; // glossary tooltip bodies: OUT (CR-C3-3)
    if (chartSelectors.some((s) => el.closest(s))) continue; // chart interiors: covered by caption + wiring pins
    if (figureSelectors.some((s) => el.closest(s))) continue;
    looseDollarTexts.push(text.trim());
  }
  return { figures, captions, rows, marks, looseDollarTexts };
}

/**
 * W5 frozen sweep semantics (spec § Architecture, per-class assertions):
 *  - convertible: value differs across page bases (future > today for positive
 *    figures under positive inflation — exact deflators are the ANCHOR tests'
 *    job) AND carries the active basis mark, never the other basis's mark.
 *  - invariant: byte-identical textContent across bases.
 *  - pinned: byte-identical AND its pinnedBasis mark appears in the node or
 *    its parent element in BOTH bases (the phrase may close the sentence).
 *  - pinned + markTestId (B2, opt-in): the mark may instead sit on the declared
 *    element, which must render with that mark in BOTH bases.
 *  - ADOPTING markTestId (A-12, v1.7.1 — read before registering the next
 *    copy-law card): (1) pinned figures only (the CONTRACT clause throws
 *    otherwise); (2) use it ONLY when copy law keeps BOTH the figure's node
 *    and its parent bare — a CP-pinned cell whose sentence cannot carry the
 *    phrase (Stress Test CP-10/11/16 → the CP-18 line; Earliest Retirement
 *    CP-32 probes → the CP-31 criterion). Where the contract lets the
 *    sentence carry the mark, put it in the node or its parent (the W5
 *    rule) — markTestId is the exception, not the default; (3) the mark
 *    element is a card-level basis STATEMENT rendered in BOTH bases, never
 *    a caption that flips; (4) the mark element is either registered in its
 *    own right or carries no $-digit text — there is no separate clause for
 *    this: the completeness scan already treats a $ inside an UNREGISTERED
 *    mark as loose (self-test "a mark element that itself carries a $
 *    figure"), so a mark that is itself a figure (ERC's criterion) must be
 *    registered too.
 *  - charts:the caption names the active basis (convertible) or the declared
 *    pinnedBasis, in both bases.
 *  - chart DATA (W-I, only when rowsTestId is declared): the hook's data-rows
 *    inside the chart subtree is byte-identical across bases for pinned charts
 *    and differs for convertible ones — and carries at least one row in BOTH
 *    renders, so neither clause can be satisfied by an empty chart.
 *  - completeness: no unregistered $-figure anywhere outside chart subtrees
 *    or glossary tooltip bodies (A-13, CR-C3-3 — the only excluded portal;
 *    Dialogs stay in).
 * Fixture contract: positive figures, inflation > 0, all registered nodes
 * rendered. Renders once, flips the page basis live, restores today.
 *
 * W5.1 (D-W51-9) adds PLUMBING only — `opts.pageId` (which page's basis to
 * flip) and `opts.root` (collect from document.body when the fixture portals,
 * e.g. a Radix Dialog). The per-class assertions above are byte-untouched and
 * every landed two-argument call keeps its meaning.
 */
export interface BasisSweepOptions {
  /** Which page's basis to flip (default: the calculators page). W5.1 sweeps
   *  /what-if with WHATIF_PAGE_ID. */
  pageId?: string;
  /** Root to collect from (default: the render container). Portaled content
   *  (Radix Dialog) lives on document.body — pass it explicitly. */
  root?: HTMLElement;
}

export function expectBasisDiscipline(
  el: ReactElement,
  registry: BasisRegistry,
  opts: BasisSweepOptions = {},
): void {
  const pageId = opts.pageId ?? CALCULATORS_PAGE_ID;
  const view = render(el);
  const root = opts.root ?? view.container;
  const today = collect(root, registry);
  act(() => useDollarBasisStore.getState().setBasis(pageId, 'future'));
  const future = collect(root, registry);
  act(() => useDollarBasisStore.getState().setBasis(pageId, 'today'));

  const problems: string[] = [];
  for (const f of registry.figures) {
    const t = today.figures.get(f.testId)!;
    const fu = future.figures.get(f.testId)!;
    if (t.length !== fu.length) {
      problems.push(`${f.testId}: node count changed across bases (${t.length} → ${fu.length})`);
      continue;
    }
    t.forEach((snapT, i) => {
      const snapF = fu[i];
      if (f.cls === 'convertible') {
        if (snapT.text === snapF.text)
          problems.push(
            `${f.testId}[${i}]: convertible but byte-identical across bases ("${snapT.text}")`,
          );
        else if (parseDollars(snapF.text) <= parseDollars(snapT.text))
          problems.push(
            `${f.testId}[${i}]: future value must exceed today value (deflation direction)`,
          );
        if (!hasMark(snapT.text, 'today') || hasMark(snapT.text, 'future'))
          problems.push(
            `${f.testId}[${i}]: today render must carry a today mark and no future mark ("${snapT.text}")`,
          );
        if (!hasMark(snapF.text, 'future') || hasMark(snapF.text, 'today'))
          problems.push(
            `${f.testId}[${i}]: future render must carry a future mark and no today mark ("${snapF.text}")`,
          );
      } else if (f.cls === 'invariant') {
        if (snapT.text !== snapF.text)
          problems.push(
            `${f.testId}[${i}]: invariant but changed across bases ("${snapT.text}" → "${snapF.text}")`,
          );
      } else {
        // pinned
        if (snapT.text !== snapF.text)
          problems.push(`${f.testId}[${i}]: pinned but value changed across bases`);
        const basis = f.pinnedBasis;
        if (!basis)
          throw new Error(`${f.testId}: pinned figure missing pinnedBasis (contract violation)`);
        // B2: node, OR parent, OR the declared mark element (markTestId) — in each basis.
        const markT = today.marks.get(f.testId);
        const markF = future.marks.get(f.testId);
        if (
          !hasMark(snapT.text, basis) &&
          !hasMark(snapT.parentText, basis) &&
          !(markT !== undefined && hasMark(markT, basis))
        )
          problems.push(`${f.testId}[${i}]: pinned(${basis}) mark missing in today render`);
        if (
          !hasMark(snapF.text, basis) &&
          !hasMark(snapF.parentText, basis) &&
          !(markF !== undefined && hasMark(markF, basis))
        )
          problems.push(`${f.testId}[${i}]: pinned(${basis}) mark missing in future render`);
      }
    });
  }
  for (const c of registry.charts) {
    const capT = today.captions.get(c.captionTestId)!;
    const capF = future.captions.get(c.captionTestId)!;
    if (c.cls === 'convertible') {
      if (!hasMark(capT, 'today'))
        problems.push(`${c.captionTestId}: today caption lacks a today mark ("${capT}")`);
      if (!hasMark(capF, 'future'))
        problems.push(`${c.captionTestId}: future caption lacks a future mark ("${capF}")`);
    } else {
      const basis = c.pinnedBasis;
      if (!basis) throw new Error(`${c.captionTestId}: pinned chart missing pinnedBasis`);
      if (!hasMark(capT, basis) || !hasMark(capF, basis))
        problems.push(`${c.captionTestId}: pinned(${basis}) caption mark missing in one basis`);
    }
    if (c.rowsTestId) {
      const rT = today.rows.get(c.chartTestId)!;
      const rF = future.rows.get(c.chartTestId)!;
      if (c.cls === 'pinned' && rT !== rF)
        problems.push(
          `${c.chartTestId}: pinned(${c.pinnedBasis}) chart DATA changed across bases — history re-inflated`,
        );
      if (c.cls === 'convertible' && rT === rF)
        problems.push(`${c.chartTestId}: convertible chart DATA byte-identical across bases`);
    }
  }
  for (const snap of [today, future]) {
    for (const loose of snap.looseDollarTexts) {
      problems.push(`UNREGISTERED dollar figure outside the registry: "${loose}"`);
    }
  }
  if (problems.length > 0) {
    throw new Error(['', 'basis-audit sweep failed:', ...problems.map((p) => `  - ${p}`), ''].join('\n'));
  }
}
