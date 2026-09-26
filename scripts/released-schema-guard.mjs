// v1.7.1 U3 — the released-schema guard. release.yml's test gate runs it on the
// tag being released, before anything builds; it runs the same way locally
// (git only, no network):
//
//   node scripts/released-schema-guard.mjs v1.7.1   # CI passes "${GITHUB_REF_NAME}"
//   node scripts/released-schema-guard.mjs --all    # every release tag (the CR-U3-3 receipt)
//
// It resolves the PREVIOUS release tag (the highest vX.Y.Z below the given
// one), reads MAX_SCHEMA_VERSION from BOTH pins at that tag
// (`git show "<tag>:src/db/migrations.ts"` and `…:src-tauri/src/db_backup.rs`),
// and exits 1 unless both equal that tag's row in tests/db/released-schemas.ts,
// so the upgrade harness (tests/db/upgrade-path.test.ts) always starts from
// every schema that has really shipped. The ref is passed as ONE argv entry
// (execFileSync, no shell), so zsh's `$t:path` modifier trap cannot bite.
//
// Pure functions + a thin CLI, so tests/scripts/released-schema-guard.test.ts
// tests the rules without git. Zero dependencies; Node 20 (no TypeScript, no
// import.meta.main).

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RELEASED_SCHEMAS_PATH = 'tests/db/released-schemas.ts';
const JS_PIN_PATH = 'src/db/migrations.ts';
const RUST_PIN_PATH = 'src-tauri/src/db_backup.rs';
const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** [major, minor, patch] for a final release tag (`v1.7.0`), else null. */
export function parseReleaseTag(tag) {
  const m = RELEASE_TAG_RE.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The highest release tag strictly below `current` (numeric, so v1.10.0 > v1.9.0), or null. */
export function previousReleaseTag(tags, current) {
  const cur = parseReleaseTag(current);
  if (!cur) throw new Error(`not a release tag: ${current} (expected vX.Y.Z)`);
  let best = null;
  for (const tag of tags) {
    const v = parseReleaseTag(tag);
    if (!v || compareVersions(v, cur) >= 0) continue;
    if (!best || compareVersions(v, best.v) > 0) best = { tag, v };
  }
  return best ? best.tag : null;
}

/** Release tags in version order. */
export function sortReleaseTags(tags) {
  return tags.filter((t) => parseReleaseTag(t)).sort((a, b) => compareVersions(parseReleaseTag(a), parseReleaseTag(b)));
}

export function parseJsPin(text) {
  const m = /^export const MAX_SCHEMA_VERSION = (\d+);$/m.exec(text);
  return m ? Number(m[1]) : null;
}

export function parseRustPin(text) {
  const m = /^pub const MAX_SCHEMA_VERSION: i64 = (\d+);$/m.exec(text);
  return m ? Number(m[1]) : null;
}

/** tests/db/released-schemas.ts rows: exactly `  'vX.Y.Z': N,` per line. */
export function parseReleasedSchemas(text) {
  const out = {};
  for (const m of text.matchAll(/^ {2}'(v\d+\.\d+\.\d+)': (\d+),$/gm)) out[m[1]] = Number(m[2]);
  return out;
}

/** One tag's verdict: both pins found, equal, and equal to the recorded row. */
export function checkTag({ tag, js, rust, recorded }) {
  if (js === null) return { ok: false, message: `${tag}: MAX_SCHEMA_VERSION not found in ${JS_PIN_PATH} at that tag.` };
  if (rust === null) return { ok: false, message: `${tag}: MAX_SCHEMA_VERSION not found in ${RUST_PIN_PATH} at that tag.` };
  if (js !== rust) return { ok: false, message: `${tag}: the two pins disagree at that tag (${JS_PIN_PATH} ${js}, ${RUST_PIN_PATH} ${rust}).` };
  if (recorded === undefined) return { ok: false, message: `${tag}: no row in ${RELEASED_SCHEMAS_PATH}. Add '${tag}': ${js}, to it.` };
  if (recorded !== js) return { ok: false, message: `${tag}: ${RELEASED_SCHEMAS_PATH} records ${recorded}; the tag shipped ${js}.` };
  return { ok: true, message: `${tag}: ${JS_PIN_PATH} ${js}, ${RUST_PIN_PATH} ${rust}, ${RELEASED_SCHEMAS_PATH} ${recorded}.` };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pinsAt(tag) {
  const read = (p) => {
    try { return git(['show', `${tag}:${p}`]); } catch { return ''; }
  };
  return { js: parseJsPin(read(JS_PIN_PATH)), rust: parseRustPin(read(RUST_PIN_PATH)) };
}

export function main(argv) {
  const arg = argv[0];
  if (!arg) {
    console.error('usage: node scripts/released-schema-guard.mjs <vX.Y.Z being released> | --all');
    return 2;
  }
  let recordedText;
  try { recordedText = readFileSync(RELEASED_SCHEMAS_PATH, 'utf8'); } catch {
    console.error(`cannot read ${RELEASED_SCHEMAS_PATH} (run from the repository root).`);
    return 2;
  }
  const recordedMap = parseReleasedSchemas(recordedText);
  const tags = sortReleaseTags(git(['tag', '-l', 'v*']).split('\n').map((t) => t.trim()).filter(Boolean));
  let targets;
  if (arg === '--all') {
    targets = tags;
    const untagged = Object.keys(recordedMap).filter((t) => !tags.includes(t));
    if (untagged.length > 0) {
      console.error(`${RELEASED_SCHEMAS_PATH} has rows for tags that do not exist: ${untagged.join(', ')}.`);
      return 1;
    }
  } else {
    let previous;
    try { previous = previousReleaseTag(tags, arg); } catch (e) { console.error(e.message); return 2; }
    if (!previous) {
      console.error(`no release tag below ${arg} (fetch the tags: the checkout needs fetch-depth: 0).`);
      return 1;
    }
    console.log(`previous release of ${arg}: ${previous}`);
    targets = [previous];
  }
  let ok = true;
  for (const tag of targets) {
    const verdict = checkTag({ tag, ...pinsAt(tag), recorded: recordedMap[tag] });
    (verdict.ok ? console.log : console.error)(verdict.message);
    ok &&= verdict.ok;
  }
  return ok ? 0 : 1;
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) process.exit(main(process.argv.slice(2)));
