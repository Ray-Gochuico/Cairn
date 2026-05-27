import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import NotFound from '@/pages/NotFound';

describe('NotFound', () => {
  it('renders friendly copy and a Dashboard link when matched as a route', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <div>home</div>,
        },
        {
          path: '*',
          element: <NotFound />,
        },
      ],
      { initialEntries: ['/does-not-exist'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText(/we couldn't find that page/i)).toBeInTheDocument();
    const home = screen.getByRole('link', { name: /go to dashboard/i });
    expect(home).toBeInTheDocument();
    expect(home).toHaveAttribute('href', '/');
  });
});
