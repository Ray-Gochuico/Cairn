import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CalculatorCard, EmptyMeaning } from '@/pages/calculators/CalculatorCard';
import {
  CalculatorShellProvider,
  type CalculatorShellApi,
} from '@/pages/calculators/calculator-shell-context';

function Harness({
  hideCard = () => {},
  initialOpen = null,
  children,
}: {
  hideCard?: CalculatorShellApi['hideCard'];
  initialOpen?: string | null;
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  return (
    <MemoryRouter>
      <CalculatorShellProvider value={{ openId, setOpenId, hideCard }}>
        {children}
      </CalculatorShellProvider>
    </MemoryRouter>
  );
}

const card = (props: Partial<React.ComponentProps<typeof CalculatorCard>> = {}) => (
  <CalculatorCard
    title="Test calc"
    headline="$1,234"
    meaning="From $2,000 gross."
    cardId="test-calc"
    {...props}
  >
    <div>Body content</div>
  </CalculatorCard>
);

it('REST: body hidden, trigger is aria-expanded=false + aria-controls, meaning shown', () => {
  render(<Harness>{card()}</Harness>);
  expect(screen.queryByText('Body content')).not.toBeInTheDocument();
  const trigger = screen.getByTestId('test-calc-trigger');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveAttribute('aria-controls', 'panel-test-calc');
  expect(screen.getByTestId('test-calc-meaning')).toHaveTextContent('From $2,000 gross.');
});

it('W10 T8: the headline live region is pre-mounted at REST', () => {
  render(<Harness>{card()}</Harness>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('$1,234');
  expect(status).toHaveAttribute('id', 'test-calc-headline');
});

it('headline status region carries an sr-only card-name prefix for AT attribution (W16 review)', () => {
  // One ScenarioBar edit recomputes several card headlines at once; without
  // attribution AT hears three context-free figures. The card name rides
  // INSIDE the status region as sr-only text — announced, never rendered.
  // Wave 17: the prefix must survive in BOTH states (REST here, OPEN below).
  render(<Harness>{card({ title: 'Years to FI', headline: '12.3 years', cardId: 'financial-independence' })}</Harness>);
  const status = screen.getByTestId('financial-independence-headline');
  // Accessible text is attributed…
  expect(status.textContent).toBe('Years to FI: 12.3 years');
  // …but the attribution is sr-only, so the VISIBLE headline is unchanged.
  const prefix = status.querySelector('.sr-only');
  expect(prefix).not.toBeNull();
  expect(prefix!.textContent).toBe('Years to FI: ');
});

it('sr-only prefix uses titleText when the title is a ReactNode (and survives OPEN)', () => {
  render(
    <Harness initialOpen="coast-fi">
      <CalculatorCard
        title={<span>Coast<strong>FI</strong></span>}
        titleText="CoastFI"
        headline="80%"
        meaning="m"
        cardId="coast-fi"
      >
        <div>Body</div>
      </CalculatorCard>
    </Harness>,
  );
  const status = screen.getByTestId('coast-fi-headline');
  expect(status.querySelector('.sr-only')?.textContent).toBe('CoastFI: ');
});

it('clicking the trigger opens the panel — SAME element, aria-expanded flips, focus stays', async () => {
  const user = userEvent.setup();
  render(<Harness>{card()}</Harness>);
  const trigger = screen.getByTestId('test-calc-trigger');
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Body content')).toBeInTheDocument();
  expect(screen.getByTestId('test-calc-trigger')).toBe(trigger);
});

it('OPEN: Esc inside the panel closes it and returns focus to the trigger', async () => {
  const user = userEvent.setup();
  render(<Harness initialOpen="test-calc">{card()}</Harness>);
  screen.getByText('Body content').focus?.();
  screen.getByRole('button', { name: 'Close Test calc' }).focus();
  await user.keyboard('{Escape}');
  expect(screen.queryByText('Body content')).not.toBeInTheDocument();
  expect(screen.getByTestId('test-calc-trigger')).toHaveFocus();
});

it('OPEN: Close button closes and focus returns to the trigger (indirect-close fallback)', async () => {
  const user = userEvent.setup();
  render(<Harness initialOpen="test-calc">{card()}</Harness>);
  await user.click(screen.getByRole('button', { name: 'Close Test calc' }));
  expect(screen.queryByText('Body content')).not.toBeInTheDocument();
  expect(screen.getByTestId('test-calc-trigger')).toHaveFocus();
});

it('⋯ menu: Hide this card goes through the shell hideCard path', async () => {
  const user = userEvent.setup();
  const hideCard = vi.fn();
  render(<Harness initialOpen="test-calc" hideCard={hideCard}>{card()}</Harness>);
  await user.click(screen.getByRole('button', { name: 'Test calc card options' }));
  await user.click(screen.getByRole('button', { name: /hide this card/i }));
  expect(hideCard).toHaveBeenCalledWith('test-calc');
});

it('⋯ menu: Open full page → renders for full-page tools (paycheck)', async () => {
  const user = userEvent.setup();
  render(
    <Harness initialOpen="paycheck">
      <CalculatorCard title="Paycheck" headline="$1" meaning="m" cardId="paycheck">
        <div>Body</div>
      </CalculatorCard>
    </Harness>,
  );
  await user.click(screen.getByRole('button', { name: 'Paycheck card options' }));
  expect(screen.getByRole('link', { name: /open full page/i })).toHaveAttribute(
    'href',
    '/calculators/paycheck',
  );
});

it('dirty: blaze corner tick + "Scenario:" prefix + sr-only sentence (never color-only)', () => {
  render(<Harness>{card({ dirty: true })}</Harness>);
  const tick = screen.getByTestId('test-calc-scenario-tick');
  expect(tick).toHaveAttribute('aria-hidden', 'true');
  expect(tick.className).toContain('border-t-blaze');
  expect(screen.getByText(/^Scenario:/)).toBeInTheDocument();
  expect(
    screen.getByText('Scenario values — differ from your Inputs data.', { exact: false }),
  ).toHaveClass('sr-only');
});

it('no provider → renders OPEN with inert chrome (standalone/test compat)', () => {
  render(
    <MemoryRouter>
      <CalculatorCard title="Solo" headline="$9" meaning="m" cardId="solo">
        <div>Solo body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  expect(screen.getByText('Solo body')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
});

it('title renders as an h3 (sections own h2 — D13); ReactNode titles keep titleText labels', () => {
  render(
    <Harness initialOpen="coast-fi">
      <CalculatorCard
        title={<span>Coast<strong>FI</strong></span>}
        titleText="CoastFI"
        headline="80%"
        meaning="m"
        cardId="coast-fi"
      >
        <div>Body</div>
      </CalculatorCard>
    </Harness>,
  );
  expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close CoastFI' })).toBeInTheDocument();
});

it('open panel carries the motion-safe 180ms fade classes (opacity only, typed duration)', async () => {
  const user = userEvent.setup();
  render(<Harness>{card()}</Harness>);
  await user.click(screen.getByTestId('test-calc-trigger'));
  const panel = document.getElementById('panel-test-calc')!;
  expect(panel.className).toContain('motion-safe:animate-in');
  // Smoke fix 2: the duration must ride the motion-safe variant chain or the
  // animate-in engine's own 150ms wins the cascade.
  expect(panel.className).toContain('motion-safe:[animation-duration:180ms]');
  expect(panel.className).not.toMatch(/(^|\s)\[animation-duration:180ms\]/);
  expect(panel.className).not.toMatch(/accordion|slide|height/);
});

it('EmptyMeaning renders the cairn glyph aria-hidden beside the CTA (links survive)', () => {
  render(
    <Harness>
      {card({
        headline: '—',
        meaning: <EmptyMeaning>Add loans on the Inputs page.</EmptyMeaning>,
      })}
    </Harness>,
  );
  const glyph = document.querySelector('[data-testid="cairn-glyph"]')!;
  expect(glyph).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('Add loans on the Inputs page.')).toBeInTheDocument();
});

it('REST trigger focus ring draws INSIDE the clipped card (ring-inset, no offset) — WCAG 2.4.7', () => {
  // The REST Card carries h-32 overflow-hidden, which clips an OUTSET ring +
  // offset to invisibility (Wave-17 review finding 1). Pin the inset form so
  // a restyle can't silently regress the only keyboard focus indicator.
  render(<Harness>{card()}</Harness>);
  const trigger = screen.getByTestId('test-calc-trigger');
  expect(trigger.className).toContain('focus-visible:ring-inset');
  expect(trigger.className).not.toContain('ring-offset');
});

it('⋯ menu Esc: focus restores to the ⋯ button, panel survives, and a following Esc still closes the panel', async () => {
  // Review finding 2: without the focus-restore half of the popover idiom,
  // Esc in the menu dropped activeElement to body and the D8 containment
  // guard permanently no-opped every later Esc.
  const user = userEvent.setup();
  render(<Harness initialOpen="test-calc">{card()}</Harness>);
  await user.click(screen.getByRole('button', { name: 'Test calc card options' }));
  // Focus a node INSIDE the menu — Esc unmounts it, which is exactly how
  // activeElement fell to body before the fix.
  screen.getByRole('button', { name: /hide this card/i }).focus();
  await user.keyboard('{Escape}');
  // Menu closed; panel body still in the document (D8 pin b).
  expect(screen.queryByRole('button', { name: /hide this card/i })).not.toBeInTheDocument();
  expect(screen.getByText('Body content')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Test calc card options' })).toHaveFocus();
  // The panel Esc affordance survives.
  await user.keyboard('{Escape}');
  expect(screen.queryByText('Body content')).not.toBeInTheDocument();
});

it('D8: Esc with focus OUTSIDE the card leaves the panel open (containment guard)', async () => {
  const user = userEvent.setup();
  render(
    <Harness initialOpen="test-calc">
      <>
        <button type="button">Outside</button>
        {card()}
      </>
    </Harness>,
  );
  screen.getByRole('button', { name: 'Outside' }).focus();
  await user.keyboard('{Escape}');
  expect(screen.getByText('Body content')).toBeInTheDocument();
});

it("D9 focus restore never scroll-yanks: opening B while A is open (focus on body) restores A's trigger focus with preventScroll", () => {
  // Safari/WKWebView (the Tauri webview) does NOT focus buttons on click —
  // activeElement stays on body, so closing A fires the D9 restore. Without
  // preventScroll the browser scrolls A's (possibly distant) trigger into
  // view — a scroll jump on every interactive open. fireEvent.click mirrors
  // that no-focus click.
  render(
    <Harness initialOpen="test-calc">
      <>
        {card()}
        <CalculatorCard title="Other" headline="$2" meaning="m" cardId="other-calc">
          <div>Other body</div>
        </CalculatorCard>
      </>
    </Harness>,
  );
  const triggerA = screen.getByTestId('test-calc-trigger');
  const focusSpy = vi.fn();
  // Instance-level override (the prototype may carry an accessor-only focus
  // in this suite's run order).
  Object.defineProperty(triggerA, 'focus', { value: focusSpy, configurable: true });
  (document.activeElement as HTMLElement | null)?.blur?.();
  fireEvent.click(screen.getByTestId('other-calc-trigger'));
  expect(screen.getByText('Other body')).toBeInTheDocument();
  expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
});
