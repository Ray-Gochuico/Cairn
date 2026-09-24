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
    'const\\s+(SEG_)?BTN_(BASE|ACTIVE)\\s*=', // the constant pairs (four SEG_BTN_* + three BTN_*)
    "'px-2 py-0\\.5 text-xs transition-colors'", // the base literal itself, retyped anywhere
  ].join('|'),
);

describe('the copies stay dead (B2 — one implementation, one contract)', () => {
  it('no src file outside the shared module declares the class pair or retypes its base literal', async () => {
    const files = await collectSourceFiles(path.join(ROOT, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === SHARED) continue;
      if (COPY_RE.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
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
});
