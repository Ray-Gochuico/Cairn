import { describe, it, expect, afterEach, vi } from 'vitest';
import { isWindows } from '@/lib/platform';

// `isWindows()` is a pure user-agent sniff (no @tauri-apps/plugin-os, which
// isn't installed). It exists so cross-platform copy in the Settings + boot
// surfaces can branch on the host OS. The WebView2 UA on Windows always
// contains "Windows NT"; macOS WKWebView never does. A wrong answer only
// mislabels copy — there is no UA override in our Tauri config — so the
// sniff is intentionally tiny and forgiving.

describe('isWindows', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true for a Windows (WebView2) user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    });
    expect(isWindows()).toBe(true);
  });

  it('is case-insensitive on the "windows" token', () => {
    vi.stubGlobal('navigator', { userAgent: 'something WINDOWS something' });
    expect(isWindows()).toBe(true);
  });

  it('is false for a macOS (WKWebView) user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    expect(isWindows()).toBe(false);
  });

  it('is false when navigator is undefined (SSR / non-DOM guard)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isWindows()).toBe(false);
  });
});
