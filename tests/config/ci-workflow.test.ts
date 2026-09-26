// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * v1.7.1 I-(a): CI runs the node-project type-check that gate.sh runs on every
 * merge (`tsc-node`: vite/vitest/playwright configs, scripts/dev-servers.ts,
 * e2e/**). It was red on v1.7.0 and green since v1.7.1 lane I; without a CI
 * step a PR could re-break it and only the next local gate would notice.
 * release.yml is lane U's this train and is deliberately not read here.
 */
const TEST_YML = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'test.yml');

/** The `unit:` job's text — from its key to the next top-level job key. */
function unitJob(yml: string): string {
  const start = yml.indexOf('\n  unit:\n');
  const next = yml.indexOf('\n  rust-check:\n', start);
  return start < 0 || next < 0 ? '' : yml.slice(start, next);
}

describe('CI — the unit job type-checks both TypeScript projects (I-(a))', () => {
  it('the unit job runs `npx tsc -p tsconfig.node.json --noEmit`, after the app type-check', () => {
    const job = unitJob(readFileSync(TEST_YML, 'utf8'));
    expect(job, 'the unit: job block was not found — renamed? re-point this pin').not.toBe('');
    const app = job.indexOf('run: npx tsc --noEmit\n');
    const node = job.indexOf('run: npx tsc -p tsconfig.node.json --noEmit\n');
    expect(app).toBeGreaterThan(-1);
    expect(node, 'add the node-project type-check step to the unit job').toBeGreaterThan(app);
  });

  it('the job slicer is real: it finds the landed steps and nothing from the rust job', () => {
    const job = unitJob(readFileSync(TEST_YML, 'utf8'));
    expect(job).toContain('run: npm test\n');
    expect(job).not.toContain('cargo check');
    expect(unitJob('jobs:\n  lint:\n    x\n')).toBe('');
  });
});
