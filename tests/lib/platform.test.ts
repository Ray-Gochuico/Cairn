// Distribution plan A3 (F1): platform detection for COPY decisions only.
//
// `isWindows()` is a deliberate user-agent sniff — NOT a Tauri API probe —
// so it stays importable from boot-time paths (boot-error-screen.ts) and
// trivially passes the UpdaterSection guard test that bans new
// `@tauri-apps/plugin-updater` importers. WebView2's UA always contains
// "Windows NT"; macOS WKWebView's UA never contains "Windows"; the Tauri
// config sets no UA override. Misdetection risk only mislabels copy.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { isWindows } from '@/lib/platform';

// Real-world UA shapes for the two webviews Cairn ships in.
const WEBVIEW2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const WKWEBVIEW_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('isWindows', () => {
  afterEach(() => {
    // tests/setup.ts restores mocks but NOT stubbed globals — do it here so
    // the jsdom navigator survives for the rest of the suite.
    vi.unstubAllGlobals();
  });

  it('returns true for a WebView2 (Windows NT) user agent', () => {
    vi.stubGlobal('navigator', { userAgent: WEBVIEW2_UA });
    expect(isWindows()).toBe(true);
  });

  it('returns false for a macOS WKWebView user agent', () => {
    vi.stubGlobal('navigator', { userAgent: WKWEBVIEW_UA });
    expect(isWindows()).toBe(false);
  });

  it('returns false when navigator is undefined (non-browser context)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isWindows()).toBe(false);
  });

  it('matches "windows" case-insensitively (defensive against UA casing drift)', () => {
    vi.stubGlobal('navigator', { userAgent: 'CustomShell windows/11' });
    expect(isWindows()).toBe(true);
  });

  it('does NOT match the jsdom "win32" process.platform shape (no false positive on Windows dev machines running the test suite)', () => {
    // jsdom builds its default UA from process.platform — on a Windows dev
    // box that is "win32", which must not satisfy /windows/i.
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/24.0.0',
    });
    expect(isWindows()).toBe(false);
  });
});
