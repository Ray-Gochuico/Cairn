/**
 * Fallback shown while a lazy-loaded route chunk is downloading. Sized to fit
 * inside <PageShell>'s <main>, so the sidebar stays visible and the layout
 * doesn't jump. Uses neutral skeleton rectangles (not a generic centered
 * spinner) so the placeholder roughly matches a page's eventual shape — page
 * header → grid of cards. Animates with Tailwind's `motion-safe:animate-pulse` so the
 * user sees the transition is in progress without it feeling sterile.
 *
 * Kept deliberately small (no library) — it's the only thing rendered before
 * a route chunk arrives, so it must live in the entry bundle.
 */
export default function PageLoadingSpinner() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="p-8 space-y-6 motion-safe:animate-pulse"
    >
      <div className="h-8 w-64 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-28 rounded-lg bg-muted" />
        <div className="h-28 rounded-lg bg-muted" />
        <div className="h-28 rounded-lg bg-muted" />
      </div>
      <div className="h-64 rounded-lg bg-muted" />
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
