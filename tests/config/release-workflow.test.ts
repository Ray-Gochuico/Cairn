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

// v1.8.0 T12 (post-release review L36): the test gate — and the released-schema
// guard inside it — blocks a build only through each build job's `needs:` edge,
// which was unpinned. Every job other than test-gate lists test-gate DIRECTLY
// (build-windows is also gated through build-macos-arm64, but its own comment
// keeps the edge explicit so it survives a refactor). Text slices, as above.

/** Every top-level job under `jobs:`, in file order: its key and its text (key line to the next key, or the end). */
function jobBlocks(yml: string): Array<{ name: string; text: string }> {
  const start = yml.search(/^jobs:$/m);
  if (start < 0) return [];
  const body = yml.slice(start);
  const keys = [...body.matchAll(/^ {2}([\w-]+):$/gm)];
  return keys.map((m, i) => ({ name: m[1], text: body.slice(m.index, i + 1 < keys.length ? keys[i + 1].index : undefined) }));
}

/** The jobs a job's LIVE `needs:` names — `needs: a`, `needs: [a, b]` or a `- a` block list; quotes and comments dropped ([] = none). */
function needsOf(job: string): string[] {
  const clean = (s: string) => s.replace(/#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  const lines = job.split('\n');
  const at = lines.findIndex((l) => /^ {4}needs:/.test(l));
  if (at < 0) return [];
  const value = clean(lines[at].replace(/^ {4}needs:/, ''));
  if (value.startsWith('[')) return value.slice(1, value.lastIndexOf(']')).split(',').map(clean).filter(Boolean);
  if (value !== '') return [value];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && /^ {6}(?:- |#)/.test(lines[i]); i += 1) {
    if (/^ {6}- /.test(lines[i])) out.push(clean(lines[i].replace(/^ {6}- /, '')));
  }
  return out;
}

/** Why some job could build, sign or publish while the test gate fails ([] = every other job needs test-gate directly). */
function gateEdgeProblems(yml: string): string[] {
  const jobs = jobBlocks(yml);
  if (!jobs.some((j) => j.name === 'test-gate')) return ['the test-gate: job was not found — renamed? re-point this pin'];
  const others = jobs.filter((j) => j.name !== 'test-gate');
  if (others.length === 0) return ['no job besides test-gate was found — the job slicer is broken'];
  return others
    .filter((j) => !needsOf(j.text).includes('test-gate'))
    .map((j) => `${j.name}: its needs: does not list test-gate, so it can build while the gate fails`);
}

describe('release.yml — every build job needs the test gate directly (v1.8.0 T12, post-release review L36)', () => {
  it('build-macos-arm64 and build-windows each list test-gate in needs: (the scalar and the list form, read from the real file)', () => {
    expect(gateEdgeProblems(YML)).toEqual([]);
    const jobs = jobBlocks(YML);
    const needs = (name: string) => needsOf(jobs.find((j) => j.name === name)?.text ?? '');
    expect(needs('build-macos-arm64')).toEqual(['test-gate']);
    expect(needs('build-windows')).toEqual(['test-gate', 'build-macos-arm64']);
    expect(needs('test-gate')).toEqual([]);
  });

  it('needsOf reads the scalar, flow-list and block-list forms, quoted or trailed by a comment', () => {
    expect(needsOf('  a:\n    needs: test-gate  # why\n    runs-on: x\n')).toEqual(['test-gate']);
    expect(needsOf("  a:\n    needs: 'test-gate'\n")).toEqual(['test-gate']);
    expect(needsOf('  a:\n    needs: [test-gate, build-macos-arm64]\n')).toEqual(['test-gate', 'build-macos-arm64']);
    expect(needsOf('  a:\n    needs:\n      - test-gate  # why\n      - "build-macos-arm64"\n    runs-on: x\n')).toEqual([
      'test-gate',
      'build-macos-arm64',
    ]);
    expect(needsOf('  a:\n    runs-on: x\n    steps:\n      - name: needs\n')).toEqual([]);
    expect(needsOf('  a:\n    # needs: test-gate\n    runs-on: x\n')).toEqual([]);
  });

  // L36's fix: plant "needs removed" (and every other way to lose the edge) in
  // the switch-off list; the list and block forms that keep it must pass.
  it('the pin refuses a build job whose needs: lost test-gate, and accepts the forms that keep it (planted)', () => {
    const MAC_NEEDS = '    needs: test-gate  # do not build/sign/publish unless the gate is green\n';
    const WIN_NEEDS = '    needs: [test-gate, build-macos-arm64]\n';
    expect(YML.split(MAC_NEEDS).length - 1, 'the landed build-macos-arm64 needs: line was not found').toBe(1);
    expect(YML.split(WIN_NEEDS).length - 1, 'the landed build-windows needs: line was not found').toBe(1);
    const refused: Record<string, string> = {
      'build-macos-arm64 needs removed': YML.replace(MAC_NEEDS, ''),
      'build-macos-arm64 needs commented out': YML.replace(MAC_NEEDS, `    # ${MAC_NEEDS.trimStart()}`),
      'build-macos-arm64 needs another job': YML.replace(MAC_NEEDS, '    needs: lint\n'),
      'build-macos-arm64 needs a look-alike (test-gate-old)': YML.replace(MAC_NEEDS, '    needs: test-gate-old\n'),
      'build-windows needs removed': YML.replace(WIN_NEEDS, ''),
      'build-windows list drops test-gate (gated only transitively)': YML.replace(WIN_NEEDS, '    needs: [build-macos-arm64]\n'),
      'build-windows block list without test-gate': YML.replace(WIN_NEEDS, '    needs:\n      - build-macos-arm64\n'),
      'a new job with no needs': `${YML}\n  publish-notes:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo notes\n`,
      'the test-gate job renamed': YML.replace(/^ {2}test-gate:$/m, '  tests:'),
    };
    for (const [label, text] of Object.entries(refused)) expect(text, `${label}: the plant did not apply`).not.toBe(YML);
    const survivors = Object.entries(refused)
      .filter(([, text]) => gateEdgeProblems(text).length === 0)
      .map(([label]) => label);
    expect(survivors, 'plants the pin let through').toEqual([]);
    const accepted: Record<string, string> = {
      'build-macos-arm64 as a flow list': YML.replace(MAC_NEEDS, '    needs: [test-gate]\n'),
      'build-windows as a block list': YML.replace(WIN_NEEDS, '    needs:\n      - test-gate\n      - build-macos-arm64\n'),
    };
    for (const [label, text] of Object.entries(accepted)) {
      expect(text, `${label}: the plant did not apply`).not.toBe(YML);
      expect(gateEdgeProblems(text), label).toEqual([]);
    }
  });
});

// v1.8.0 T12 (post-release review L18): tag mode checks only the previous tag's
// row and this release's, so a later edit of an intermediate row ('v1.8.0': 56
// → 57) would drop a shipped schema from the upgrade harness with every test
// green. The release gate also runs the guard's --all mode, which re-checks
// every tag's row against the tag itself; the tag exists by then, so --all can
// pass (before `git tag` it refuses the new row). Pinned the P5 way, like the
// U3 steps above: live name line, exact run line, no if: / continue-on-error:,
// inside the test gate, after the tag-mode guard.
const ALL_TAGS_STEP = {
  name: 'Released-schema guard (every tag)',
  run: 'node scripts/released-schema-guard.mjs --all',
} as const;

/** Why the test gate does NOT run the guard's --all mode as a live, blocking step after the tag-mode guard ([] = it does). */
function allTagsGuardProblems(yml: string): string[] {
  const job = testGateJob(yml);
  if (job === '') return ['the test-gate: job block was not found — renamed? re-point this pin'];
  const block = stepBlock(job, `      - name: ${ALL_TAGS_STEP.name}`);
  if (block === '') return [`the test gate has no live "- name: ${ALL_TAGS_STEP.name}" step`];
  const problems: string[] = [];
  if (!block.split('\n').includes(`        run: ${ALL_TAGS_STEP.run}`)) {
    problems.push(`"${ALL_TAGS_STEP.name}" does not run \`${ALL_TAGS_STEP.run}\` on a live line`);
  }
  if (/^[ \t]*(?:continue-on-error|if)[ \t]*:/m.test(block)) {
    problems.push(`"${ALL_TAGS_STEP.name}" is conditional or non-blocking (if: / continue-on-error:)`);
  }
  const tagMode = stepBlock(job, `      - name: ${STEPS[1].name}`);
  if (tagMode === '' || job.indexOf(block) < job.indexOf(tagMode)) {
    problems.push(`"${ALL_TAGS_STEP.name}" does not run after "${STEPS[1].name}"`);
  }
  return problems;
}

describe('release.yml — the test gate re-checks every released tag with the guard (v1.8.0 T12, post-release review L18)', () => {
  it('runs `node scripts/released-schema-guard.mjs --all` live and blocking in the test gate, after the tag-mode guard, once in the file', () => {
    expect(allTagsGuardProblems(YML)).toEqual([]);
    expect(YML.split(`        run: ${ALL_TAGS_STEP.run}\n`).length - 1).toBe(1);
  });

  it('the pin refuses the --all step commented out, non-blocking, conditional, renamed, moved or re-pointed (planted)', () => {
    const NAME_LINE = `      - name: ${ALL_TAGS_STEP.name}\n`;
    const RUN_LINE = `        run: ${ALL_TAGS_STEP.run}\n`;
    const start = YML.indexOf(NAME_LINE);
    const end = YML.indexOf(RUN_LINE, start) + RUN_LINE.length;
    expect(start, 'the landed --all step was not found').toBeGreaterThan(-1);
    const step = YML.slice(start, end);
    const without = YML.replace(`\n${step}`, '');
    const planted: Record<string, string> = {
      'step removed': without,
      'commented out': YML.replace(step, step.replace(/^ {6}/gm, '      # ')),
      'run line commented': YML.replace(RUN_LINE, RUN_LINE.replace('        run:', '        # run:')),
      'name line commented (the run folds into the step above)': YML.replace(NAME_LINE, NAME_LINE.replace('      - name:', '      # - name:')),
      'continue-on-error': YML.replace(RUN_LINE, `${RUN_LINE}        continue-on-error: true\n`),
      'if: false': YML.replace(NAME_LINE, `${NAME_LINE}        if: false\n`),
      '|| true': YML.replace(RUN_LINE, RUN_LINE.replace(/\n$/, ' || true\n')),
      'tag mode instead of --all': YML.replace(RUN_LINE, '        run: node scripts/released-schema-guard.mjs "${GITHUB_REF_NAME}"\n'),
      renamed: YML.replace(NAME_LINE, '      - name: Released-schema guard\n'),
      'moved into its own job': without.replace(
        '\n  build-macos-arm64:\n',
        `\n  all-tags:\n    runs-on: macos-14\n    steps:\n${step}\n  build-macos-arm64:\n`,
      ),
      'before the tag-mode guard': without.replace(`      - name: ${STEPS[1].name}\n`, `${step}\n      - name: ${STEPS[1].name}\n`),
    };
    for (const [label, text] of Object.entries(planted)) expect(text, `${label}: the plant did not apply`).not.toBe(YML);
    const survivors = Object.entries(planted)
      .filter(([, text]) => allTagsGuardProblems(text).length === 0)
      .map(([label]) => label);
    expect(survivors, 'plants the pin let through').toEqual([]);
  });
});
