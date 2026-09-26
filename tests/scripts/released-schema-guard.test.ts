// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkTag,
  parseJsPin,
  parseReleasedSchemas,
  parseRustPin,
  previousReleaseTag,
  sortReleaseTags,
} from '../../scripts/released-schema-guard.mjs';

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'released-schema-guard.mjs');

describe('released-schema guard — the rules (v1.7.1 U3)', () => {
  it('the previous release is the highest vX.Y.Z strictly below the tag, compared numerically', () => {
    const tags = ['v1.9.0', 'v1.10.0', 'v1.7.0', 'v1.7.1', 'v1.8.0-rc.1', 'not-a-tag'];
    expect(previousReleaseTag(tags, 'v1.7.1')).toBe('v1.7.0');
    expect(previousReleaseTag(tags, 'v1.10.1')).toBe('v1.10.0');     // not v1.9.0 (a string sort would pick it)
    expect(previousReleaseTag(tags, 'v1.10.0')).toBe('v1.9.0');      // never the tag itself
    expect(previousReleaseTag(tags, 'v1.7.0')).toBeNull();
    expect(() => previousReleaseTag(tags, '1.7.1')).toThrow(/not a release tag/);
  });

  // Code review CR-U3-9: a non-final tag (an rc, a hotfix suffix) is never the
  // previous release, and never a release to check.
  it('skips non-final v* tags: never the previous release, never in the release order', () => {
    const tags = ['v1.7.0', 'v1.7.1-rc1', 'v1.8.0-rc1', 'v1.7.1-hotfix'];
    expect(previousReleaseTag(tags, 'v1.8.0')).toBe('v1.7.0');
    expect(sortReleaseTags(tags)).toEqual(['v1.7.0']);
  });

  it('reads each pin from its declaration line only (a doc comment that names the constant is not the pin)', () => {
    expect(parseJsPin('/** MAX_SCHEMA_VERSION = 99 in prose */\nexport const MAX_SCHEMA_VERSION = 55;\n')).toBe(55);
    expect(parseRustPin('/// MAX_SCHEMA_VERSION: i64 = 99\npub const MAX_SCHEMA_VERSION: i64 = 55;\n')).toBe(55);
    expect(parseJsPin('const MAX_SCHEMA_VERSION = 55;')).toBeNull();
    expect(parseRustPin('')).toBeNull();
  });

  it('parses exactly the released-schemas row format', () => {
    expect(parseReleasedSchemas("  'v1.0.0': 47,\n  'v1.7.0': 55,\n// 'v9.9.9': 99,\n")).toEqual({ 'v1.0.0': 47, 'v1.7.0': 55 });
  });

  it('a tag passes only when both pins agree AND equal its recorded row', () => {
    expect(checkTag({ tag: 'v1.7.0', js: 55, rust: 55, recorded: 55 }).ok).toBe(true);
    expect(checkTag({ tag: 'v1.7.0', js: 55, rust: 55, recorded: 53 })).toEqual({
      ok: false,
      message: 'v1.7.0: tests/db/released-schemas.ts records 53; the tag shipped 55.',
    });
    expect(checkTag({ tag: 'v1.7.0', js: 55, rust: 54, recorded: 55 }).message).toMatch(/the two pins disagree/);
    expect(checkTag({ tag: 'v1.7.0', js: 55, rust: 55, recorded: undefined }).message).toBe(
      "v1.7.0: no row in tests/db/released-schemas.ts. Add 'v1.7.0': 55, to it.",
    );
    expect(checkTag({ tag: 'v1.7.0', js: null, rust: 55, recorded: 55 }).ok).toBe(false);
    expect(checkTag({ tag: 'v1.7.0', js: 55, rust: null, recorded: 55 }).ok).toBe(false);
  });
});

/**
 * The CLI tests run git in throwaway repositories. A pre-commit hook in a git
 * WORKTREE exports absolute GIT_DIR and GIT_INDEX_FILE (pointing at the REAL
 * repository), and the house hook runs `vitest --changed`, which selects this
 * file at its first commit — so every git call here gets process.env MINUS
 * every GIT_* key, plus a hermetic config and identity, and never runs a hook
 * (v1.7.1 U3 plan review R-1). Read at call time, so the decoy `it` below can
 * plant GIT_* keys first.
 */
function hermeticEnv(): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return {
    ...inherited,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: tmpdir(),
    GIT_AUTHOR_NAME: 'u3',
    GIT_AUTHOR_EMAIL: 'u3@example.invalid',
    GIT_COMMITTER_NAME: 'u3',
    GIT_COMMITTER_EMAIL: 'u3@example.invalid',
  };
}

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...args], {
    cwd,
    env: hermeticEnv(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

/** Two tagged commits: v0.1.0 ships schema 3, v0.2.0 ships 4 (both pins). */
function buildFixtureRepo(repo: string): void {
  for (const d of ['src/db', 'src-tauri/src', 'tests/db']) mkdirSync(path.join(repo, d), { recursive: true });
  gitIn(repo, 'init', '-q');
  for (const [n, tag] of [[3, 'v0.1.0'], [4, 'v0.2.0']] as const) {
    writeFileSync(path.join(repo, 'src/db/migrations.ts'), `export const MAX_SCHEMA_VERSION = ${n};\n`);
    writeFileSync(path.join(repo, 'src-tauri/src/db_backup.rs'), `pub const MAX_SCHEMA_VERSION: i64 = ${n};\n`);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '--no-verify', '-m', tag);
    gitIn(repo, 'tag', tag);
  }
}

describe('released-schema guard — the CLI on a throwaway repository (hermetic: GIT_* scrubbed, its own git config, no hooks, no network)', () => {
  let repo: string;
  const recorded = (rows: string, at: string = repo) => writeFileSync(path.join(at, 'tests/db/released-schemas.ts'), rows);
  const guard = (arg: string, cwd: string = repo) =>
    spawnSync(process.execPath, [SCRIPT, arg], { cwd, env: hermeticEnv(), encoding: 'utf8' });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'cairn-guard-'));
    buildFixtureRepo(repo);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('exits 0 when the previous tag\'s two pins, and the release\'s own (the checked-out tree\'s), equal their recorded rows', () => {
    recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.3.0': 4,\n");
    const r = guard('v0.3.0');
    expect([r.status, r.stdout]).toEqual([
      0,
      'previous release of v0.3.0: v0.2.0\n' +
        'v0.2.0: src/db/migrations.ts 4, src-tauri/src/db_backup.rs 4, tests/db/released-schemas.ts 4.\n' +
        'v0.3.0: src/db/migrations.ts 4, src-tauri/src/db_backup.rs 4, tests/db/released-schemas.ts 4.\n',
    ]);
  });

  it('exits 1 and says why when the recorded row disagrees with the tag, or is missing', () => {
    recorded("  'v0.1.0': 3,\n  'v0.2.0': 3,\n  'v0.3.0': 4,\n");
    const wrong = guard('v0.3.0');
    expect([wrong.status, wrong.stderr]).toEqual([1, 'v0.2.0: tests/db/released-schemas.ts records 3; the tag shipped 4.\n']);
    recorded("  'v0.1.0': 3,\n  'v0.3.0': 4,\n");
    const missing = guard('v0.3.0');
    expect([missing.status, missing.stderr]).toEqual([1, "v0.2.0: no row in tests/db/released-schemas.ts. Add 'v0.2.0': 4, to it.\n"]);
  });

  it('--all checks every release tag, and refuses a row for a tag that does not exist', () => {
    recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n");
    expect(guard('--all').status).toBe(0);
    recorded("  'v0.1.0': 4,\n  'v0.2.0': 4,\n");
    expect(guard('--all')).toMatchObject({ status: 1, stderr: 'v0.1.0: tests/db/released-schemas.ts records 4; the tag shipped 3.\n' });
    recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.2.1': 4,\n");
    expect(guard('--all')).toMatchObject({ status: 1, stderr: 'tests/db/released-schemas.ts has rows for tags that do not exist: v0.2.1.\n' });
  });

  // Code review CR-U3-8e: the release commit adds its OWN row (D-U3-13), and the
  // gate refuses a release that forgot it or recorded the wrong schema, before
  // the tag builds, not one release later. CI checks the tree out at the tag,
  // so the tree's two pins are the tag's.
  it('exits 1 when the release being tagged has no row of its own, or a row that differs from its checked-out pins', () => {
    const js = path.join(repo, 'src/db/migrations.ts');
    const rs = path.join(repo, 'src-tauri/src/db_backup.rs');
    try {
      recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n");
      expect(guard('v0.3.0')).toMatchObject({ status: 1, stderr: "v0.3.0: no row in tests/db/released-schemas.ts. Add 'v0.3.0': 4, to it.\n" });
      recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.3.0': 3,\n");
      expect(guard('v0.3.0')).toMatchObject({ status: 1, stderr: 'v0.3.0: tests/db/released-schemas.ts records 3; the tag shipped 4.\n' });
      writeFileSync(js, 'export const MAX_SCHEMA_VERSION = 5;\n');   // the release bumps the schema…
      recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.3.0': 5,\n");
      expect(guard('v0.3.0')).toMatchObject({
        status: 1,
        stderr: 'v0.3.0: the two pins disagree at that tag (src/db/migrations.ts 5, src-tauri/src/db_backup.rs 4).\n',
      });
      writeFileSync(rs, 'pub const MAX_SCHEMA_VERSION: i64 = 5;\n'); // …in both pins, and records it
      expect(guard('v0.3.0')).toMatchObject({ status: 0, stderr: '' });
    } finally {
      writeFileSync(js, 'export const MAX_SCHEMA_VERSION = 4;\n');
      writeFileSync(rs, 'pub const MAX_SCHEMA_VERSION: i64 = 4;\n');
    }
  });

  // Code review CR-U3-9: the shallow-checkout failure (CX-U3-10) that
  // fetch-depth: 0 exists to prevent, at the CLI level.
  it('exits 1 with CX-U3-10 when no release tag lies below the one given (a depth-1 checkout has none)', () => {
    recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n");
    expect(guard('v0.1.0')).toMatchObject({
      status: 1,
      stdout: '',
      stderr: 'no release tag below v0.1.0 (fetch the tags: the checkout needs fetch-depth: 0).\n',
    });
  });

  it('an rc tag in the repository is skipped: the previous release is the last FINAL tag, and --all asks no row for the rc', () => {
    const rc = mkdtempSync(path.join(tmpdir(), 'cairn-guard-rc-'));
    try {
      buildFixtureRepo(rc);
      writeFileSync(path.join(rc, 'src/db/migrations.ts'), 'export const MAX_SCHEMA_VERSION = 9;\n');
      writeFileSync(path.join(rc, 'src-tauri/src/db_backup.rs'), 'pub const MAX_SCHEMA_VERSION: i64 = 9;\n');
      gitIn(rc, 'add', '-A');
      gitIn(rc, 'commit', '-q', '--no-verify', '-m', 'rc');
      gitIn(rc, 'tag', 'v0.2.1-rc1');                    // schema 9, no row: it must never be read
      recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.3.0': 9,\n", rc);
      expect(guard('v0.3.0', rc)).toMatchObject({
        status: 0,
        stdout:
          'previous release of v0.3.0: v0.2.0\n' +
          'v0.2.0: src/db/migrations.ts 4, src-tauri/src/db_backup.rs 4, tests/db/released-schemas.ts 4.\n' +
          'v0.3.0: src/db/migrations.ts 9, src-tauri/src/db_backup.rs 9, tests/db/released-schemas.ts 9.\n',
      });
      recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n", rc);
      expect(guard('--all', rc)).toMatchObject({ status: 0, stderr: '' });
    } finally {
      rmSync(rc, { recursive: true, force: true });
    }
  });

  it('exits 2 for a missing or malformed tag argument', () => {
    expect(guard('').status).toBe(2);
    expect(guard('0.3.0').status).toBe(2);
  });

  // Plan review R-1: the pin for the scrub. The parent env points git at a DECOY
  // repository, exactly as a worktree pre-commit hook points it at the real one.
  it('never writes to a repository the parent env points git at (GIT_DIR / GIT_INDEX_FILE, as a worktree pre-commit hook exports them)', () => {
    const decoy = mkdtempSync(path.join(tmpdir(), 'cairn-guard-decoy-'));
    const other = mkdtempSync(path.join(tmpdir(), 'cairn-guard-'));
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    try {
      gitIn(decoy, 'init', '-q');
      gitIn(decoy, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'decoy');
      const decoyState = () => [
        gitIn(decoy, 'rev-list', '--count', 'HEAD'),
        gitIn(decoy, 'tag', '-l'),
        gitIn(decoy, 'config', '--get', 'core.bare'),
        gitIn(decoy, 'status', '--porcelain'),
      ];
      const clean = decoyState();
      expect(clean).toEqual(['1\n', '', 'false\n', '']);
      process.env.GIT_DIR = path.join(decoy, '.git');
      process.env.GIT_INDEX_FILE = path.join(decoy, '.git', 'index');
      try {
        buildFixtureRepo(other);
        recorded("  'v0.1.0': 3,\n  'v0.2.0': 4,\n  'v0.3.0': 4,\n", other);
        expect(guard('v0.3.0', other).status).toBe(0);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
      expect(decoyState()).toEqual(clean);
    } finally {
      rmSync(decoy, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
