import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Wave-4 a11y: prefers-reduced-motion. Every Tailwind class token that
// triggers movement (tailwindcss-animate entrance/exit engines and the
// built-in loops) must be gated behind a `motion-safe:` variant so users
// with "reduce motion" set don't get zooming dialogs, sliding sheets, or
// pulsing skeletons. Mirrors src/components/layout/TourOverlay.tsx:195.
//
// A "token" is a whitespace/quote-delimited class candidate; the gate may
// appear anywhere in its variant chain (`motion-safe:data-[state=open]:
// animate-in` and `data-[state=open]:motion-safe:animate-in` both pass).
// Static modifiers (fade-in-0, zoom-out-95, slide-in-from-*) are inert
// without an animate-in/out engine and are not policed. Escape hatch:
// `// motion-policy: allow` on the same line.

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const ENGINE_RE = /animate-(in|out|pulse|spin|bounce|ping)(?![\w-])/;
const ALLOW_MARKER = '// motion-policy: allow';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSourceFiles(full)));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('motion-safe policy', () => {
  it('every animate-* engine token in src/ carries a motion-safe: gate', async () => {
    const violations: string[] = [];
    for (const file of await collectSourceFiles(SRC_DIR)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (line.includes(ALLOW_MARKER)) return;
        for (const token of line.split(/[\s"'`,{}]+/)) {
          if (ENGINE_RE.test(token) && !token.includes('motion-safe:')) {
            const rel = path.relative(path.resolve(__dirname, '..', '..'), file);
            violations.push(`  ${rel}:${i + 1}  ${token}`);
          }
        }
      });
    }
    expect(
      violations,
      [
        '',
        'Ungated motion class(es) found — prefix with `motion-safe:`:',
        ...violations,
        '',
        `Escape: append \`${ALLOW_MARKER}\` to the line (justify in a comment).`,
        '',
      ].join('\n'),
    ).toEqual([]);
  });

  // Wave-17 smoke: an UN-prefixed arbitrary [animation-duration:...] beside a
  // motion-safe:animate-* engine loses the cascade — the variant form of
  // animate-in carries its own duration and wins, so the typed duration is
  // silently dead (the 180ms fade actually ran 150ms). Every arbitrary
  // animation-duration token must ride the same motion-safe: variant chain.
  it('every [animation-duration:...] token in src/ carries a motion-safe: gate', async () => {
    const violations: string[] = [];
    for (const file of await collectSourceFiles(SRC_DIR)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (line.includes(ALLOW_MARKER)) return;
        for (const token of line.split(/[\s"'`,{}]+/)) {
          if (token.includes('[animation-duration:') && !token.includes('motion-safe:')) {
            const rel = path.relative(path.resolve(__dirname, '..', '..'), file);
            violations.push(`  ${rel}:${i + 1}  ${token}`);
          }
        }
      });
    }
    expect(
      violations,
      [
        '',
        'Un-prefixed typed animation-duration found — the motion-safe animate engine',
        'overrides it (dead 180ms). Use `motion-safe:[animation-duration:...]`:',
        ...violations,
        '',
      ].join('\n'),
    ).toEqual([]);
  });
});
