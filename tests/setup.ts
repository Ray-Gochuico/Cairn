import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

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
