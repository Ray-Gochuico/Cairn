import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBootError } from '@/db/boot-error-screen';
import { SchemaTooNewError } from '@/db/migrations';
import { DatabaseCorruptError } from '@/db/integrity';

describe('renderBootError', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('renders the "update Cairn" screen for SchemaTooNewError', () => {
    renderBootError(root, new SchemaTooNewError(99, 46));
    expect(root.textContent).toMatch(/update cairn/i);
    expect(root.textContent).toMatch(/newer version of cairn/i);
    // No raw stack pane for this friendly screen.
    expect(root.querySelector('pre')).toBeNull();
  });

  it('renders the corruption recovery screen with a reveal-backups button', () => {
    renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
    expect(root.textContent).toMatch(/database may be corrupt/i);
    expect(root.textContent).toMatch(/backup/i);
    const btn = root.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toMatch(/reveal backups/i);
    // The raw quick_check detail is shown for diagnostics.
    expect(root.querySelector('pre')?.textContent).toMatch(/page 4 is never used/);
  });

  it('falls back to a message + stack pane for an unknown error', () => {
    const err = new Error('something else broke');
    renderBootError(root, err);
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.querySelector('pre')?.textContent).toMatch(/something else broke/);
    // Not the friendly screens.
    expect(root.textContent).not.toMatch(/may be corrupt/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
  });

  it('handles a non-Error thrown value without crashing', () => {
    renderBootError(root, 'a bare string failure');
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.querySelector('pre')?.textContent).toMatch(/a bare string failure/);
  });

  it('replaces prior content on each call (no accumulation)', () => {
    renderBootError(root, new SchemaTooNewError(99, 46));
    renderBootError(root, new Error('second'));
    // Only the most recent screen remains.
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
  });

  describe('platform-aware reveal label (distribution plan A3)', () => {
    afterEach(() => {
      // tests/setup.ts restores mocks but NOT stubbed globals.
      vi.unstubAllGlobals();
    });

    it('labels the reveal button for Finder on macOS (default jsdom UA)', () => {
      renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
      expect(root.querySelector('button')?.textContent).toBe(
        'Reveal backups in Finder',
      );
    });

    it('labels the reveal button for File Explorer on Windows (WebView2 UA)', () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      });
      renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
      expect(root.querySelector('button')?.textContent).toBe(
        'Reveal backups in File Explorer',
      );
    });
  });
});
