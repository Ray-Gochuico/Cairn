import { readFileSync, statSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Wave-12 Trailhead Stone: the committed typeface is SELF-HOSTED. A strict
// no-CDN stance (the app runs offline in Tauri) plus a hard bundle budget.

const ROOT = process.cwd();
const FONT = path.join(ROOT, 'src/assets/fonts/inter-tight-latin-wght-normal.woff2');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.isFile() && /\.(ts|tsx|css|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('font policy', () => {
  it('the vendored Inter Tight variable woff2 exists with its OFL license', () => {
    expect(existsSync(FONT)).toBe(true);
    expect(existsSync(path.join(ROOT, 'src/assets/fonts/OFL.txt'))).toBe(true);
  });

  it('total vendored font weight stays under the 120KB budget', () => {
    expect(statSync(FONT).size).toBeLessThan(120 * 1024); // measured ~44KB at vendoring
  });

  it('globals.css @font-face binds the local file (variable axis 100-900, swap)', () => {
    const css = readFileSync(path.join(ROOT, 'src/globals.css'), 'utf8');
    expect(css).toMatch(/@font-face[\s\S]*?font-family:\s*'InterTightVariable'/);
    expect(css).toMatch(/font-weight:\s*100 900/);
    expect(css).toMatch(/inter-tight-latin-wght-normal\.woff2/);
    expect(css).toMatch(/font-display:\s*swap/);
  });

  it('tailwind font-sans leads with InterTightVariable', () => {
    const cfg = readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(cfg).toMatch(/sans:\s*\[\s*'InterTightVariable'/);
  });

  it('no external font hosts anywhere (index.html + src)', () => {
    const HOST_RE = /fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn\.fontshare/;
    const files = [path.join(ROOT, 'index.html'), ...collectSourceFiles(path.join(ROOT, 'src'))];
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (HOST_RE.test(line)) {
          offenders.push(`  ${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      ['', 'External font host reference(s) found — the app must run offline:', ...offenders].join(
        '\n',
      ),
    ).toEqual([]);
  });
});
