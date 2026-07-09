/**
 * W10 M43: the shared not-settled placeholder for the inputs tabs. Tabs render
 * inside the inputs layout, so this is a card-list-sized inline block (not the
 * full-page spinner). role="status" + aria-label makes it a live region an AT
 * announces while the store loads, and it never shows the tab's "No X yet"
 * copy over unloaded data.
 */
export function TabLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-2 motion-safe:animate-pulse">
      <div className="h-16 rounded-lg bg-muted" />
      <div className="h-16 rounded-lg bg-muted" />
    </div>
  );
}
