import ReactMarkdown from 'react-markdown';
import type { DisclosureDocument } from './disclosures';

interface Props {
  document: DisclosureDocument;
}

/**
 * Read-only renderer for a consented disclosure document.
 *
 * This is the non-interactive twin of {@link DisclosureModal}: it shows the
 * SAME `body` (the exact text the user agreed to) through the SAME
 * react-markdown path and the SAME prose className, but with no acceptance
 * checkbox, no Continue/Cancel buttons, and no dialog chrome. It's used by the
 * Settings → Disclosures section so users can re-read every consented document
 * at any time, with each version's what-changed note collapsed under its
 * version line.
 *
 * It deliberately does NOT import or mutate anything in `disclosures.ts` — the
 * bodies are a versioned legal artifact rendered verbatim. Showing the
 * `version` lets a reader see exactly which revision they're looking at.
 */
export function DisclosureViewer({ document }: Props) {
  // Mirror DisclosureModal's totality: every DisclosureDocument carries a
  // title, but keep a fallback so a missing one can't render an empty heading.
  const title = document.title ?? 'Disclosure';

  return (
    <section
      data-testid="disclosure-viewer"
      className="rounded-lg border border-border/60 bg-muted/30 p-4"
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Version {document.version}</p>
      {/*
        R3 (v1.7.0): the what-changed note has a permanent, read-only home here
        so the text stays readable after the acceptance modal is gone. Native
        <details>, collapsed by default (the Settings idiom — DataSection /
        PrivacySection); rendered only for entries that ship a diff. Same
        react-markdown path and prose classes as the modal's box. No date, no
        acceptance state — the viewer stays a pure function of the registry entry.
      */}
      {document.diffFromPrevious && (
        <details
          data-testid="disclosure-viewer-diff"
          className="mt-3 rounded-md border border-border/60 px-3 py-2 text-sm"
        >
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            What changed in version {document.version}
          </summary>
          <div
            data-testid="disclosure-viewer-diff-body"
            className="mt-2 text-sm leading-relaxed text-foreground space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold"
          >
            <ReactMarkdown>{document.diffFromPrevious}</ReactMarkdown>
          </div>
        </details>
      )}
      {/*
        Identical prose styling to DisclosureModal's body div so the read-only
        rendering matches the modal exactly (same heading/list/strong/link
        treatment). Markdown is parsed by react-markdown — bold/lists/links
        render as real elements, never literal asterisks.
      */}
      <div
        data-testid="disclosure-viewer-body"
        className="mt-3 text-sm leading-relaxed text-foreground space-y-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-primary [&_a]:underline"
      >
        <ReactMarkdown>{document.body}</ReactMarkdown>
      </div>
    </section>
  );
}

export default DisclosureViewer;
