// Regression guard for the manual-only updater UI.
//
// Wave-3 backend review found the Rust updater plugin registered but
// JS-side `check()` never called. This component closes that gap —
// BUT the user explicitly directed: "Updater is MANUAL-ONLY in
// Settings. App never auto-polls." So the test must verify:
//   1. The component renders without firing `check()`.
//   2. `check()` only fires after a user click.
//   3. No other module in `src/` imports `@tauri-apps/plugin-updater`
//      (the architectural invariant that prevents an "innocent"
//      future patch from re-introducing auto-polling).
//   4. Up-to-date / available / error UI states render correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { glob } from 'node:fs/promises';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '1.0.0'),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
}));

import { check } from '@tauri-apps/plugin-updater';
import { openUrl } from '@tauri-apps/plugin-opener';
import { UpdaterSection } from '@/components/settings/UpdaterSection';

const mockCheck = check as unknown as ReturnType<typeof vi.fn>;
const mockOpenUrl = openUrl as unknown as ReturnType<typeof vi.fn>;

describe('UpdaterSection — manual-only invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does NOT fire check() on mount (manual-only — no auto-poll)', async () => {
    render(<UpdaterSection />);
    // Wait a tick to let any effects flush.
    await waitFor(() => {
      expect(screen.getByText(/check for updates/i)).toBeInTheDocument();
    });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('renders the manual-only copy explicitly so a casual reader sees the policy', () => {
    render(<UpdaterSection />);
    expect(
      screen.getByText(/only checks for updates when you click/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no automatic background checks/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never leaves your device/i)).toBeInTheDocument();
  });

  it('fires check() exactly once per click and shows "up to date"', async () => {
    mockCheck.mockResolvedValueOnce(null);
    render(<UpdaterSection />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /check for updates/i });
    await user.click(button);
    await waitFor(() => {
      expect(screen.getByText(/you're up to date/i)).toBeInTheDocument();
    });
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('shows "Version X available" + Install button when an update is found', async () => {
    mockCheck.mockResolvedValue({
      version: '0.2.0',
      body: 'Bug fixes.',
      downloadAndInstall: vi.fn(async () => undefined),
    });
    render(<UpdaterSection />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /check for updates/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/version.*0\.2\.0.*available/i);
      expect(
        screen.getByRole('button', { name: /install update/i }),
      ).toBeInTheDocument();
    });
  });

  it('persists lastChecked timestamp to localStorage after a check', async () => {
    mockCheck.mockResolvedValueOnce(null);
    render(<UpdaterSection />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /check for updates/i }));
    await waitFor(() => {
      expect(localStorage.getItem('updater.lastChecked')).not.toBeNull();
    });
    const iso = localStorage.getItem('updater.lastChecked');
    // Must parse as a real ISO 8601 timestamp.
    expect(iso).not.toBeNull();
    expect(Number.isNaN(new Date(iso!).getTime())).toBe(false);
  });

  it('reads lastChecked from localStorage on mount (persists across reloads)', async () => {
    const prior = '2026-05-26T10:00:00.000Z';
    localStorage.setItem('updater.lastChecked', prior);
    render(<UpdaterSection />);
    // The exact formatted string is locale-dependent, but the
    // human-readable form must NOT contain "never".
    await waitFor(() => {
      const lastCheckedRow = screen.getByText(/last checked/i).nextElementSibling;
      expect(lastCheckedRow?.textContent ?? '').not.toMatch(/never/i);
    });
  });

  it('renders an error message if check() rejects (does not crash the app)', async () => {
    mockCheck.mockRejectedValueOnce(new Error('network unreachable'));
    render(<UpdaterSection />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /check for updates/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network unreachable/i);
    });
  });

  it('"View all releases" link opens the GitHub releases page via openUrl', async () => {
    render(<UpdaterSection />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /view all releases/i }));
    expect(mockOpenUrl).toHaveBeenCalledWith(
      'https://github.com/Ray-Gochuico/Cairn/releases',
    );
  });
});

describe('UpdaterSection — architectural invariant (no other module imports plugin-updater)', () => {
  it('only UpdaterSection.tsx imports @tauri-apps/plugin-updater', async () => {
    // Walk every .ts/.tsx file under src/ and confirm only the
    // UpdaterSection imports the updater plugin. This is the guard
    // that catches a well-meaning future patch that wires `check()`
    // into a launch effect — the exact thing the user said NOT to do.
    //
    // `lib/browser-shims/plugin-updater.ts` is an allowed exception: it's
    // the dev-shim stand-in that resolves under `VITE_BROWSER_SHIM=1` so
    // the Settings page lazy chunk can load in a plain browser. The shim
    // never makes a network call (its `check()` resolves to `null`), so
    // it cannot reintroduce auto-polling — Vite swaps it in via the
    // `shimAliases` block in `vite.config.ts`.
    const projectRoot = resolve(__dirname, '../..');
    const srcRoot = resolve(projectRoot, 'src');
    const found: string[] = [];
    for await (const f of glob('**/*.{ts,tsx}', { cwd: srcRoot })) {
      const absPath = resolve(srcRoot, f);
      const contents = readFileSync(absPath, 'utf-8');
      if (/@tauri-apps\/plugin-updater/.test(contents)) {
        found.push(f);
      }
    }
    expect(found.sort()).toEqual(
      [
        'components/settings/UpdaterSection.tsx',
        'lib/browser-shims/plugin-updater.ts',
      ].sort(),
    );
  });
});
