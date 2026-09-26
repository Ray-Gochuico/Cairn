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

/** CP5-4: the step's name in the CI UI (copy contract). */
const NODE_STEP_NAME = 'Type check (node project — configs, scripts, e2e)';

/** The `unit:` job's text — from its key line to the NEXT top-level job key (any name), or the end. */
function unitJob(yml: string): string {
  const start = yml.search(/^ {2}unit:$/m);
  if (start < 0) return '';
  const next = yml.slice(start + 1).search(/^ {2}[\w-]+:$/m);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

/** A LIVE step's block: its uncommented `- name:` line through the line before the next step, or the job's end. */
function stepBlock(job: string, name: string): string {
  const lines = job.split('\n');
  const first = lines.indexOf(`      - name: ${name}`);
  if (first < 0) return '';
  let last = first + 1;
  while (last < lines.length && !/^ {6}- /.test(lines[last])) last += 1;
  return lines.slice(first, last).join('\n');
}

/**
 * Why the unit job does NOT run the node-project type-check as a LIVE,
 * BLOCKING step after the app one ([] = it does). P5 review round: the
 * `run:` lines are matched as uncommented YAML under their own `- name:`
 * (CP5-4's name, exactly), and the step may carry no `if:` and no
 * `continue-on-error:` — a switched-off step is not a check.
 */
function nodeStepProblems(yml: string): string[] {
  const job = unitJob(yml);
  if (job === '') return ['the unit: job block was not found — renamed? re-point this pin'];
  const problems: string[] = [];
  const app = stepBlock(job, 'Type check');
  const node = stepBlock(job, NODE_STEP_NAME);
  if (!/^ {8}run: npx tsc --noEmit$/m.test(app)) problems.push('the app type-check step (`npx tsc --noEmit`) is not live in the unit job');
  if (node === '') return [...problems, `the unit job has no live "- name: ${NODE_STEP_NAME}" step`];
  if (!/^ {8}run: npx tsc -p tsconfig\.node\.json --noEmit$/m.test(node)) {
    problems.push('the node-project step does not run `npx tsc -p tsconfig.node.json --noEmit` on a live line');
  }
  if (/^[ \t]*(?:continue-on-error|if)[ \t]*:/m.test(node)) {
    problems.push('the node-project step is conditional or non-blocking (if: / continue-on-error:)');
  }
  if (app !== '' && job.indexOf(node) < job.indexOf(app)) problems.push('the node-project step runs before the app type-check');
  return problems;
}

describe('CI — the unit job type-checks both TypeScript projects (I-(a))', () => {
  it('the unit job runs `npx tsc -p tsconfig.node.json --noEmit`, after the app type-check', () => {
    expect(nodeStepProblems(readFileSync(TEST_YML, 'utf8'))).toEqual([]);
  });

  it('the job slicer is real: it finds the landed steps and nothing from the rust job', () => {
    const job = unitJob(readFileSync(TEST_YML, 'utf8'));
    expect(job).toContain('run: npm test\n');
    expect(job).not.toContain('cargo check');
    expect(unitJob('jobs:\n  lint:\n    x\n')).toBe('');
  });

  // P5 review round: the pin must refuse every way to switch the step OFF
  // while its text stays in the file — each plant is applied to the real
  // test.yml, and each must yield a problem.
  it('the pin refuses a step that is commented out, non-blocking, conditional, renamed or moved (planted)', () => {
    const yml = readFileSync(TEST_YML, 'utf8');
    const NAME_LINE = `      - name: ${NODE_STEP_NAME}\n`;
    const RUN_LINE = '        run: npx tsc -p tsconfig.node.json --noEmit\n';
    const start = yml.indexOf(NAME_LINE);
    const end = yml.indexOf(RUN_LINE, start) + RUN_LINE.length;
    expect(start, 'the landed step (CP5-4 name) was not found').toBeGreaterThan(-1);
    const step = yml.slice(start, end);
    const without = yml.replace(`\n${step}`, '');
    const planted: Record<string, string> = {
      'commented out': yml.replace(step, step.replace(/^ {6}/gm, '      # ')),
      'run line commented': yml.replace(RUN_LINE, '        # run: npx tsc -p tsconfig.node.json --noEmit\n'),
      'name line commented (the run folds into the step above)': yml.replace(NAME_LINE, `      # - name: ${NODE_STEP_NAME}\n`),
      'continue-on-error': yml.replace(RUN_LINE, `${RUN_LINE}        continue-on-error: true\n`),
      'if: false': yml.replace(NAME_LINE, `${NAME_LINE}        if: false\n`),
      '|| true': yml.replace(RUN_LINE, '        run: npx tsc -p tsconfig.node.json --noEmit || true\n'),
      'renamed (CP5-4)': yml.replace(NAME_LINE, '      - name: Type check node\n'),
      'moved into a job between unit and rust-check': without.replace(
        '\n  rust-check:\n',
        `\n  tsc-node:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n  rust-check:\n`,
      ),
      'before the app type-check': without.replace('      - name: Type check\n', `${step}\n      - name: Type check\n`),
    };
    for (const [label, text] of Object.entries(planted)) expect(text, `${label}: the plant did not apply`).not.toBe(yml);
    const survivors = Object.entries(planted)
      .filter(([, text]) => nodeStepProblems(text).length === 0)
      .map(([label]) => label);
    expect(survivors, 'plants the pin let through').toEqual([]);
  });
});
