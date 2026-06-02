import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageContainer } from '@/components/layout/PageContainer';

describe('PageContainer', () => {
  it('renders its children', () => {
    render(
      <PageContainer>
        <div>page body</div>
      </PageContainer>,
    );
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('applies the canonical inset + centered max-width by default', () => {
    const { container } = render(
      <PageContainer>
        <span>x</span>
      </PageContainer>,
    );
    const root = container.firstChild as HTMLElement;
    // One canonical inset, codified once: horizontal + vertical padding, a
    // centered column, and the default content max-width. The exact tokens are
    // pinned here so a drift in any single page is caught.
    expect(root.className).toContain('mx-auto');
    expect(root.className).toContain('w-full');
    expect(root.className).toContain('max-w-6xl');
    expect(root.className).toContain('px-6');
    expect(root.className).toContain('py-6');
  });

  it('opts into a narrower reading column via width="prose"', () => {
    const { container } = render(
      <PageContainer width="prose">
        <span>x</span>
      </PageContainer>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('max-w-3xl');
    // Must NOT also carry the default wide cap (would collide in the cascade).
    expect(root.className).not.toContain('max-w-6xl');
  });

  it('opts into a full-bleed column via width="full" (no max-width cap)', () => {
    const { container } = render(
      <PageContainer width="full">
        <span>x</span>
      </PageContainer>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain('max-w-6xl');
    expect(root.className).not.toContain('max-w-3xl');
    // still centered + insetted
    expect(root.className).toContain('mx-auto');
    expect(root.className).toContain('px-6');
  });

  it('merges an extra className (e.g. space-y / flex) without dropping the canonical inset', () => {
    const { container } = render(
      <PageContainer className="space-y-6 flex flex-col">
        <span>x</span>
      </PageContainer>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('space-y-6');
    expect(root.className).toContain('flex');
    expect(root.className).toContain('px-6');
    expect(root.className).toContain('max-w-6xl');
  });

  it('forwards arbitrary props such as data-testid', () => {
    render(
      <PageContainer data-testid="page-wrap">
        <span>x</span>
      </PageContainer>,
    );
    expect(screen.getByTestId('page-wrap')).toBeInTheDocument();
  });
});
