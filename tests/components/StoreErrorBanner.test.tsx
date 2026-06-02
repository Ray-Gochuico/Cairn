import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';

describe('StoreErrorBanner', () => {
  it('renders nothing when no errors are present', () => {
    const { container } = render(<StoreErrorBanner errors={[null, undefined]} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an alert with a generic message when at least one error is set', () => {
    render(<StoreErrorBanner errors={['boom']} onRetry={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // Reassuring, non-destructive copy — the user's data did NOT vanish.
    expect(alert.textContent).toMatch(/couldn’t load|couldn't load|trouble loading/i);
  });

  it('surfaces the underlying error detail', () => {
    render(<StoreErrorBanner errors={['database is locked']} onRetry={() => {}} />);
    expect(screen.getByText(/database is locked/i)).toBeInTheDocument();
  });

  it('only shows the first non-null error detail when several are set', () => {
    render(<StoreErrorBanner errors={[null, 'first failure', 'second failure']} onRetry={() => {}} />);
    expect(screen.getByText(/first failure/i)).toBeInTheDocument();
    expect(screen.queryByText(/second failure/i)).not.toBeInTheDocument();
  });

  it('invokes onRetry when the Retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(<StoreErrorBanner errors={['boom']} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render a Retry button when onRetry is omitted', () => {
    render(<StoreErrorBanner errors={['boom']} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
