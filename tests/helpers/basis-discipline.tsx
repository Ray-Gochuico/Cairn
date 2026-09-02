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

function hasMark(text: string, basis: DollarBasis): boolean {
  return (basis === 'today' ? TODAY_MARKS : FUTURE_MARKS).some((m) => text.includes(m));
}
function parseDollars(text: string): number {
  const m = text.match(/\$[\d,]+/);
  if (!m) throw new Error(`basis sweep: no parseable $ figure in "${text}"`);
  return Number(m[0].replace(/[$,]/g, ''));
}

interface FigureSnap {
  text: string;
  parentText: string;
}
interface Snapshot {
  figures: Map<string, FigureSnap[]>;
  captions: Map<string, string>;
  looseDollarTexts: string[];
}

function collect(container: HTMLElement, registry: BasisRegistry): Snapshot {
  const figures = new Map<string, FigureSnap[]>();
  for (const f of registry.figures) {
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
  for (const c of registry.charts) {
    const cap = container.querySelector<HTMLElement>(`[data-testid="${c.captionTestId}"]`);
    if (!cap) throw new Error(`basis sweep: chart caption "${c.captionTestId}" missing`);
    captions.set(c.captionTestId, cap.textContent ?? '');
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
    if (chartSelectors.some((s) => el.closest(s))) continue; // chart interiors: covered by caption + wiring pins
    if (figureSelectors.some((s) => el.closest(s))) continue;
    looseDollarTexts.push(text.trim());
  }
  return { figures, captions, looseDollarTexts };
}

/**
 * W5 frozen sweep semantics (spec § Architecture, per-class assertions):
 *  - convertible: value differs across page bases (future > today for positive
 *    figures under positive inflation — exact deflators are the ANCHOR tests'
 *    job) AND carries the active basis mark, never the other basis's mark.
 *  - invariant: byte-identical textContent across bases.
 *  - pinned: byte-identical AND its pinnedBasis mark appears in the node or
 *    its parent element in BOTH bases (the phrase may close the sentence).
 *  - charts: the caption names the active basis (convertible) or the declared
 *    pinnedBasis, in both bases.
 *  - completeness: no unregistered $-figure anywhere outside chart subtrees.
 * Fixture contract: positive figures, inflation > 0, all registered nodes
 * rendered. Renders once, flips the page basis live, restores today.
 */
export function expectBasisDiscipline(el: ReactElement, registry: BasisRegistry): void {
  const view = render(el);
  const today = collect(view.container, registry);
  act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
  const future = collect(view.container, registry);
  act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'today'));

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
        if (!hasMark(snapT.text, basis) && !hasMark(snapT.parentText, basis))
          problems.push(`${f.testId}[${i}]: pinned(${basis}) mark missing in today render`);
        if (!hasMark(snapF.text, basis) && !hasMark(snapF.parentText, basis))
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
