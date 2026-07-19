import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CalculatorCard } from '@/pages/calculators/CalculatorCard';

it('renders title and headline, toggles body via expand button', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <CalculatorCard title="Test calc" headline="$1,234">
        <div>Body content</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  expect(screen.getByText('Test calc')).toBeInTheDocument();
  expect(screen.getByText('$1,234')).toBeInTheDocument();
  // Default: expanded — body visible
  expect(screen.getByText('Body content')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /collapse/i }));
  expect(screen.queryByText('Body content')).not.toBeInTheDocument();
});

it('clicking Hide calls onHide with the cardId', async () => {
  const user = userEvent.setup();
  const onHide = vi.fn();
  render(
    <MemoryRouter>
      <CalculatorCard
        title="My Card"
        headline="$0"
        cardId="my-card"
        onHide={onHide}
      >
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: /hide/i }));
  expect(onHide).toHaveBeenCalledOnce();
  expect(onHide).toHaveBeenCalledWith('my-card');
});

it('uses titleText as aria-label fallback when title is a ReactNode', () => {
  render(
    <MemoryRouter>
      <CalculatorCard
        title={<span>Years to <strong>FI</strong></span>}
        titleText="Years to FI"
        headline="10"
        cardId="financial-independence"
        onHide={() => {}}
      >
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('button', { name: 'Hide Years to FI card' }),
  ).toBeInTheDocument();
});

it('renders the title as an h2 heading', () => {
  render(
    <MemoryRouter>
      <CalculatorCard title="My Calculator" headline="$0">
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  // Title must be accessible as a heading (role=heading level 2)
  expect(screen.getByRole('heading', { level: 2, name: 'My Calculator' })).toBeInTheDocument();
});

it('h2 heading still present when title is a ReactNode; Hide aria-label still uses titleText', () => {
  render(
    <MemoryRouter>
      <CalculatorCard
        title={<span>Coast<strong>FI</strong></span>}
        titleText="CoastFI"
        headline="80%"
        cardId="coast-fi"
        onHide={() => {}}
      >
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  // The h2 wrapping the ReactNode title should be present
  expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  // The Hide button aria-label must still use titleText
  expect(
    screen.getByRole('button', { name: 'Hide CoastFI card' }),
  ).toBeInTheDocument();
});


it('headline status region carries an sr-only card-name prefix for AT attribution (W16 review)', () => {
  // One ScenarioBar edit recomputes several card headlines at once; without
  // attribution AT hears three context-free figures. The card name rides
  // INSIDE the status region as sr-only text — announced, never rendered.
  render(
    <MemoryRouter>
      <CalculatorCard
        title="Years to FI"
        headline="12.3 years"
        cardId="financial-independence"
        onHide={() => {}}
      >
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  const status = screen.getByTestId('financial-independence-headline');
  // Accessible text is attributed…
  expect(status.textContent).toBe('Years to FI: 12.3 years');
  // …but the attribution is sr-only, so the VISIBLE headline is unchanged.
  const prefix = status.querySelector('.sr-only');
  expect(prefix).not.toBeNull();
  expect(prefix!.textContent).toBe('Years to FI: ');
});

it('sr-only prefix uses titleText when the title is a ReactNode', () => {
  render(
    <MemoryRouter>
      <CalculatorCard
        title={<span>Coast<strong>FI</strong></span>}
        titleText="CoastFI"
        headline="80%"
        cardId="coast-fi"
        onHide={() => {}}
      >
        <div>Body</div>
      </CalculatorCard>
    </MemoryRouter>,
  );
  const status = screen.getByTestId('coast-fi-headline');
  expect(status.querySelector('.sr-only')?.textContent).toBe('CoastFI: ');
});
