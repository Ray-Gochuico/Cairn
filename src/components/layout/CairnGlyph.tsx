/**
 * Line-drawn cairn — the Trailhead Stone empty-state signature (Wave 12).
 * Three stacked stones on a faint ground line, stroked in currentColor so
 * it takes text-muted-foreground from its container. Decorative only:
 * always aria-hidden; the EmptyState title carries the semantics.
 */
export function CairnGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="cairn-glyph"
      className={className}
    >
      <ellipse cx="24" cy="14" rx="6" ry="4.5" />
      <ellipse cx="24" cy="24" rx="9" ry="5.5" />
      <ellipse cx="24" cy="35" rx="12" ry="6" />
      <path d="M7 44h34" opacity="0.35" />
    </svg>
  );
}
export default CairnGlyph;
