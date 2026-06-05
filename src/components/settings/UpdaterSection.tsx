import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isWindows } from '@/lib/platform';

/**
 * Settings → Updates section. **Manual-only** updater check — the app
 * never auto-polls on launch. The user must click "Check for updates"
 * to make any outbound network request. This honors the project's
 * "your data stays local" guarantee: the binary contains the updater
 * plugin (registered in Rust at `src-tauri/src/lib.rs:20`), but the
 * JS-side `check()` call only fires from this component.
 *
 * The Rust plugin verifies every downloaded artifact against the
 * minisign public key embedded in `tauri.conf.json:49`, so a malicious
 * release.json payload can't install a tampered binary.
 *
 * Local state machine:
 *   idle         → "Check for updates" button enabled, prior result hidden
 *   checking     → spinner, button disabled
 *   up-to-date   → "You're up to date" + last-checked timestamp
 *   available    → "Version X available" + "Install update" button
 *   error        → friendly error + retry-enabled button (network blip, etc.)
 *   installing   → spinner during download + install; the app restarts on
 *                  success so we never need an explicit "installed" state
 */

type UpdateInfo = {
  /** Available version per the updater plugin. */
  version: string;
  /** Optional release-note body from `latest.json`. */
  body?: string;
};

type CheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; update: UpdateInfo }
  | { phase: 'installing' }
  | { phase: 'error'; message: string };

const LAST_CHECKED_KEY = 'updater.lastChecked';
const RELEASES_URL = 'https://github.com/Ray-Gochuico/Cairn/releases';

function formatLastChecked(iso: string | null): string {
  if (iso === null) return 'never';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'never';
  return parsed.toLocaleString();
}

export function UpdaterSection() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [state, setState] = useState<CheckState>({ phase: 'idle' });

  // Load current version + lastChecked from local sources. No network call
  // here — both are local-only reads (Tauri's getVersion reads the bundled
  // package.json baked into the binary; lastChecked is in localStorage).
  useEffect(() => {
    void (async () => {
      try {
        const v = await getVersion();
        setCurrentVersion(v);
      } catch {
        // Browser-shim path or pre-Tauri context — leave the version
        // null and the UI will show "—" instead of erroring.
        setCurrentVersion(null);
      }
    })();
    setLastChecked(localStorage.getItem(LAST_CHECKED_KEY));
  }, []);

  const handleCheck = async () => {
    setState({ phase: 'checking' });
    try {
      const update = await check();
      const now = new Date().toISOString();
      localStorage.setItem(LAST_CHECKED_KEY, now);
      setLastChecked(now);
      if (update === null) {
        setState({ phase: 'up-to-date' });
      } else {
        setState({
          phase: 'available',
          update: { version: update.version, body: update.body },
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: 'error', message });
    }
  };

  const handleInstall = async () => {
    if (state.phase !== 'available') return;
    setState({ phase: 'installing' });
    try {
      // downloadAndInstall verifies the signature against the pubkey in
      // tauri.conf.json:49 before applying. The app restarts on success
      // so this promise typically does not resolve in the happy path.
      const update = await check();
      if (update !== null) {
        await update.downloadAndInstall();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: 'error', message });
    }
  };

  const handleOpenReleases = () => {
    void openUrl(RELEASES_URL);
  };

  const isBusy = state.phase === 'checking' || state.phase === 'installing';

  // Windows has no signed `windows-x86_64` channel in latest.json yet, so the
  // updater plugin's check() is unreliable there (false "up to date"/error or a
  // phantom "available"). Suppress the whole affirmative check path on Windows
  // and steer the user to re-download from Releases. The macOS path below is
  // untouched. See src/lib/platform.ts for why this is a UA sniff.
  const windows = isWindows();

  if (windows) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Current version</span>
              <span className="font-mono">{currentVersion ?? '—'}</span>
            </div>

            <div
              role="status"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              Automatic updates aren't available on Windows yet — re-download
              the latest version from the Releases page to update.
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
        <CardTitle>Updates</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Cairn only checks for updates when you click this button. No
          automatic background checks. Your data never leaves your device.
        </p>
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
              disabled={isBusy}
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
              <Button
                type="button"
                size="sm"
                onClick={() => void handleInstall()}
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
              Downloading and installing… the app will restart when done.
            </div>
          )}

          {state.phase === 'error' && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-soft-foreground"
            >
              Couldn't check for updates: {state.message}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
