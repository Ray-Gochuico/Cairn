// v1.7.1 U4 — macOS updater honesty (CR-U4-1..4). The install flow reuses the
// Update from the one manual check, downloads it, closes the live database,
// installs, and ends on an honest "quit and reopen" line: tauri-plugin-updater
// 2.10.1 swaps the bundle on macOS and returns without relaunching, and Cairn
// has no process plugin. The manual-only pins and the single-importer guard
// live in tests/components/UpdaterSection.test.tsx and stay unedited.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.7.0') }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock('@/lib/backup-restore', () => ({ closeLiveDatabase: vi.fn() }));

import { check } from '@tauri-apps/plugin-updater';
import { closeLiveDatabase } from '@/lib/backup-restore';
import { UpdaterSection } from '@/components/settings/UpdaterSection';

const mockCheck = check as unknown as ReturnType<typeof vi.fn>;
const mockClose = closeLiveDatabase as unknown as ReturnType<typeof vi.fn>;

const INSTALLED = 'Update installed. Quit and reopen Cairn to finish.';
const FAILURE_KEY = 'updater.installFailure';
const INSTALLED_KEY = 'updater.installed';

type Hooks = { download?: () => Promise<void>; install?: () => Promise<void> };

/** A stand-in for the plugin's Update resource; every step appends to `log`. */
function fakeUpdate(log: string[], hooks: Hooks = {}) {
  return {
    version: '1.7.1',
    body: 'Fixes.',
    download: vi.fn(async () => {
      log.push('download');
      await hooks.download?.();
    }),
    install: vi.fn(async () => {
      log.push('install');
      await hooks.install?.();
    }),
    downloadAndInstall: vi.fn(async () => {
      log.push('downloadAndInstall');
    }),
  };
}

async function reachAvailable(update: ReturnType<typeof fakeUpdate>, reload = vi.fn()) {
  mockCheck.mockResolvedValue(update);
  const user = userEvent.setup();
  const view = render(<UpdaterSection reload={reload} />);
  await user.click(await screen.findByRole('button', { name: /check for updates/i }));
  const install = await screen.findByRole('button', { name: 'Install update' });
  return { user, install, reload, view };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('UpdaterSection — install (v1.7.1 U4)', () => {
  it('Install reuses the Update from the first check: one check() in all, one download(), one install(), never downloadAndInstall (CR-U4-3, Low-2)', async () => {
    const update = fakeUpdate([]);
    const { user, install } = await reachAvailable(update);
    await user.click(install);
    await screen.findByText(INSTALLED);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('runs download → close the live database → install, in that order, and does not reload on success (CR-U4-3)', async () => {
    const log: string[] = [];
    mockClose.mockImplementation(async () => {
      log.push('close');
    });
    const { user, install, reload } = await reachAvailable(fakeUpdate(log));
    await user.click(install);
    await screen.findByText(INSTALLED);
    expect(log).toEqual(['download', 'close', 'install']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('while it works, the card promises no restart', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    const { user, install } = await reachAvailable(fakeUpdate([], { download: () => pending }));
    await user.click(install);
    try {
      expect(screen.getByRole('status').textContent).toBe('Downloading and installing…');
    } finally {
      finish(); // never leave an install in flight for the next test
    }
    await screen.findByText(INSTALLED);
  });

  it('ends on the honest line (CR-U4-1 ⚑), and Check for updates waits for the reopen', async () => {
    const { user, install } = await reachAvailable(fakeUpdate([]));
    await user.click(install);
    await screen.findByText(INSTALLED);
    expect(screen.getByRole('status').textContent).toBe(INSTALLED);
    expect(screen.queryByText(/restart/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();
  });

  it('a finished install holds for the session: a remount still says quit and reopen, and Check still waits', async () => {
    const { user, install, view } = await reachAvailable(fakeUpdate([]));
    await user.click(install);
    await screen.findByText(INSTALLED);
    expect(sessionStorage.getItem(INSTALLED_KEY)).toBe('1.7.1');
    view.unmount();
    render(<UpdaterSection reload={vi.fn()} />);
    await screen.findByText('1.7.0'); // let the version read settle (the self-clear runs after it)
    expect(screen.getByRole('status').textContent).toBe(INSTALLED);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();
    expect(mockCheck).toHaveBeenCalledTimes(1); // the remount checks nothing (manual-only)
  });

  it('a remount while the install runs still shows it, offers no second install, and lands on the end line', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    const update = fakeUpdate([], { download: () => pending });
    const { user, install, view } = await reachAvailable(update);
    await user.click(install);
    view.unmount(); // Settings unmounts its sections on every route change
    render(<UpdaterSection reload={vi.fn()} />);
    try {
      await screen.findByText('1.7.0'); // let the version read settle
      expect(screen.getByRole('status').textContent).toBe('Downloading and installing…');
      expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    } finally {
      finish();
    }
    await screen.findByText(INSTALLED);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it('the note clears itself once the installed version is the one running (the reopen happened)', async () => {
    sessionStorage.setItem(INSTALLED_KEY, '1.7.0'); // getVersion() reads 1.7.0 in this file
    render(<UpdaterSection reload={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled(),
    );
    expect(screen.queryByText(INSTALLED)).toBeNull();
    expect(sessionStorage.getItem(INSTALLED_KEY)).toBeNull();
  });

  it('a failed download changes nothing: no close, no install, no reload — and the alert says so', async () => {
    const update = fakeUpdate([], {
      download: async () => {
        throw 'Download request failed with status: 404 Not Found';
      },
    });
    const { user, install, reload } = await reachAvailable(update);
    await user.click(install);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't install the update: Download request failed with status: 404 Not Found. Your data was not changed.",
    );
    expect(mockClose).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(FAILURE_KEY)).toBeNull(); // nothing to show after a reload
  });

  it('a failed close stops before the install and never reloads (the pool was not closed)', async () => {
    mockClose.mockRejectedValue(new Error('database sqlite:finance.db not loaded'));
    const update = fakeUpdate([]);
    const { user, install, reload } = await reachAvailable(update);
    await user.click(install);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't install the update: database sqlite:finance.db not loaded. Your data was not changed.",
    );
    expect(update.install).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(FAILURE_KEY)).toBeNull(); // nothing to show after a reload
  });

  it('an install that fails AFTER the close stashes the reason, then reloads (M-4: never stay on a closed pool)', async () => {
    const log: string[] = [];
    mockClose.mockImplementation(async () => {
      log.push('close');
    });
    let stashedAtReload: string | null = null;
    const reload = vi.fn(() => {
      stashedAtReload = sessionStorage.getItem(FAILURE_KEY);
    });
    const update = fakeUpdate(log, {
      install: async () => {
        throw 'Failed to move the new app into place.';
      },
    });
    const { user, install } = await reachAvailable(update, reload);
    await user.click(install);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(log).toEqual(['download', 'close', 'install']);
    expect(stashedAtReload).toBe('Failed to move the new app into place.');
    expect(sessionStorage.getItem(INSTALLED_KEY)).toBeNull();
  });

  it('after that reload the stashed reason renders once, as the install alert, scrolled into view', async () => {
    sessionStorage.setItem(FAILURE_KEY, 'Failed to move the new app into place.');
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true });
    const first = render(<UpdaterSection reload={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't install the update: Failed to move the new app into place. Your data was not changed.",
    );
    expect(sessionStorage.getItem(FAILURE_KEY)).toBeNull();
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(alert);
    first.unmount();
    render(<UpdaterSection reload={vi.fn()} />);
    await screen.findByRole('button', { name: /check for updates/i });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('lands on the card after a failed install: the landing mount shows the stashed reason once, scrolled into view (CR-U4-6)', async () => {
    mockClose.mockResolvedValue(undefined);
    const land = vi.fn();
    const update = fakeUpdate([], {
      install: async () => {
        throw 'Failed to move the new app into place.';
      },
    });
    const { user, install, view } = await reachAvailable(update, land);
    await user.click(install);
    await waitFor(() => expect(land).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0)); // the flow settles; in the app the page goes with it
    view.unmount();
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true });
    render(<UpdaterSection reload={vi.fn()} />); // Settings mounts the card on the landing
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't install the update: Failed to move the new app into place. Your data was not changed.",
    );
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(alert);
    expect(sessionStorage.getItem(FAILURE_KEY)).toBeNull();
  });

  it('in the app a failed install lands on the Updates card: Settings renders the card with no props, and the default is a full load of /settings, so boot re-runs (M-4, CR-U4-6)', () => {
    const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
    // No #updates fragment: from /settings a fragment-only change is not a
    // load, and the window would stay on the closed pool.
    expect(read('src/components/settings/UpdaterSection.tsx')).toContain(
      "  reload = () => window.location.assign('/settings'),\n",
    );
    // The card lives on that route, under the section anchor #updates.
    expect(read('src/App.tsx')).toContain("{ path: 'settings', element: lazyRoute(Settings) },");
    expect(read('src/pages/Settings.tsx')).toContain(
      "{ id: 'updates', label: 'Updates', Component: UpdaterSection },",
    );
  });

  it('the available panel says the data stays where it is, in the README’s words', async () => {
    await reachAvailable(fakeUpdate([]));
    expect(
      screen.getByText(
        'Your data stays where it is. If this version changes how data is stored, Cairn first keeps a copy, listed under Settings → Data as "Before update".',
      ),
    ).toBeInTheDocument();
  });

  it('a failed CHECK keeps its own line (never the install line)', async () => {
    mockCheck.mockRejectedValue(new Error('network unreachable'));
    const user = userEvent.setup();
    render(<UpdaterSection reload={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /check for updates/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't check for updates: network unreachable");
  });
});
