import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../policy/source-walker';

/**
 * W4 review (MINOR 17): the browser shim's 250 ms debounced persist survived
 * `close()`. When the timer fired after `db.close()` had unlinked the sql.js
 * FS file, `db.export()` threw Emscripten's ErrnoError 44 (ENOENT) inside the
 * timer callback — an uncaught `pageerror` that the e2e console guard counts
 * as a failure. W4's explore transitions are the first paths that close the
 * shim DB and then keep the document alive across an async IndexedDB op, so
 * `onboarding-explore.spec.ts` "exit" went flaky (failed attempt 1, passed on
 * retry; every functional assertion held).
 *
 * The shim cannot be instantiated under vitest (it needs the sql.js wasm and a
 * real IndexedDB), so this pins the fix structurally — the same shape as
 * tests/db/main-boot-explore-guards.test.ts. Both mutants (dropping the cancel
 * from close(), or dropping the self-clear inside the timer) fail here.
 */
const SRC = stripComments(
  readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'src', 'lib', 'browser-shims', 'plugin-sql.ts'),
    'utf8',
  ),
);

describe('browser-shim plugin-sql — no persist after close', () => {
  it('close() cancels the pending debounced persist before exporting', () => {
    expect(SRC).toMatch(
      /async close\(\): Promise<void> \{\s*cancelScheduledPersist\(\);\s*await persist\(/,
    );
  });

  it('the canceller clears the module-global timer handle', () => {
    expect(SRC).toMatch(
      /function cancelScheduledPersist\(\): void \{\s*if \(persistTimer\) \{\s*clearTimeout\(persistTimer\);\s*persistTimer = null;/,
    );
  });

  it('the timer releases its own handle when it fires', () => {
    // Otherwise a fired-but-not-cleared handle makes close()'s cancel a no-op
    // lie: clearTimeout on a stale id, with the export still queued.
    expect(SRC).toMatch(/persistTimer = setTimeout\(\(\) => \{\s*persistTimer = null;/);
  });

  it('schedulePersist routes through the same canceller (one timer, one owner)', () => {
    expect(SRC).toMatch(
      /function schedulePersist\([^)]*\): void \{\s*cancelScheduledPersist\(\);/,
    );
    expect(SRC.match(/clearTimeout\(/g)).toHaveLength(1);
  });
});
