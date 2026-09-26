import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isWindows } from '@/lib/platform';
import { isExploreMode, prefKey } from '@/lib/explore-mode';
import { closeLiveDatabase } from '@/lib/backup-restore';
import { withoutTrailingPeriod } from '@/lib/boot-notices';
import { scrollIntoViewWhenSettled } from '@/lib/scroll-into-view-settled';

/**
 * Settings → Updates section. **Manual-only** updater check — the app
 * never auto-polls on launch. The user must click "Check for updates"
 * to make any outbound network request. This honors the project's
 * "your data stays local" guarantee: the binary contains the updater
 * plugin (registered in Rust in `src-tauri/src/lib.rs`), but the
 * JS-side `check()` call only fires from this component.
 *
 * The Rust plugin verifies every downloaded artifact against the
 * minisign public key embedded in `tauri.conf.json`
 * (`plugins.updater.pubkey`), so a malicious latest.json payload can't
 * install a tampered binary.
 *
 * **Windows (distribution plan A3):** the published `latest.json` has no
 * `windows-x86_64` key yet, so `check()` is unreliable there — it may show
 * a false "up to date", a false error, or a phantom update. On Windows the
 * component never calls `check()`: the entire check UI is replaced with a
 * notice pointing at the Releases page (the "View all releases" link and
 * the locally-read current version stay). Remove this branch when Phase C
 * ships a `windows-x86_64` updater artifact.
 *
 * **macOS install (v1.7.1 U4).** Install reuses the `Update` resource from
 * the one manual check (no second manifest request — Low-2 of the 2026-06-02
 * distribution review), then: download + verify → close the live database
 * (`closeLiveDatabase`, the same close the Settings restore uses) → install.
 * tauri-plugin-updater 2.10.1 swaps the bundle on macOS and RETURNS — it does
 * not relaunch (only its Windows path exits), and Cairn ships no process
 * plugin (CR-U4-1) — so the flow ends on an honest "quit and reopen" line. A
 * failure before the close changes nothing and stays on the live pool; an
 * install that fails AFTER the close stashes its reason and reloads into
 * Settings (M-4: never stay on a closed pool; CR-U4-6: land on this card from
 * whatever page the user was on), and the card shows the reason there. Both
 * notes live in sessionStorage, which dies with the window.
 *
 * Local state machine:
 *   idle         → "Check for updates" button enabled, prior result hidden
 *   checking     → spinner, button disabled
 *   up-to-date   → "You're up to date" + last-checked timestamp
 *   available    → "Version X available" + the data line + "Install update"
 *   installing   → download, close, install; buttons disabled; a remount
 *                  while it runs still shows it (module scope)
 *   installed    → "Update installed. Quit and reopen Cairn to finish." —
 *                  held for the session; the check waits for the reopen
 *   error        → the check's or the install's own line (network blip, a
 *                  failed download, a refused install)
 */

type CheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; update: Update }
  | { phase: 'installing' }
  | { phase: 'installed' }
  | { phase: 'error'; kind: 'check' | 'install'; message: string };

const LAST_CHECKED_KEY = 'updater.lastChecked';
const RELEASES_URL = 'https://github.com/Ray-Gochuico/Cairn/releases';

function formatLastChecked(iso: string | null): string {
  if (iso === null) return 'never';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'never';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** v1.7.1 U4 — session notes (sessionStorage via prefKey): the install that
 * finished (its version) and the reason an install failed after the close. */
const INSTALLED_KEY = 'updater.installed';
const INSTALL_FAILURE_KEY = 'updater.installFailure';

function readSession(base: string): string | null {
  try {
    return sessionStorage.getItem(prefKey(base));
  } catch {
    return null;
  }
}

function writeSession(base: string, value: string): void {
  try {
    sessionStorage.setItem(prefKey(base), value);
  } catch {
    // Best-effort: storage refused — the reload still happens.
  }
}

function clearSession(base: string): void {
  try {
    sessionStorage.removeItem(prefKey(base));
  } catch {
    // Best-effort.
  }
}

function takeSession(base: string): string | null {
  const value = readSession(base);
  if (value !== null) clearSession(base);
  return value;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** v1.7.1 U4 (plan review) — the install in flight, held at module scope.
 * Settings unmounts its sections on every route change, so a card mounted
 * while the flow runs must still say so and must not offer a second install
 * (a second download, close and bundle swap). It lives exactly as long as the
 * page, like the flow itself: a reload drops both together, where a
 * sessionStorage marker would outlive the flow and hold the card on
 * "installing" with nothing left to finish it. */
let installInFlight: Promise<void> | null = null;

/** Where a fresh mount starts: the install in flight, then the session's
 * finished install, else idle. */
function restingState(): CheckState {
  if (installInFlight !== null) return { phase: 'installing' };
  return readSession(INSTALLED_KEY) !== null ? { phase: 'installed' } : { phase: 'idle' };
}

export function UpdaterSection({
  reload = () => window.location.assign('/settings'),
}: {
  /** Where the window goes after an install fails past the close: a full
   * load of Settings, so boot re-inits a pool (M-4) and this card mounts to
   * say why (CR-U4-6). No `#updates` fragment — from /settings a
   * fragment-only change is not a load, and the window would stay on the
   * closed pool. Injectable for tests. */
  reload?: () => void;
}) {
  // W4 review (MINOR 20): D-S7 — explore is offline. This was the one
  // remaining network-capable control under the sample banner, and its
  // last-checked stamp is a device-local key. Both are held to the real
  // profile: the check is disabled with a line saying why, and the stamp is
  // read/written through the explore namespace so nothing survives the exit.
  const exploring = isExploreMode();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  // An install in flight, or one that finished, outlives this mount: a
  // remount keeps saying so (restingState).
  const [state, setState] = useState<CheckState>(restingState);
  const [reopened, setReopened] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);

  // Load current version + lastChecked from local sources. No network call
  // here — both are local-only reads (Tauri's getVersion reads the bundled
  // package.json baked into the binary; lastChecked is in localStorage).
  useEffect(() => {
    void (async () => {
      try {
        const v = await getVersion();
        setCurrentVersion(v);
        // U4: the note names the version it installed. Once that version is
        // the one running, the reopen has happened — drop the line.
        if (readSession(INSTALLED_KEY) === v) {
          clearSession(INSTALLED_KEY);
          setState((s) => (s.phase === 'installed' ? { phase: 'idle' } : s));
        }
      } catch {
        // Browser-shim path or pre-Tauri context — leave the version
        // null and the UI will show "—" instead of erroring.
        setCurrentVersion(null);
      }
    })();
    setLastChecked(localStorage.getItem(prefKey(LAST_CHECKED_KEY)));
  }, []);

  // U4: an install that failed after the close reloaded the window into
  // Settings (M-4, CR-U4-6); show its reason once (read-once, the DataSection
  // restore-notice pattern).
  useEffect(() => {
    const reason = takeSession(INSTALL_FAILURE_KEY);
    if (reason !== null) {
      setState({ phase: 'error', kind: 'install', message: reason });
      setReopened(true);
    }
  }, []);

  // U4 (plan review): a mount that finds an install in flight follows it to
  // its end (the flow's own setState lands on the mount that started it).
  useEffect(() => {
    const flow = installInFlight;
    if (flow === null) return;
    let live = true;
    void flow.then(() => {
      if (live) setState(restingState());
    });
    return () => {
      live = false;
    };
  }, []);

  // The Updates card sits low on Settings; bring the reason into view.
  useEffect(() => {
    if (!reopened) return;
    return scrollIntoViewWhenSettled(() => alertRef.current, 'center');
  }, [reopened]);

  const handleCheck = async () => {
    if (exploring) return; // belt-and-braces: the button is disabled too
    setState({ phase: 'checking' });
    try {
      const update = await check();
      const now = new Date().toISOString();
      localStorage.setItem(prefKey(LAST_CHECKED_KEY), now);
      setLastChecked(now);
      if (update === null) {
        setState({ phase: 'up-to-date' });
      } else {
        // Keep the Resource itself: Install uses THIS update (Low-2).
        setState({ phase: 'available', update });
      }
    } catch (e) {
      setState({ phase: 'error', kind: 'check', message: messageOf(e) });
    }
  };

  const handleInstall = async () => {
    if (state.phase !== 'available') return;
    const { update } = state;
    setState({ phase: 'installing' });
    try {
      // download() fetches the artifact and verifies its signature against
      // the embedded pubkey. Then the live pool is drained and
      // closed before the bundle is swapped. A failure in either step comes
      // before anything is swapped, and a failed close means nothing was
      // closed, so the session keeps its database.
      await update.download();
      await closeLiveDatabase();
    } catch (e) {
      setState({ phase: 'error', kind: 'install', message: messageOf(e) });
      return;
    }
    try {
      await update.install();
    } catch (e) {
      // M-4: the pool is closed, so this window cannot keep running on it.
      // Stash the reason FIRST, then reload into Settings, where the card
      // shows it, scrolled into view (CR-U4-6).
      writeSession(INSTALL_FAILURE_KEY, messageOf(e));
      reload();
      return;
    }
    // macOS returns here without relaunching (CR-U4-1): say what is left.
    writeSession(INSTALLED_KEY, update.version);
    setState({ phase: 'installed' });
  };

  // Publish the flow for any later mount (installInFlight); clear it once
  // it settles.
  const startInstall = () => {
    installInFlight = handleInstall().finally(() => {
      installInFlight = null;
    });
  };

  const handleOpenReleases = () => {
    void openUrl(RELEASES_URL);
  };

  // 'installed' waits for the reopen: the new version is already in place.
  const isBusy =
    state.phase === 'checking' || state.phase === 'installing' || state.phase === 'installed';

  // Windows: no `windows-x86_64` key in the published latest.json yet, so
  // `check()` is unreliable (false "up to date" / false error / phantom
  // update). Never call it — replace the whole check UI with a pointer to
  // the Releases page. All hooks above still run (they are local-only
  // reads), keeping the hook order identical across platforms.
  if (isWindows()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-semibold leading-none tracking-tight">Updates</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <details className="mb-3 rounded-md border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">About updates</summary>
            <div className="pt-2 space-y-2">
              <p className="text-muted-foreground">
                Automatic updates aren't available on Windows yet &mdash; download
                new versions from the Releases page.
              </p>
            </div>
          </details>
          <div className="space-y-3">
            <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Current version</span>
              <span className="font-mono">{currentVersion ?? '—'}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="button"
                variant="link"
                className="px-0"
                onClick={handleOpenReleases}
              >
                View all releases
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold leading-none tracking-tight">Updates</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <details className="mb-3 rounded-md border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">About updates</summary>
          <div className="pt-2 space-y-2">
            <p className="text-muted-foreground">
              Cairn only checks for updates when you click this button. No
              automatic background checks. Your data never leaves your device.
            </p>
          </div>
        </details>
        <div className="space-y-3">
          <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">Current version</span>
            <span className="font-mono">{currentVersion ?? '—'}</span>
            <span className="text-muted-foreground">Last checked</span>
            <span>{formatLastChecked(lastChecked)}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy || exploring}
              onClick={() => void handleCheck()}
            >
              {state.phase === 'checking' ? 'Checking…' : 'Check for updates'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={handleOpenReleases}
            >
              View all releases
            </Button>
          </div>

          {exploring && (
            <p className="text-sm text-muted-foreground" data-testid="sample-mode-updater-note">
              Updates are checked from your own profile &mdash; not while exploring
              sample data.
            </p>
          )}

          {state.phase === 'up-to-date' && (
            <div
              role="status"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              You're up to date.
            </div>
          )}

          {state.phase === 'available' && (
            <div
              role="status"
              className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              <p>
                Version <strong className="font-mono">{state.update.version}</strong>{' '}
                available.
              </p>
              {state.update.body !== undefined && state.update.body.trim().length > 0 && (
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                  {state.update.body}
                </pre>
              )}
              <p className="text-xs text-muted-foreground">
                Your data stays where it is. If this version changes how data is stored, Cairn
                first keeps a copy, listed under Settings → Data as &quot;Before update&quot;.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={startInstall}
              >
                Install update
              </Button>
            </div>
          )}

          {state.phase === 'installing' && (
            <div
              role="status"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              Downloading and installing…
            </div>
          )}

          {state.phase === 'installed' && (
            <div
              role="status"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              Update installed. Quit and reopen Cairn to finish.
            </div>
          )}

          {state.phase === 'error' && (
            <div
              ref={alertRef}
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-soft-foreground"
            >
              {state.kind === 'check' ? (
                <>Couldn't check for updates: {state.message}</>
              ) : (
                <>
                  Couldn't install the update: {withoutTrailingPeriod(state.message)}. Your data
                  was not changed.
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
