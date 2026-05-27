// Smoke test for the browser-shim of `@tauri-apps/api/core`.
//
// Wave-4 polish review found that backend last-mile work added the
// `@tauri-apps/plugin-updater` package, whose entry-point imports
// `Resource` from `@tauri-apps/api/core`. The browser shim previously only
// re-exported `invoke`, so under `npm run dev:browser` Vite's optimizeDeps
// step blew up trying to resolve `Resource` against the shim — the
// Settings lazy chunk caught the import error, ErrorBoundary fired, and
// browser-shim QA hit a dead end.
//
// This test pins the contract: the shim must export the same public names
// (`invoke`, `Resource`, `Channel`) that the real `@tauri-apps/api/core`
// surfaces, so an upstream plugin that lands and imports any of them
// can't silently break the dev-shim path again.

import { describe, it, expect } from 'vitest';
import { invoke, Resource, Channel } from '@/lib/browser-shims/api-core';

describe('browser-shims/api-core — public surface area', () => {
  it('exports invoke as a function', () => {
    expect(typeof invoke).toBe('function');
  });

  it('exports Resource as a constructible class with close()', () => {
    expect(typeof Resource).toBe('function');
    // Constructible without throwing — the upstream class takes an
    // optional rid; the shim shrugs and ignores it.
    const r = new Resource(123);
    expect(r).toBeInstanceOf(Resource);
    // close() must return a Promise so `await update.close()` doesn't
    // explode on the consumer side.
    expect(r.close()).toBeInstanceOf(Promise);
  });

  it('exports Channel as a constructible class with id + onmessage', () => {
    expect(typeof Channel).toBe('function');
    const c = new Channel<string>();
    expect(c).toBeInstanceOf(Channel);
    // The real Channel exposes a numeric `id` (callback id) — the shim
    // pins it to 0 so any consumer that reads it gets a stable value.
    expect(typeof c.id).toBe('number');
    expect(c.onmessage).toBeNull();
  });

  it('Resource subclasses work — Update extends Resource in the updater shim', async () => {
    // The updater shim's `Update` class subclasses Resource — confirm
    // the prototype chain holds so `instanceof Resource` checks elsewhere
    // (none today, but the pattern is upstream) don't surprise us.
    class FakeUpdate extends Resource {
      foo() {
        return 42;
      }
    }
    const u = new FakeUpdate(7);
    expect(u).toBeInstanceOf(Resource);
    expect(u.foo()).toBe(42);
    await expect(u.close()).resolves.toBeUndefined();
  });

  it('invoke rejects unknown commands with a clear browser-mode error', async () => {
    await expect(invoke('definitely-not-a-real-command')).rejects.toThrow(
      /not available in browser mode/i,
    );
  });
});
