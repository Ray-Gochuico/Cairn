import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Wave-6 ratchet: Tauri fs capability scopes can only NARROW.
//
// The webview's fs surface is the app's blast radius if the renderer is ever
// compromised. Wave 5 narrowed remove/mkdir to $APPCONFIG; wave 6 deleted the
// caller-less fs:allow-read-file ($HOME/**/* READ with zero readFile/
// readTextFile/readBinaryFile callers in src/). This test freezes the
// remaining scopes: adding an fs grant or broadening a path fails here until
// the allowlist is deliberately extended IN THE SAME PR with a justification
// comment. Narrowing is always welcome — shrink the frozen entry with it.
// (Design mirrors the other tests/policy ratchets: frozen allowlist + exact
// comparison + a screaming error message.)
//
// Two hardenings from the wave-6 review (F2):
//   (a) Tauri auto-includes EVERY file in src-tauri/capabilities/ — a second
//       capability file would grant scopes this test never reads. The file
//       set itself is frozen below.
//   (b) Tauri accepts BOTH allow-entry shapes: `{ "path": "..." }` objects
//       AND bare strings ("$TMP/**"). The parser must surface every shape —
//       an unknown shape breaks the frozen-equality check (JSON.stringify
//       fallback) instead of being silently dropped. Self-tested below.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..');
const CAP_DIR = path.join(ROOT, 'src-tauri', 'capabilities');
const CAP_PATH = path.join(CAP_DIR, 'default.json');

// Frozen capability FILE SET: Tauri's build includes every JSON in this dir
// as an active capability, so adding a file is adding grants. Extending the
// app's capabilities must touch this ratchet in the same PR.
const FROZEN_CAPABILITY_FILES = ['default.json'];

interface ObjectPermission {
  identifier: string;
  allow?: Array<string | { path?: string; url?: string }>;
}
type Permission = string | ObjectPermission;

const capability = JSON.parse(readFileSync(CAP_PATH, 'utf8')) as {
  permissions: Permission[];
};

const APPCONFIG_ONLY = new Set(['$APPCONFIG', '$APPCONFIG/backups', '$APPCONFIG/backups/**']);

// identifier → exact allowed path set (sorted). 'fs:default' is a bare
// string grant (no scopes) — frozen as an empty list.
const FROZEN_FS_SCOPES: Record<string, string[]> = {
  'fs:default': [],
  'fs:allow-read-dir': ['$APPCONFIG/backups', '$APPCONFIG/backups/**', '$HOME/**/*'],
  'fs:allow-remove': ['$APPCONFIG/backups/**'],
  'fs:allow-write-file': ['$HOME/**/*'],
  'fs:allow-mkdir': ['$APPCONFIG', '$APPCONFIG/backups'],
};

/**
 * Normalize one allow entry to a comparable string. String entries pass
 * through; object entries surface `.path`; anything else stringifies so an
 * unrecognized shape FAILS the frozen-equality check rather than vanishing
 * (the F2(b) bypass: `.path ?? ''` + falsy filter dropped string scopes).
 */
function scopeOf(a: string | { path?: string; url?: string }): string {
  if (typeof a === 'string') return a;
  return a.path ?? JSON.stringify(a);
}

function parseFsPermissions(
  permissions: Permission[],
): Array<{ identifier: string; paths: string[] }> {
  return permissions
    .map((p) => (typeof p === 'string' ? { identifier: p } : p))
    .filter((p) => p.identifier.startsWith('fs:'))
    .map((p) => ({
      identifier: p.identifier,
      paths: ('allow' in p ? (p.allow ?? []) : []).map(scopeOf).sort(),
    }));
}

const fsPermissions = () => parseFsPermissions(capability.permissions);

describe('tauri capabilities policy (fs scope ratchet)', () => {
  it('the capabilities dir contains exactly the frozen file set (Tauri auto-includes every file here)', () => {
    const files = readdirSync(CAP_DIR).sort();
    expect(
      files,
      `src-tauri/capabilities/ gained a file — every file here is an ACTIVE capability. ` +
        `Fold new grants into default.json (where this ratchet reads them) or extend the ratchet deliberately.`,
    ).toEqual([...FROZEN_CAPABILITY_FILES].sort());
  });

  it('the caller-less fs:allow-read-file grant stays deleted', () => {
    expect(fsPermissions().map((p) => p.identifier)).not.toContain('fs:allow-read-file');
  });

  it('destructive scopes (remove/mkdir) stay inside $APPCONFIG', () => {
    for (const p of fsPermissions()) {
      if (p.identifier !== 'fs:allow-remove' && p.identifier !== 'fs:allow-mkdir') continue;
      for (const scope of p.paths) {
        expect(
          APPCONFIG_ONLY.has(scope),
          `${p.identifier} scope "${scope}" escapes $APPCONFIG — narrow it or redesign`,
        ).toBe(true);
      }
    }
  });

  it('fs permissions + scopes exactly match the frozen allowlist (broadening fails; narrowing shrinks the list)', () => {
    const actual = Object.fromEntries(fsPermissions().map((p) => [p.identifier, p.paths]));
    const frozen = Object.fromEntries(
      Object.entries(FROZEN_FS_SCOPES).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(actual).toEqual(frozen);
  });
});

describe('ratchet self-test — the parser cannot silently drop scopes (F2b)', () => {
  it('surfaces object-form AND string-form allow entries', () => {
    const parsed = parseFsPermissions([
      { identifier: 'fs:allow-x', allow: [{ path: '$TMP/a' }, '$TMP/b'] },
    ]);
    expect(parsed).toEqual([{ identifier: 'fs:allow-x', paths: ['$TMP/a', '$TMP/b'] }]);
  });

  it('an unknown entry shape surfaces as JSON (breaks equality) instead of vanishing', () => {
    const parsed = parseFsPermissions([
      { identifier: 'fs:allow-x', allow: [{ url: 'https://example.com' }] },
    ]);
    expect(parsed[0].paths).toEqual(['{"url":"https://example.com"}']);
  });

  it('a bare string fs permission parses with an empty scope list', () => {
    expect(parseFsPermissions(['fs:default'])).toEqual([
      { identifier: 'fs:default', paths: [] },
    ]);
  });
});
