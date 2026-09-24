import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SegmentedControl,
  SEG_BTN_ACTIVE,
  SEG_BTN_BASE,
  SEG_GROUP,
} from '@/components/ui/segmented-control';
import { collectSourceFiles, stripComments } from '../../policy/source-walker';

const OPTIONS = [
  { value: 'KEEP', label: 'Keep contributing' },
  { value: 'STOP', label: 'Stop today' },
] as const;

/* ── The aria/keyboard contract, pinned ONCE for every consumer (B2 D-B2-7):
   a role=group named by `label`; native buttons, every one a tab stop;
   exactly one aria-pressed="true"; Enter/Space activate; fully controlled. ── */
describe('SegmentedControl — the ONE aria-pressed group (was seven verbatim copies)', () => {
  it('ARIA: role=group named by `label`; one native <button type="button"> per option; no tabindex; exactly one aria-pressed="true"', () => {
    render(<SegmentedControl label="Path mode" options={OPTIONS} value="KEEP" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Path mode' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON');
      expect(b).toHaveAttribute('type', 'button');
      expect(b).not.toHaveAttribute('tabindex'); // every option is a natural tab stop — no roving index
    }
    expect(screen.getByRole('button', { name: 'Keep contributing' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stop today' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('CONTROLLED: the pressed option follows `value`; the control holds no state of its own', () => {
    const { rerender } = render(
      <SegmentedControl label="Path mode" options={OPTIONS} value="KEEP" onChange={() => {}} />,
    );
    rerender(<SegmentedControl label="Path mode" options={OPTIONS} value="STOP" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Stop today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Keep contributing' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('POINTER: a click reports that option value once — including a click on the already-pressed option (D-B2-8; callers are idempotent)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Path mode" options={OPTIONS} value="KEEP" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Stop today' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('STOP');
    await user.click(screen.getByRole('button', { name: 'Keep contributing' })); // already pressed
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('KEEP');
  });

  it('KEYBOARD: Tab reaches each option in order; Enter and Space activate (the native button contract)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Path mode" options={OPTIONS} value="KEEP" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Keep contributing' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('KEEP');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Stop today' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('STOP');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('LOOK: the house classes byte-for-byte — pressed carries the active pair, every option after the first carries border-l, the root takes className', () => {
    render(
      <SegmentedControl label="Path mode" options={OPTIONS} value="STOP" onChange={() => {}} className="self-start" />,
    );
    const group = screen.getByRole('group', { name: 'Path mode' });
    expect(group.className).toBe(`${SEG_GROUP} self-start`);
    const [keep, stop] = within(group).getAllByRole('button');
    expect(keep.className).toBe(SEG_BTN_BASE);
    expect(stop.className).toBe(`${SEG_BTN_BASE} border-l ${SEG_BTN_ACTIVE}`);
    // The constants ARE the seven landed copies' bytes.
    expect(SEG_BTN_BASE).toBe('px-2 py-0.5 text-xs transition-colors');
    expect(SEG_BTN_ACTIVE).toBe('bg-primary text-primary-foreground');
    expect(SEG_GROUP).toBe('inline-flex rounded border overflow-hidden');
  });

  it('N options: three segments, one pressed, border-l on the second and third', () => {
    const three = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    render(<SegmentedControl label="Three" options={three} value="b" onChange={() => {}} />);
    const buttons = within(screen.getByRole('group', { name: 'Three' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map((b) => b.className.includes('border-l'))).toEqual([false, true, true]);
  });
});

/* ── The copies stay dead. Lives here (not tests/policy/) because tests/policy
   is embargoed this wave except the dollar-basis file (D-B2-10; chip: promote). ── */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SHARED = 'src/components/ui/segmented-control.tsx';
const COPY_RE = new RegExp(
  [
    '(?:const|let|var)\\s+(SEG_)?BTN_(BASE|ACTIVE)\\s*=', // the constant pairs (four SEG_BTN_* + three BTN_*), any declaration
    '["\'`]px-2 py-0\\.5 text-xs transition-colors["\'`]', // the base literal itself, retyped anywhere, in any quote
  ].join('|'),
);

/* B2 review (MINOR 2): the literal arm is order-sensitive, so a retype is
   also caught by its token SET — any quoted string (a template literal's
   static text split at its ${…} holes) made ONLY of the pair's classes
   (+ the landed border-l) that holds the whole base, in any order. A string
   that adds a foreign class is a different control, not a copy; the active
   pair alone stays name-only (it legitimately styles other surfaces). */
const BASE_TOKENS = SEG_BTN_BASE.split(' ');
const PAIR_TOKENS = new Set([...BASE_TOKENS, ...SEG_BTN_ACTIVE.split(' '), 'border-l']);
const QUOTED_RES = [/'([^'\n]*)'/g, /"([^"\n]*)"/g, /`([^`]*)`/g]; // each quote style scanned on its own
function retypesPairTokens(source: string): boolean {
  for (const re of QUOTED_RES) {
    for (const m of source.matchAll(re)) {
      for (const chunk of m[1].split(/\$\{[^}]*\}/)) {
        const tokens = chunk.split(/\s+/).filter(Boolean);
        if (
          tokens.length > 0 &&
          tokens.every((t) => PAIR_TOKENS.has(t)) &&
          BASE_TOKENS.every((t) => tokens.includes(t))
        )
          return true;
      }
    }
  }
  return false;
}
const isCopy = (source: string): boolean => COPY_RE.test(source) || retypesPairTokens(source);

describe('the copies stay dead (B2 — one implementation, one contract)', () => {
  it('no src file outside the shared module declares the class pair or retypes its base literal', async () => {
    const files = await collectSourceFiles(path.join(ROOT, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === SHARED) continue;
      if (isCopy(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
    }
    expect(
      offenders,
      'render <SegmentedControl>, or import SEG_BTN_* from @/components/ui/segmented-control',
    ).toEqual([]);
  });

  it('the detector catches every landed copy shape (an untested detector is a bypass)', () => {
    expect(COPY_RE.test("const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';")).toBe(true);
    expect(COPY_RE.test("const BTN_ACTIVE = 'bg-primary text-primary-foreground';")).toBe(true);
    expect(COPY_RE.test("className={cn('px-2 py-0.5 text-xs transition-colors', on)}")).toBe(true);
    expect(COPY_RE.test("import { SEG_BTN_BASE } from '@/components/ui/segmented-control';")).toBe(false);
    expect(COPY_RE.test("const BUTTON_BASE = 'h-7';")).toBe(false);
  });

  it('B2 review: the detector catches the natural retype shapes — any quote, any order, any declaration', () => {
    // quote-agnostic literal arm
    expect(COPY_RE.test('<button className="px-2 py-0.5 text-xs transition-colors">')).toBe(true);
    expect(COPY_RE.test('className={`px-2 py-0.5 text-xs transition-colors`}')).toBe(true);
    // the declaration arm beyond const
    expect(COPY_RE.test("let BTN_BASE = 'h-7';")).toBe(true);
    expect(COPY_RE.test('var SEG_BTN_ACTIVE = "bg-primary";')).toBe(true);
    // the order-insensitive token SET (the literal arm cannot see these)
    expect(COPY_RE.test("'py-0.5 px-2 text-xs transition-colors'")).toBe(false);
    expect(isCopy("className={cn('py-0.5 px-2 text-xs transition-colors', on)}")).toBe(true);
    expect(isCopy('<button className="transition-colors text-xs py-0.5 px-2">')).toBe(true);
    expect(isCopy('className={`px-2 py-0.5 text-xs transition-colors ${on ? SEG_BTN_ACTIVE : \'\'}`}')).toBe(true);
    expect(isCopy("'bg-primary text-primary-foreground border-l px-2 py-0.5 text-xs transition-colors'")).toBe(true);
    // …and never a different control, nor the active pair on its own
    expect(isCopy("'bg-primary text-primary-foreground'")).toBe(false);
    expect(isCopy("'px-2 py-0.5 text-xs'")).toBe(false);
    expect(isCopy("'px-2 py-0.5 text-xs transition-colors rounded-full'")).toBe(false);
    expect(isCopy('className={cn(SEG_BTN_BASE, i > 0 && \'border-l\', on && SEG_BTN_ACTIVE)}')).toBe(false);
  });
});
