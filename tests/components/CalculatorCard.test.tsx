import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

