import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Regression-policy console.error spy.
 *
 * Wave-3 UX W3-1: the AppDisclaimerGate emitted 96 "DialogContent
 * requires a DialogTitle" Radix dev warnings on app boot because the
 * old hand-rolled primitive composition didn't register its Title with
 * Radix's accessibility-check context. The shadcn Dialog wrapper fix
 * landed (a9ca333) but nothing in the test suite would catch a future
 * regression — vitest doesn't fail on console.error by default.
 *
 * This spy fails any test that prints the specific Radix warning, while
 * letting through other expected console.error calls (act warnings,
 * jsdom navigation noise, etc.). Restoring the original implementation
 * after each test keeps individual tests free to assert their own
 * console.error contracts if needed.
 *
 * If a new test legitimately needs to trigger the message (e.g. a
 * negative case asserting the warning fires), it can locally
 * `vi.spyOn(console, 'error').mockImplementation(() => {})` before
 * rendering — that takes precedence over this setup-level spy.
 */
const FORBIDDEN_CONSOLE_ERROR_SUBSTRINGS = [
  'DialogContent` requires a `DialogTitle`',
  'DialogContent requires a DialogTitle',
  // Wave-5 UX W5-8: Radix logs `Missing Description or aria-describedby={undefined}
  // for {DialogContent}` whenever DialogContent renders without either a wired
  // <DialogDescription> or an explicit aria-describedby. The shadcn wrapper now
  // defaults that prop to undefined so consumers opt in; this guard catches any
  // future regression that removes the default.
  'Missing `Description` or `aria-describedby={undefined}`',
  'Missing Description',
];

let originalConsoleError: typeof console.error | null = null;

beforeEach(() => {
  originalConsoleError = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = args[0];
    const message = typeof first === 'string' ? first : '';
    for (const forbidden of FORBIDDEN_CONSOLE_ERROR_SUBSTRINGS) {
      if (message.includes(forbidden)) {
        throw new Error(
          `Forbidden console.error fired (caught by tests/setup.ts policy):\n${message}`,
        );
      }
    }
    originalConsoleError?.(...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Node 25 ships an experimental built-in `localStorage` global as an empty
// stub object that shadows jsdom's Storage. Install a real in-memory Storage
// before each test so any code that touches `localStorage` sees a
// Web-API-compatible object. (jsdom's sessionStorage is unaffected.)
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
}

// Radix UI uses pointer-capture and scrollIntoView APIs that jsdom does not
// implement. These no-op shims are the missing piece that caused the Wave 0c
// Radix select migration to be deferred. They are purely additive and cannot
// affect existing tests — all three are guarded so they never overwrite a
// real implementation should jsdom eventually ship them.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (): boolean => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = (): void => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (): void => {};
}

// Radix Checkbox/RadioGroup indicators reach @radix-ui/react-use-size, which
// constructs a ResizeObserver. jsdom does not implement it. This guarded no-op
// is purely additive and never overwrites a real implementation, mirroring the
// hasPointerCapture/releasePointerCapture/scrollIntoView shims added for the
// Radix Select migration above.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // @ts-expect-error – assigning a minimal stub to the global for jsdom tests
  globalThis.ResizeObserver = ResizeObserverStub;
}

beforeEach(() => {
  const fresh = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fresh,
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: fresh,
      writable: true,
      configurable: true,
    });
  }
});
