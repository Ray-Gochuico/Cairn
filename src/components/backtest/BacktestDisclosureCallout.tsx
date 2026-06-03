export function BacktestDisclosureCallout() {
  return (
    <div data-testid="backtest-disclosure-callout"
      className="rounded-md border border-warning/40 bg-warning-soft p-4 text-sm text-warning-foreground space-y-2">
      <div className="font-semibold">About this backtest — not a prediction</div>
      <p>
        <strong>This is history, not a forecast.</strong> For every starting year from
        1871 onward, this replays your plan using that year&rsquo;s actual market returns
        and inflation. &ldquo;Success rate&rdquo; is the count of those past periods that
        met your goal — it is <strong>not a probability</strong> your plan will succeed.
        Raising the goal makes success stricter but stays a tally of what did happen.
      </p>
      <p>
        <strong>Past results do not predict future returns.</strong> The next 30 years
        will be a new window not in this dataset; backtests systematically miss tail risks
        that haven&rsquo;t happened yet.
      </p>
      <p>
        <strong>Returns are real (inflation-adjusted), gross of fees.</strong> Each year
        applies a CPI-adjusted total return for a stock/bond blend (a real S&amp;P return
        plus a 10-year Treasury return deflated to real, at your chosen stock %) before any
        fund fees. Your own portfolio diverges based on expense ratios, asset location, and
        how your real allocation differs from that mix.
      </p>
      <p>
        <strong>Tax brackets are held at 2026 levels</strong> across the entire
        1871-to-2022 replay — historical brackets are not reconstructed, so any income
        tax treatment is approximate. See Settings &rarr; Disclosures for the full set.
      </p>
    </div>
  );
}
