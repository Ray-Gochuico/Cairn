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

  // Give the shared bar a projection worth converting (a $0 card can't "grow").
  await page.locator('#scenario-portfolio').fill('100000');
  await page.locator('#scenario-contribution').fill('12000');

  const headline = page.getByTestId('compound-headline');
  await expect(headline).toContainText("in today's dollars");
  const parse = (t: string | null) =>
    Number((t ?? '').match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') ?? NaN);
  const today = parse(await headline.textContent());
  expect(today).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Future $' }).click();
  await expect(headline).toContainText('in future dollars');
  expect(parse(await headline.textContent())).toBeGreaterThan(today);
  await expect(page.getByTestId('compound-total-contributed')).toContainText('(future $)');
  await expect(page.getByTestId('compound-chart-caption')).toContainText('(future $)');

  // Same-session persistence across CLIENT-SIDE nav (shim debounce law: no hard goto).
  await page.getByRole('link', { name: 'What-If' }).click();
  await page.getByRole('link', { name: 'Calculators' }).click();
  await expect(page.getByRole('button', { name: 'Future $' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 },
  );

  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
