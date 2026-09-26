import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { SEG_BTN_ACTIVE, SEG_BTN_BASE } from '@/components/ui/segmented-control';
import { collectSourceFiles, stripComments } from './source-walker';

/* ── The copies stay dead (B2 D-B2-7, promoted into tests/policy by v1.7.1
   A-5a (3) — D-B2-10's chip). The seven verbatim copies of the segmented
   control collapsed into src/components/ui/segmented-control.tsx; this
   ratchet keeps them dead. The shared module's aria/keyboard CONTRACT stays
   in tests/components/ui/segmented-control.test.tsx. ── */
const ROOT = path.resolve(__dirname, '..', '..');
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

describe('the ratchet on the ratchet (A-5a — an exemption or a walk that stops biting fails HERE)', () => {
  it('the walk covers the whole of src/ (> 600 files), the shared module among them', async () => {
    const files = (await collectSourceFiles(path.join(ROOT, 'src'))).map((f) =>
      path.relative(ROOT, f).split(path.sep).join('/'),
    );
    expect(files.length).toBeGreaterThan(600);
    expect(files).toContain(SHARED);
  });

  it('the SHARED exemption is load-bearing: the shared module is exactly what the detector hunts', () => {
    expect(isCopy(stripComments(readFileSync(path.join(ROOT, SHARED), 'utf8')))).toBe(true);
  });
});
