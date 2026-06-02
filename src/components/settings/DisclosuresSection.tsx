import { openUrl } from '@tauri-apps/plugin-opener';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DisclosureViewer } from '@/legal/DisclosureViewer';
import { DISCLOSURES, type DisclosureId } from '@/legal/disclosures';

/**
 * Settings → Disclosures (Legal M1).
 *
 * The app repeatedly points users at "Settings → Disclosures" — the WhatIf
 * projection footnote and the backtest disclosure body both say "see Settings →
 * Disclosures for the full assumption set" — but that section did not exist.
 * This is its home: a READ-ONLY view of the four consented disclosure
 * documents, each rendered verbatim (same react-markdown path the acceptance
 * modal uses) with its version, so a user can re-read exactly what they agreed
 * to at any time.
 *
 * It also surfaces (M2) the Yahoo non-affiliation line and (H1) a pointer to
 * the bundled THIRD-PARTY-LICENSES attributions. Neither of those touches
 * `disclosures.ts` — adding text there would bump a version and re-prompt every
 * user. The non-affiliation line is a static in-app notice, not a consented
 * document.
 */

// Explicit display order (don't rely on object insertion order): the app-wide
// disclaimer first, then the feature-specific ones in the order they appear in
// the product.
const DISPLAY_ORDER: readonly DisclosureId[] = ['app_wide', 'roadmap', 'learning', 'backtest'];

// The repo's canonical copy of the aggregated third-party attributions. The
// same file is bundled with the app (tauri.conf.json `bundle.licenseFile`); the
// link gives users a readable copy without shipping a separate in-app viewer
// for a 7,000-line generated document.
const THIRD_PARTY_LICENSES_URL =
  'https://github.com/raymondgochuico/cairn/blob/main/THIRD-PARTY-LICENSES.md';

export function DisclosuresSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Disclosures</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The full text of every disclosure you accepted, shown read-only. These
          are the same documents presented when you first set up the app and
          whenever a version changes.
        </p>

        {DISPLAY_ORDER.map((id) => (
          <DisclosureViewer key={id} document={DISCLOSURES[id]} />
        ))}

        {/*
          Legal M2 — in-app Yahoo non-affiliation notice. Kept here (NOT in
          disclosures.ts) so it doesn't trigger a re-acceptance prompt. It is an
          informational trademark notice, not a consented term.
        */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Trademarks &amp; data sources</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cairn is not affiliated with, endorsed by, or sponsored by Yahoo or
            Yahoo Finance; &ldquo;Yahoo&rdquo; is a trademark of its respective
            owner.
          </p>
        </div>

        {/*
          Legal H1 — pointer to the bundled third-party license attributions.
          Cairn statically links open-source Rust crates (many Apache-2.0, whose
          §4(d) requires reproducing attribution); the aggregated text ships
          with the app and is browsable at the link below.
        */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Open-source licenses</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cairn is built with open-source software. The full third-party
            open-source licenses and attribution notices for the components
            bundled with the app are reproduced in{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">THIRD-PARTY-LICENSES.md</code>,
            included with this application.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void openUrl(THIRD_PARTY_LICENSES_URL)}
          >
            View third-party licenses
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DisclosuresSection;
