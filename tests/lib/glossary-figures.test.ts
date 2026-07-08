import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Glossary $-figure rot check (Wave 8 SHOULD-7, sibling of the trivia bank's
// statutory allowlist): every dollar figure in glossary.ts must be on this
// documented allowlist. Adding a NEW figure fails until it's listed here with
// its statute/source and review note — which is the point: figures rot
// (the Roth cap sat at a stale $7,000 and the DCFSA at a pre-OBBBA $5,000
// until the 2026-07 review). Prefer figure-free phrasing; when a figure earns
// its place, label its year in the prose AND document it here.
// ---------------------------------------------------------------------------
const ALLOWED_FIGURES: ReadonlyArray<{ figure: string; why: string }> = [
  { figure: '$1M', why: 'NOMINAL VS REAL — illustrative round number, not a statute' },
  { figure: '$12,500', why: 'OBBBA overtime deduction cap, single (2025–2028 statute)' },
  { figure: '$150k', why: 'OBBBA overtime phase-out start, single' },
  { figure: '$200k', why: 'Additional Medicare / NIIT threshold, single — statutory, UNINDEXED' },
  { figure: '$25,000', why: 'OBBBA overtime deduction cap, MFJ' },
  { figure: '$250k', why: 'Additional Medicare / NIIT threshold, MFJ — statutory, UNINDEXED' },
  { figure: '$2k', why: 'Coverdell ESA annual cap — statutory, unindexed' },
  { figure: '$300k', why: 'OBBBA overtime phase-out start, MFJ' },
  { figure: '$35k', why: 'SECURE 2.0 529→Roth lifetime rollover cap' },
  { figure: '$60k', why: 'SEQUENTIAL WITHDRAWAL — illustrative expense example' },
  { figure: '$7,500', why: 'IRA cap 2026 (IRS Notice 2025-67) AND DCFSA cap 2026 (OBBBA) — review yearly' },
  { figure: '$77k', why: 'SEQUENTIAL WITHDRAWAL — illustrative gross-up example' },
];

describe('glossary $-figure rot check', () => {
  const src = readFileSync(resolve(__dirname, '../../src/lib/glossary.ts'), 'utf8');
  const found = [...new Set(src.match(/\$[\d][\d,]*(?:\.\d+)?[kM]?/g) ?? [])].sort();

  it('every dollar figure in glossary.ts is on the documented allowlist', () => {
    const allowed = new Set(ALLOWED_FIGURES.map((f) => f.figure));
    expect(found.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it('allowlist hygiene: entries no longer present must be pruned', () => {
    const present = new Set(found);
    expect(ALLOWED_FIGURES.map((f) => f.figure).filter((f) => !present.has(f))).toEqual([]);
  });
});
