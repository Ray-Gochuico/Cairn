import { test, expect } from '@playwright/test';
import { collectErrors } from './console-guard';

test("calculators: Today's $ default; Future $ grows the Compound figures and flips every phrase", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/calculators');

  const todayBtn = page.getByRole('button', { name: "Today's $" });
  await expect(todayBtn).toBeVisible({ timeout: 30_000 });
  await expect(todayBtn).toHaveAttribute('aria-pressed', 'true');

  // NO bar edits here (divergence from the plan's sketch, which pre-filled the
  // bar because "a $0 card can't grow"). This spec runs in the [seeded]
  // project, whose demo profile already carries a positive projection — and
  // the bar commits on a 150ms debounce, so filling it and reading the Today
  // figure immediately compared two different SCENARIOS rather than two BASES
  // (observed: today $1,320,902 pre-debounce vs future $341,558 post-debounce).
  // Reading the untouched seeded scenario removes the race at its source.
  // The calculators grid renders every card COLLAPSED (CalculatorCard's
  // stretched trigger: "REST it covers the whole card, no body renders").
  // The headline shows either way; the tiles + chart caption live in the body,
  // so open Compound before asserting on them.
  await page.getByTestId('compound-interest-trigger').click();

  const headline = page.getByTestId('compound-headline');
  await expect(headline).toContainText("in today's dollars");
  await expect(page.getByTestId('compound-total-contributed')).toContainText("(today's $)");
  await expect(page.getByTestId('compound-chart-caption')).toContainText("(today's $)");
  const parse = (t: string | null) =>
    Number((t ?? '').match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') ?? NaN);
  const today = parse(await headline.textContent());
  expect(today).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Future $' }).click();
  // The seeded household's inflation_assumption is 0.024 (migration 0001's
  // default) — the phrase must name that real resolver output, not a constant.
  await expect(headline).toContainText('in future dollars, at your 2.4% inflation assumption');
  expect(parse(await headline.textContent())).toBeGreaterThan(today);
  await expect(page.getByTestId('compound-total-contributed')).toContainText('(future $)');
  await expect(page.getByTestId('compound-chart-caption')).toContainText('(future $)');

  // Same-session persistence across CLIENT-SIDE nav (shim debounce law: no hard goto).
  // Scope to the sidebar: /calculators also renders an in-page What-If
  // InlineLink inside #main, so a bare getByRole('link') is ambiguous.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'What-If' }).click();
  await nav.getByRole('link', { name: 'Calculators' }).click();
  await expect(page.getByRole('button', { name: 'Future $' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 },
  );

  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
