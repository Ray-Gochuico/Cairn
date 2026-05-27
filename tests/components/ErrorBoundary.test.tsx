import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '@/components/ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('Test render failure');
}

function NoBoom() {
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  // Snapshot DEV before each test and restore after — assertions toggle
  // it to exercise both code paths.
  let originalDev: unknown;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalDev = (import.meta.env as Record<string, unknown>).DEV;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = originalDev;
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('passes through when no child throws', () => {
    render(
      <ErrorBoundary>
        <NoBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('production path hides the stack until "Show technical details" is clicked', async () => {
    (import.meta.env as Record<string, unknown>).DEV = false;
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // Friendly framing visible
    expect(screen.getByText(/something didn't load right/i)).toBeInTheDocument();
    // Stack is hidden by default in prod
    expect(screen.queryByTestId('error-boundary-stack')).not.toBeInTheDocument();
    // Reveal it
    await user.click(screen.getByRole('button', { name: /show technical details/i }));
    expect(screen.getByTestId('error-boundary-stack')).toBeInTheDocument();
    // The "Copy error details" affordance shows up alongside the stack
    expect(screen.getByRole('button', { name: /copy error details/i })).toBeInTheDocument();
  });

  it('dev path shows the stack inline immediately', () => {
    (import.meta.env as Record<string, unknown>).DEV = true;
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-dev')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-stack')).toBeInTheDocument();
  });

  it('"Try again" resets the boundary so a recovered child can render', async () => {
    (import.meta.env as Record<string, unknown>).DEV = false;
    const user = userEvent.setup();
    let shouldThrow = true;
    function Toggle() {
      if (shouldThrow) throw new Error('first run');
      return <div>recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/something didn't load right/i)).toBeInTheDocument();
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
