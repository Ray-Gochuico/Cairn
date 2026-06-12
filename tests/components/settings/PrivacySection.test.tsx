// Wave-5 W5-Security #1 (FileVault advisory) — user-facing complement
// to the README Privacy section. Verifies the three guarantees the
// component surfaces are actually rendered:
//
//   1. The data path is shown (default placeholder before the bridge
//      resolves; real path after appDataDir() succeeds).
//   2. The "Show in Finder" button calls revealItemInDir with that
//      path, with a clipboard fallback when the opener throws.
//   3. The complete outbound-network list (Yahoo + manual updater).
//   4. The FileVault recommendation copy.
//
// These render assertions double as a "the section still mounts"
// regression guard if a future refactor breaks the appDataDir lookup.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/Users/raymond/Library/Application Support/com.raymondgochuico.cairn/'),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
}));

import { appDataDir } from '@tauri-apps/api/path';
import { revealItemInDir, openUrl } from '@tauri-apps/plugin-opener';
import { PrivacySection } from '@/components/settings/PrivacySection';

const mockAppDataDir = appDataDir as unknown as ReturnType<typeof vi.fn>;
const mockReveal = revealItemInDir as unknown as ReturnType<typeof vi.fn>;
const mockOpenUrl = openUrl as unknown as ReturnType<typeof vi.fn>;

describe('PrivacySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppDataDir.mockImplementation(
      async () => '/Users/raymond/Library/Application Support/com.raymondgochuico.cairn/',
    );
    mockReveal.mockImplementation(async () => undefined);
    mockOpenUrl.mockImplementation(async () => undefined);
  });

  it('renders the Privacy & data heading', () => {
    render(<PrivacySection />);
    expect(screen.getByText(/privacy.*data/i)).toBeInTheDocument();
  });

  it('renders the documented data path even before appDataDir resolves', () => {
    render(<PrivacySection />);
    // Default placeholder uses the documented relative path.
    expect(
      screen.getByText(/~\/Library\/Application Support\/com\.raymondgochuico\.cairn/),
    ).toBeInTheDocument();
  });

  it('upgrades the path to the resolved literal once appDataDir succeeds', async () => {
    render(<PrivacySection />);
    await waitFor(() => {
      expect(
        screen.getByText(
          '/Users/raymond/Library/Application Support/com.raymondgochuico.cairn/',
        ),
      ).toBeInTheDocument();
    });
  });

  it('keeps the default path when appDataDir throws (browser-shim path)', async () => {
    mockAppDataDir.mockRejectedValueOnce(new Error('not available in browser'));
    render(<PrivacySection />);
    // Wait for the effect to settle; the default path stays visible.
    await waitFor(() => {
      expect(
        screen.getByText(/~\/Library\/Application Support\/com\.raymondgochuico\.cairn/),
      ).toBeInTheDocument();
    });
  });

  it('renders the Show in Finder button', () => {
    render(<PrivacySection />);
    expect(
      screen.getByRole('button', { name: /show data folder in finder/i }),
    ).toBeInTheDocument();
  });

  it('calls revealItemInDir with the resolved path when Show in Finder is clicked', async () => {
    render(<PrivacySection />);
    // Wait for the path to upgrade so the click uses the real value.
    await waitFor(() => {
      expect(
        screen.getByText(
          '/Users/raymond/Library/Application Support/com.raymondgochuico.cairn/',
        ),
      ).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /show data folder in finder/i }));
    await waitFor(() => {
      expect(mockReveal).toHaveBeenCalledWith(
        '/Users/raymond/Library/Application Support/com.raymondgochuico.cairn/',
      );
    });
  });

  it('falls back to clipboard copy when revealItemInDir throws', async () => {
    // Override the default mock for this test — reject every call so the
    // catch branch runs deterministically.
    mockReveal.mockImplementation(async () => {
      throw new Error('opener not available');
    });
    const writeText = vi.fn(async () => undefined);
    // userEvent.setup() seeds its own clipboard stub on navigator that
    // overrides anything we install before render. Re-install after the
    // setup so the component's catch branch sees our writeText.
    render(<PrivacySection />);
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    });
    expect(globalThis.navigator.clipboard?.writeText).toBe(writeText);

    await user.click(
      screen.getByRole('button', { name: /show data folder in finder/i }),
    );

    await waitFor(() => {
      expect(mockReveal).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('com.raymondgochuico.cairn'),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/path copied to clipboard/i);
    });
  });

  it('lists both outbound network calls (Yahoo + manual updater)', () => {
    render(<PrivacySection />);
    expect(screen.getByText(/yahoo finance refresh/i)).toBeInTheDocument();
    expect(screen.getByText(/updater check/i)).toBeInTheDocument();
    // The "only fires when you click" language is the critical disclosure.
    expect(screen.getByText(/only fires when you click/i)).toBeInTheDocument();
  });

  it('explicitly disclaims analytics, telemetry, crash reporters, background sync', () => {
    render(<PrivacySection />);
    expect(
      screen.getByText(/no analytics.*no telemetry.*no crash reporters.*no background sync/i),
    ).toBeInTheDocument();
  });

  it('recommends FileVault for encryption at rest', () => {
    render(<PrivacySection />);
    // "FileVault" appears in several spots (heading body, the settings
    // breadcrumb, the trailing roadmap paragraph). Confirm at least one
    // and the System-Settings navigation hint specifically.
    const matches = screen.getAllByText(/filevault/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/system settings.*privacy.*security.*filevault/i),
    ).toBeInTheDocument();
  });

  it('exposes a "Learn more about FileVault" link that opens Apple docs', async () => {
    render(<PrivacySection />);
    const link = screen.getByRole('button', { name: /learn more about filevault/i });
    const user = userEvent.setup();
    await user.click(link);
    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(
        expect.stringContaining('support.apple.com'),
      );
    });
  });
});

describe('PrivacySection — Windows copy (distribution plan A3)', () => {
  // Real WebView2 UA shape — always contains "Windows NT".
  const WEBVIEW2_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
  const WIN_PATH = 'C:\\Users\\ray\\AppData\\Roaming\\com.raymondgochuico.cairn\\';

  beforeEach(() => {
    // Runs after the file-level beforeEach, overriding the mac defaults.
    vi.stubGlobal('navigator', { userAgent: WEBVIEW2_UA });
    mockAppDataDir.mockImplementation(async () => WIN_PATH);
  });

  afterEach(() => {
    // tests/setup.ts restores mocks but NOT stubbed globals.
    vi.unstubAllGlobals();
  });

  it('never flashes the ~/Library placeholder before appDataDir resolves', () => {
    // Keep appDataDir pending forever so we see the seeded placeholder.
    mockAppDataDir.mockImplementation(() => new Promise(() => {}));
    render(<PrivacySection />);
    expect(screen.queryByText(/~\/Library/)).toBeNull();
    expect(screen.getByText(/locating/i)).toBeInTheDocument();
  });

  it('upgrades to the resolved Windows path once appDataDir succeeds', async () => {
    render(<PrivacySection />);
    expect(await screen.findByText(WIN_PATH)).toBeInTheDocument();
  });

  it('says "this computer" / "File Explorer" — never Mac, Finder, or FileVault', async () => {
    render(<PrivacySection />);
    await screen.findByText(WIN_PATH);
    expect(screen.getByText(/on this computer inside a single/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /show data folder in file explorer/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/show in file explorer/i)).toBeInTheDocument();
    expect(screen.queryByText(/finder/i)).toBeNull();
    expect(screen.queryByText(/this mac/i)).toBeNull();
    expect(screen.queryByText(/macos/i)).toBeNull();
    expect(screen.queryByText(/filevault/i)).toBeNull();
  });

  it('recommends BitLocker / device encryption with the Windows settings path', async () => {
    render(<PrivacySection />);
    await screen.findByText(WIN_PATH);
    expect(screen.getByText(/windows file permissions restrict/i)).toBeInTheDocument();
    expect(screen.getByText(/bitlocker/i)).toBeInTheDocument();
    expect(
      screen.getByText(/settings.*privacy.*security.*device encryption/i),
    ).toBeInTheDocument();
  });

  it('"Learn more about device encryption" opens the Microsoft support page', async () => {
    render(<PrivacySection />);
    await screen.findByText(WIN_PATH);
    // fireEvent (not userEvent): navigator is stubbed to a bare object and
    // userEvent.setup() expects the full jsdom navigator for its clipboard
    // interception.
    fireEvent.click(
      screen.getByRole('button', { name: /learn more about device encryption/i }),
    );
    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(
        'https://support.microsoft.com/en-us/windows/turn-on-device-encryption-0c453637-bc88-5f74-5105-741561aae838',
      );
    });
  });

  it('the reveal action still calls revealItemInDir with the resolved path (copy-only change)', async () => {
    render(<PrivacySection />);
    await screen.findByText(WIN_PATH);
    fireEvent.click(
      screen.getByRole('button', { name: /show data folder in file explorer/i }),
    );
    await waitFor(() => {
      expect(mockReveal).toHaveBeenCalledWith(WIN_PATH);
    });
  });
});

describe('README — Privacy section snapshot', () => {
  it('keeps the canonical Privacy headings + "100% local" promise + path string', async () => {
    // Snapshot the literal copy so a stealth edit that softens the
    // guarantee (or drops the path block) fails the build.
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf-8');

    // Section heading present.
    expect(readme).toMatch(/^## Privacy$/m);
    // Three sub-headings present.
    expect(readme).toMatch(/^### Where your data lives$/m);
    expect(readme).toMatch(/^### What network calls happen$/m);
    expect(readme).toMatch(/^### Encryption at rest$/m);
    // The "100% local" guarantee verbatim.
    expect(readme).toMatch(
      /Your financial\s+data never leaves your device unless you explicitly export a CSV\./,
    );
    // The documented filesystem path verbatim.
    expect(readme).toContain(
      '~/Library/Application Support/com.raymondgochuico.cairn/finance.db',
    );
    // FileVault recommendation.
    expect(readme).toMatch(/FileVault/);
    // No telemetry / no analytics promise.
    expect(readme).toMatch(/no telemetry/i);
  });
});
