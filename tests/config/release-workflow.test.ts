// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * v1.7.1 U3 (CR-U3-4): release.yml's test gate gains exactly three steps — the
 * node-project type-check (chip I-(a), release.yml half), the released-schema
 * guard on the tag being released, and an explicit run of the upgrade-path
 * suites — plus the full-history checkout the guard needs. Text slices, not a
 * YAML parser (no new dependency). The shape is tests/config/ci-workflow.test.ts's
 * (D-P5-12, P5 review round): each step must be LIVE — its uncommented
 * `- name:` line, its exact `run:` line, no `if:` and no `continue-on-error:` —
 * inside the test-gate job's true bounds and in order, and a planted `it`
 * applies every switch-off to the real file (plan review R-2). test.yml is
 * P5's and is not read here.
 */
const YML = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8');

/** CX-U3-1..3 (copy contract) and their exact commands, in order. */
const STEPS = [
  { name: 'Type check (node project — configs, scripts, e2e)', run: 'npx tsc -p tsconfig.node.json --noEmit' },
  { name: 'Released-schema guard (previous tag)', run: 'node scripts/released-schema-guard.mjs "${GITHUB_REF_NAME}"' },
  {
    name: 'Upgrade path from every released schema',
    run: 'npx vitest run tests/db/upgrade-path.test.ts tests/db/released-schemas.test.ts tests/policy/migrations-policy.test.ts tests/scripts/released-schema-guard.test.ts',
  },
] as const;

/** The test-gate job's text — from its key line to the NEXT top-level job key (any name, digits included), or the end. */
function testGateJob(yml: string): string {
  const start = yml.search(/^ {2}test-gate:$/m);
  if (start < 0) return '';
  const next = yml.slice(start + 1).search(/^ {2}[\w-]+:$/m);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

/** A LIVE step's block: its uncommented first line (`- name: …` / `- uses: …`) through the line before the next step, or the job's end. */
function stepBlock(job: string, firstLine: string): string {
  const lines = job.split('\n');
  const first = lines.indexOf(firstLine);
  if (first < 0) return '';
  let last = first + 1;
  while (last < lines.length && !/^ {6}- /.test(lines[last])) last += 1;
  return lines.slice(first, last).join('\n');
}

/** Why the test gate does NOT carry the three steps live, blocking and in order, with the full-history checkout ([] = it does). */
function releaseGateProblems(yml: string): string[] {
  const job = testGateJob(yml);
  if (job === '') return ['the test-gate: job block was not found — renamed? re-point this pin'];
  const problems: string[] = [];
  const checkout = stepBlock(job, '      - uses: actions/checkout@v4');
  if (!/^ {8}with:\n(?: {10}#.*\n)* {10}fetch-depth: 0$/m.test(checkout)) {
    problems.push('the test-gate checkout does not fetch the full history (with: fetch-depth: 0)');
  }
  const app = stepBlock(job, '      - name: Type check');
  if (!/^ {8}run: npx tsc --noEmit$/m.test(app)) problems.push('the app type-check (`npx tsc --noEmit`) is not live in the test gate');
  let prev = app === '' ? -1 : job.indexOf(app);
  for (const { name, run } of STEPS) {
    const block = stepBlock(job, `      - name: ${name}`);
    if (block === '') {
      problems.push(`the test gate has no live "- name: ${name}" step`);
      continue;
    }
    if (!block.split('\n').includes(`        run: ${run}`)) problems.push(`"${name}" does not run \`${run}\` on a live line`);
    if (/^[ \t]*(?:continue-on-error|if)[ \t]*:/m.test(block)) {
      problems.push(`"${name}" is conditional or non-blocking (if: / continue-on-error:)`);
    }
    const at = job.indexOf(block);
    if (at < prev) problems.push(`"${name}" is out of order (after Type check, in CX-U3-1..3 order)`);
    prev = at;
  }
  const cargo = stepBlock(job, '      - name: cargo test (src-tauri)');
  if (cargo === '' || job.indexOf(cargo) < prev) problems.push('cargo test is missing, or runs before the new steps');
  return problems;
}

describe('release.yml — the test gate (v1.7.1 U3)', () => {
  it('checks out the full history, then runs the node-project type-check, the released-schema guard and the upgrade-path suites — live, blocking, after Type check, before cargo test', () => {
    expect(releaseGateProblems(YML)).toEqual([]);
  });

  it('each new run line, and fetch-depth: 0, appears once in the whole file (never in a build job)', () => {
    for (const { run } of STEPS) expect(YML.split(`        run: ${run}\n`).length - 1).toBe(1);
    expect(YML.split('fetch-depth: 0').length - 1).toBe(1);
  });

  it('the job slicer is real: it ends at the next job whatever its name (build-macos-arm64 has digits)', () => {
    const job = testGateJob(YML);
    expect(job).toContain('        run: npm test -- --run\n');
    expect(job).not.toContain('needs: test-gate');
    expect(testGateJob('jobs:\n  lint:\n    x\n')).toBe('');
  });

  // Plan review R-2 (P5's D-P5-12 standard): the pin must refuse every way to
  // switch a step OFF while its text stays in the file.
  it('the pin refuses a step that is commented out, non-blocking, conditional, renamed or moved, and a shallow checkout (planted)', () => {
    const NAME_LINE = `      - name: ${STEPS[1].name}\n`;
    const RUN_LINE = `        run: ${STEPS[1].run}\n`;
    const UPGRADE_RUN = `        run: ${STEPS[2].run}\n`;
    const start = YML.indexOf(NAME_LINE);
    const end = YML.indexOf(RUN_LINE, start) + RUN_LINE.length;
    expect(start, 'the landed guard step (CX-U3-2 name) was not found').toBeGreaterThan(-1);
    const step = YML.slice(start, end);
    const without = YML.replace(`\n${step}`, '');
    const planted: Record<string, string> = {
      'guard commented out': YML.replace(step, step.replace(/^ {6}/gm, '      # ')),
      'guard run line commented': YML.replace(RUN_LINE, RUN_LINE.replace('        run:', '        # run:')),
      'guard name line commented (the run folds into the step above)': YML.replace(NAME_LINE, NAME_LINE.replace('      - name:', '      # - name:')),
      'guard continue-on-error': YML.replace(RUN_LINE, `${RUN_LINE}        continue-on-error: true\n`),
      'guard if: false': YML.replace(NAME_LINE, `${NAME_LINE}        if: false\n`),
      'guard || true': YML.replace(RUN_LINE, RUN_LINE.replace(/\n$/, ' || true\n')),
      'guard renamed (CX-U3-2)': YML.replace(NAME_LINE, '      - name: Schema guard\n'),
      'guard moved into its own job': without.replace(
        '\n  build-macos-arm64:\n',
        `\n  u3-moved:\n    runs-on: macos-14\n    steps:\n${step}\n  build-macos-arm64:\n`,
      ),
      'guard before the app type-check': without.replace('      - name: Type check\n', `${step}\n      - name: Type check\n`),
      'upgrade-path step continue-on-error': YML.replace(UPGRADE_RUN, `${UPGRADE_RUN}        continue-on-error: true\n`),
      'shallow checkout (fetch-depth removed)': YML.replace(/^ {10}fetch-depth: 0\n/m, ''),
    };
    for (const [label, text] of Object.entries(planted)) expect(text, `${label}: the plant did not apply`).not.toBe(YML);
    const survivors = Object.entries(planted)
      .filter(([, text]) => releaseGateProblems(text).length === 0)
      .map(([label]) => label);
    expect(survivors, 'plants the pin let through').toEqual([]);
  });
});
