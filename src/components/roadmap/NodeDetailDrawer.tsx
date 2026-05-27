import { Fragment, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { OverrideDialog } from './OverrideDialog';
import { StatusIcon } from './StatusIcon';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';

/**
 * Ordered list of (regex, glossaryKey) pairs used to wrap financial terms
 * inside the Roadmap node body in `<TermTooltip>`. Order matters: the
 * longest / most specific patterns must come first so that "SECURE 2.0"
 * is consumed before a generic "0" could ever bind, and "solo-401(k)"
 * binds before bare "401(k)".
 *
 * Match strategy:
 *   • case-insensitive
 *   • restricted to word boundaries (or punctuation flanks) so we don't
 *     wrap inside random substrings (e.g. "401k" inside a URL)
 *   • spelled-out aliases (e.g. "Modified Adjusted Gross Income") fold
 *     into the canonical glossary key (MAGI) so the popover surfaces
 *     the canonical definition either way
 *   • first occurrence per node only — repeat hits are left as plain
 *     text so the prose isn't a wall of dotted underlines
 *
 * Terms in scope per Wave-7 scorecard:
 *   MAGI, FICA, HDHP, HSA, backdoor, pro-rata, 401(k), solo-401(k),
 *   SEP, SIMPLE, 457(b), 529, ESA, SECURE 2.0, IPS, ESPP.
 *
 * The list is also internally extended with "FI", "Coast FI", and "DAF"
 * because they appear in Roadmap node bodies and are already glossary
 * entries — wrapping them costs nothing and helps non-financial readers.
 */
const GLOSSARY_PATTERNS: ReadonlyArray<{
  /** Pattern; expected to match the on-screen literal. Case-insensitive. */
  pattern: RegExp;
  /** Lookup key in src/lib/glossary.ts (case-insensitive — resolved upstream). */
  key: string;
}> = [
  // Spelled-out aliases first, so "Modified Adjusted Gross Income" wraps as
  // MAGI (not "Modified" + "AGI" → would either split the word or miss).
  { pattern: /Modified Adjusted Gross Income/giu, key: 'MAGI' },

  // Multi-word / hyphenated terms — order longest-first to avoid partial
  // shadows (e.g. "solo-401(k)" before "401(k)").
  { pattern: /SECURE 2\.0/giu, key: 'SECURE 2.0' },
  { pattern: /\bpro-rata\b/giu, key: 'PRO-RATA' },
  { pattern: /\bsolo-401\(k\)/giu, key: 'SOLO-401(K)' },
  { pattern: /\bsolo-401k\b/giu, key: 'SOLO-401(K)' },
  { pattern: /\bsolo[-\s]?401\(?k\)?\b/giu, key: 'SOLO-401(K)' },
  { pattern: /\bCoverdell ESA\b/giu, key: 'ESA' },
  { pattern: /\bCoast FI\b/giu, key: 'COAST FI' },
  { pattern: /\bbackdoor Roth\b/giu, key: 'BACKDOOR' },
  // Bare "backdoor" should only wrap when it's clearly the Roth sense, but
  // in the Roadmap bodies the term always appears in that context, so a
  // word-boundary match is safe.
  { pattern: /\bbackdoor\b/giu, key: 'BACKDOOR' },

  // Account / plan acronyms — single-word.
  { pattern: /\b401\(k\)/giu, key: '401(K)' },
  { pattern: /\b401k\b/giu, key: '401(K)' },
  { pattern: /\b457\(b\)/giu, key: '457(B)' },
  { pattern: /\b457b\b/giu, key: '457(B)' },
  { pattern: /\b529\b/giu, key: '529 PLAN' },
  { pattern: /\bMAGI\b/giu, key: 'MAGI' },
  { pattern: /\bFICA\b/giu, key: 'FICA' },
  { pattern: /\bHDHP\b/giu, key: 'HDHP' },
  { pattern: /\bHSA\b/giu, key: 'HSA' },
  { pattern: /\bSEP\b/giu, key: 'SEP' },
  { pattern: /\bSIMPLE IRA\b/giu, key: 'SIMPLE' },
  // Bare "SIMPLE" without context is risky (common English word), so the
  // pattern requires the IRA companion. The phrase "SEP, or SIMPLE IRA"
  // in the chart text matches via SEP first (which leaves SIMPLE IRA
  // alone in this same body — first-occurrence-only) — the next IRA
  // mention will still bind to its dedicated regex if it appears.
  { pattern: /\bESA\b/giu, key: 'ESA' },
  { pattern: /\bIPS\b/giu, key: 'IPS' },
  { pattern: /\bESPP\b/giu, key: 'ESPP' },
  { pattern: /\bDAF\b/giu, key: 'DAF' },
  // FI (Financial Independence) is two letters and very common as a
  // substring; the case-sensitive bare-acronym requirement filters out
  // false positives in prose.
  { pattern: /\bFI\b/gu, key: 'FI' },
];

interface GlossaryHit {
  start: number;
  end: number;
  key: string;
  literal: string;
}

/**
 * Walks `text` and wraps the first occurrence of each known glossary
 * term in a `<TermTooltip>`. Subsequent occurrences in the same body
 * stay as plain text — keeps the prose readable instead of dotted
 * underlines everywhere.
 *
 * Returns a flat array of React nodes suitable for direct rendering
 * inside a parent block. Preserves whitespace and original casing of
 * the matched text (TermTooltip displays the literal child, not the
 * canonical glossary term, so "Coast FI" stays "Coast FI" and
 * "Modified Adjusted Gross Income" stays as written even though both
 * resolve to the same canonical glossary entries).
 */
export function glossarize(text: string): ReactNode[] {
  // Collect every potential match across all patterns first, then
  // de-overlap (longest-match-wins) and de-duplicate (first-per-key).
  const allHits: GlossaryHit[] = [];
  for (const { pattern, key } of GLOSSARY_PATTERNS) {
    // Fresh regex each call to reset lastIndex (the source pattern has
    // the `g` flag which is stateful).
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Guard against zero-length matches infinite-looping.
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      allHits.push({
        start: m.index,
        end: m.index + m[0].length,
        key,
        literal: m[0],
      });
    }
  }

  if (allHits.length === 0) return [text];

  // Sort by start asc, then by length desc — longest match at a given
  // start position wins ties (e.g. "solo-401(k)" beats "401(k)" when
  // both start within a few chars; the longer one consumed the prefix
  // earlier so by start position the longer regex's start is lower).
  allHits.sort((a, b) => a.start - b.start || b.end - a.end - (b.start - a.start));

  // Greedy non-overlap sweep + first-per-key filter.
  const seenKeys = new Set<string>();
  const accepted: GlossaryHit[] = [];
  let cursor = 0;
  for (const hit of allHits) {
    if (hit.start < cursor) continue;          // overlaps a previously-accepted match
    if (seenKeys.has(hit.key)) continue;       // already wrapped this term
    accepted.push(hit);
    seenKeys.add(hit.key);
    cursor = hit.end;
  }

  if (accepted.length === 0) return [text];

  // Reconstruct the text with tooltip-wrapped slices.
  const out: ReactNode[] = [];
  let pos = 0;
  accepted.forEach((hit, i) => {
    if (hit.start > pos) {
      out.push(text.slice(pos, hit.start));
    }
    out.push(
      <TermTooltip key={`gloss-${i}-${hit.key}`} term={hit.key}>
        {hit.literal}
      </TermTooltip>,
    );
    pos = hit.end;
  });
  if (pos < text.length) {
    out.push(text.slice(pos));
  }
  return out;
}

interface Props {
  node: RoadmapNode;
  result: NodeResult;
  ctx: RoadmapContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-side sheet that pops out when the user hits the `(i)` button on a
 * node row. Three blocks per the design spec:
 *   1. Verbatim chart text (`node.body`) — what the source Financial Independence flow
 *      chart says, unmodified, so users can verify the app's reading.
 *   2. How this was calculated — the engine's `evidence` plus, when the
 *      user has overridden the node, a side-by-side "Auto: X · You
 *      marked: Y" line so they can spot divergence.
 *   3. Actions — Override Status (opens dialog) and, when an override is
 *      active, Clear Override (revert to the auto result).
 *
 * Built on shadcn `<Sheet>` (W7-Frontend RM-3 — previously a hand-rolled
 * fixed-position panel that lacked focus trap, animated slide-in, and
 * Escape-key wiring outside of click-outside). The Sheet primitive is
 * backed by `@radix-ui/react-dialog`, which gives us:
 *   • focus trapped while the drawer is open
 *   • Escape closes
 *   • click-outside closes (via the Sheet's overlay)
 *   • inert background while open
 *   • animated slide-in / slide-out from the right side
 */
export function NodeDetailDrawer({ node, result, open, onOpenChange }: Props) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const clearOverride = useRoadmapOverridesStore((s) => s.clearOverride);
  const overridden = result.autoResult !== undefined;

  const handleClear = async () => {
    await clearOverride(node.id);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          aria-label={node.title}
          className="w-full sm:max-w-md overflow-y-auto p-0"
        >
          <SheetHeader className="px-6 py-4 border-b text-left space-y-1">
            <SheetTitle className="text-base font-semibold">
              {node.title}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Section {node.section}
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 py-4 space-y-5">
            <section>
              <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                From the chart
              </h4>
              <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {glossarize(node.body).map((part, i) => (
                  <Fragment key={i}>{part}</Fragment>
                ))}
              </div>
            </section>
            <section>
              <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                How this was calculated
              </h4>
              <div className="flex items-start gap-2 text-sm">
                <StatusIcon status={result.status} className="mt-0.5" />
                <div>{result.evidence ?? 'No calculation yet.'}</div>
              </div>
              {result.autoResult && (
                <div className="text-xs text-muted-foreground italic mt-2">
                  Auto: {result.autoResult.status} · You marked: {result.status}
                </div>
              )}
            </section>
            <section className="flex flex-wrap gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideOpen(true)}
              >
                Override status
              </Button>
              {overridden && (
                <Button variant="ghost" size="sm" onClick={handleClear}>
                  Clear override
                </Button>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
      <OverrideDialog
        node={node}
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
      />
    </>
  );
}

export default NodeDetailDrawer;
