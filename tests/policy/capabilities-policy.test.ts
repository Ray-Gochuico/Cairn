import { readFileSync } from 'node:fs';
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
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..');
const CAP_PATH = path.join(ROOT, 'src-tauri', 'capabilities', 'default.json');

interface ObjectPermission {
  identifier: string;
  allow?: Array<{ path?: string; url?: string }>;
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

function fsPermissions(): Array<{ identifier: string; paths: string[] }> {
  return capability.permissions
    .map((p) => (typeof p === 'string' ? { identifier: p } : p))
    .filter((p) => p.identifier.startsWith('fs:'))
    .map((p) => ({
      identifier: p.identifier,
      paths: ('allow' in p ? (p.allow ?? []) : [])
        .map((a) => a.path ?? '')
        .filter(Boolean)
        .sort(),
    }));
}

describe('tauri capabilities policy (fs scope ratchet)', () => {
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
