import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Briefing, BriefingRow } from '@/lib/briefing';
import { briefingRowText } from '@/lib/briefing';

/**
 * "The Ledger" hero (Wave 13 / Direction 1): the ranked plain-language
 * briefing. Purely presentational — Dashboard composes the input and calls
 * buildBriefing; this renders whatever it is handed, post-load-gate only
 * (the empty state is honest BECAUSE Dashboard's useLoadGate settled first).
 *
 * Deliberately NO aria-live: live regions announce changes, and auto-reading
 * a financial digest on every mount is unrequested audio urgency — the audio
 * form of the fabricated-urgency ban. The card is a labelled region met in
 * normal reading order.
 *
 * Tone → paint: 'positive' tints the emphasized number success; every other
 * tone stays default ink. A dip NEVER gets destructive/warning paint.
 */

function emphasisClass(tone: BriefingRow['tone']): string {
  return tone === 'positive'
    ? 'font-medium tabular-nums text-success-foreground'
    : 'font-medium tabular-nums';
}

function BriefingRowItem({ row, viewFiltered }: { row: BriefingRow; viewFiltered: boolean }) {
  const showHouseholdSuffix = viewFiltered && row.householdScoped;
  return (
    <li data-testid={`briefing-row-${row.id}`}>
      <Link
        to={row.href}
        aria-label={`${briefingRowText(row)}${showHouseholdSuffix ? ' · Household' : ''} ${row.linkLabel}.`}
        className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 -mx-2 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="min-w-0 text-sm text-foreground">
          {row.parts.map((p, i) =>
            p.emphasis ? (
              <span key={i} className={emphasisClass(row.tone)}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
          {showHouseholdSuffix ? (
            <span className="text-muted-foreground"> · Household</span>
          ) : null}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-muted-foreground">
          <span className="hidden sm:inline text-xs opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            {row.linkLabel}
          </span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

export interface BriefingCardProps {
  /** briefingHeading(mode, lastMonth) — "Since your last visit" | "Since June". */
  heading: string;
  briefing: Briefing;
  /** filter !== 'household' — drives the "· Household" honesty suffix. */
  viewFiltered: boolean;
}

export function BriefingCard({ heading, briefing, viewFiltered }: BriefingCardProps) {
  return (
    <Card data-testid="briefing-card" role="region" aria-labelledby="briefing-heading">
      <CardHeader className="pb-2">
        <CardTitle
          id="briefing-heading"
          className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground font-medium"
        >
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {briefing.empty ? (
          <div className="py-1">
            <p className="text-sm text-foreground">{briefing.empty.title}</p>
            {briefing.empty.detail ? (
              <p className="text-sm text-muted-foreground mt-1">{briefing.empty.detail}</p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {briefing.rows.map((row) => (
              <BriefingRowItem key={row.id} row={row} viewFiltered={viewFiltered} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default BriefingCard;
