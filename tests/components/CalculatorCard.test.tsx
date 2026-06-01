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

