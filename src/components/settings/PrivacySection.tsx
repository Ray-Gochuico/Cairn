import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FolderOpenIcon, CopyIcon, ShieldCheckIcon, WifiIcon } from 'lucide-react';
import { appDataDir } from '@tauri-apps/api/path';
import { revealItemInDir, openUrl } from '@tauri-apps/plugin-opener';

/**
 * Settings → Privacy & data section. Surfaces three concrete facts so the
 * user can verify the "100% local" guarantee for themselves rather than
 * taking the README's word for it:
 *
 *   1. Where the data lives (filesystem path) — with a "Show in Finder"
 *      action that reveals it directly. Clipboard fallback when the
 *      opener API isn't available (browser-shim / pre-Tauri context).
 *   2. The complete outbound-network list — Yahoo Finance refresh
 *      (manual cadence) and the updater check (user-initiated only).
 *   3. Data-at-rest guidance — FileVault recommendation, because the
 *      SQLite file is not encrypted by the app and macOS file-mode
 *      protection only matters when the disk itself is encrypted.
 *
 * This is the user-facing complement to the Security Wave-5 review's
 * Finding #1 (FileVault advisory).
 *
 * The path lookup wraps `appDataDir()` in a try/catch because the
 * `@tauri-apps/api/path` package is NOT browser-shimmed — in a dev
 * browser preview it would throw. Same pattern as UpdaterSection.tsx's
 * `getVersion()` boot — fall back to a known-good placeholder string
 * so the section still renders cleanly.
 *
 * "Show in Finder" likewise wraps `revealItemInDir` in a try/catch
 * with a copy-to-clipboard fallback. In a browser shim it logs and
 * copies; in a Tauri prod context the OS opens Finder at the path.
 */
export function PrivacySection() {
  const [dataPath, setDataPath] = useState<string>('~/Library/Application Support/com.raymondgochuico.cairn/');
  const [copied, setCopied] = useState(false);

  // Resolve the real on-disk path lazily so the section can render before
  // the Tauri bridge is ready. The string above is the documented default
  // (matches the bundle identifier in tauri.conf.json:5); the lookup just
  // upgrades it to the user-resolved literal once available.
  useEffect(() => {
    void (async () => {
      try {
        const resolved = await appDataDir();
        if (resolved) setDataPath(resolved);
      } catch {
        // Browser-shim / pre-Tauri — keep the default human-readable
        // path. No spinner: this is informational, not actionable.
      }
    })();
  }, []);

  const handleShowInFinder = async () => {
    try {
      await revealItemInDir(dataPath);
    } catch {
      // Opener not available (browser-shim) — copy the path so the user
      // can paste it into Finder's Go → Go to Folder dialog manually.
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(dataPath);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      } catch {
        // Even clipboard failed — nothing to do. The path is visible in
        // the surrounding <code> block so the user can copy it manually.
      }
    }
  };

  const handleOpenFileVaultDocs = () => {
    void openUrl('https://support.apple.com/guide/mac-help/protect-data-on-your-mac-with-filevault-mh11785/mac');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy &amp; data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {/* Where your data lives — concrete path + reveal action. */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <FolderOpenIcon className="h-4 w-4" aria-hidden="true" />
            Where your data lives
          </div>
          <p className="text-muted-foreground">
            Cairn stores everything &mdash; your transactions, accounts,
            settings, and price cache &mdash; on this Mac inside a single
            SQLite file. Nothing is uploaded; nothing syncs.
          </p>
          <code className="block break-all rounded-md border bg-muted/40 px-2 py-1 text-xs">
            {dataPath}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleShowInFinder}
              aria-label="Show data folder in Finder"
            >
              <FolderOpenIcon className="mr-1 h-4 w-4" aria-hidden="true" />
              Show in Finder
            </Button>
            {copied && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <CopyIcon className="h-3 w-3" aria-hidden="true" />
                Path copied to clipboard
              </span>
            )}
          </div>
        </section>

        {/* Outbound network calls — the complete list. */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <WifiIcon className="h-4 w-4" aria-hidden="true" />
            Outbound network calls
          </div>
          <p className="text-muted-foreground">
            Cairn makes exactly two outbound calls, both user-controlled:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Yahoo Finance refresh.</strong>{' '}
              Fetches current quotes for tickers in your portfolio. Cadence is
              set above in the Market data section &mdash; choose{' '}
              <em>Manual</em> to disable automatic refreshes. The{' '}
              <em>Refresh now</em> button always works regardless of cadence.
              No personally identifiable information is sent; only the ticker
              symbols you have entered.
            </li>
            <li>
              <strong className="text-foreground">Updater check.</strong>{' '}
              Fetches the latest{' '}
              <code className="text-xs">latest.json</code> from GitHub
              Releases to compare against your installed version.{' '}
              <strong className="text-foreground">
                Only fires when you click &ldquo;Check for updates&rdquo;
              </strong>
              {' '}in the Updates section above &mdash; never on launch, never
              in the background.
            </li>
          </ul>
          <p className="text-muted-foreground">
            No analytics. No telemetry. No crash reporters. No background
            sync. If you launch Cairn with Wi-Fi off, every feature except
            the two opt-in calls above still works.
          </p>
        </section>

        {/* Encryption at rest — FileVault guidance. */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
            Encryption at rest
          </div>
          <p className="text-muted-foreground">
            macOS file permissions restrict your data file to your user
            account &mdash; no other user on the same Mac can read it. For
            an additional layer of protection (especially against laptop
            theft), enable <strong>FileVault</strong> to encrypt your entire
            disk:
          </p>
          <p className="text-muted-foreground">
            <em>System Settings &rarr; Privacy &amp; Security &rarr; FileVault</em>
          </p>
          <p className="text-muted-foreground">
            Cairn does not currently implement its own SQLite encryption;
            that is on the v1.1 roadmap. Until then, FileVault is the
            recommended safeguard.
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={handleOpenFileVaultDocs}
          >
            Learn more about FileVault &rarr;
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}
