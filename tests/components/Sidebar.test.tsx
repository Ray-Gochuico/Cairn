import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';

describe('Sidebar', () => {
  it('has a Budget link pointing at /budget', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /budget/i });
    expect(link).toHaveAttribute('href', '/budget');
  });

  it('has a Settings link pointing at /settings and no Profile link', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: /^profile$/i })).toBeNull();
  });
});
