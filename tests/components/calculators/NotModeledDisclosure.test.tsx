import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotModeledDisclosure } from '@/components/calculators/NotModeledDisclosure';

describe('NotModeledDisclosure', () => {
  it('renders a collapsed <details> with the exact summary text', () => {
    render(
      <NotModeledDisclosure testId="nmd">
        <li>First bullet</li>
      </NotModeledDisclosure>,
    );
    const details = screen.getByTestId('nmd');
    expect(details.tagName).toBe('DETAILS');
    expect(details).not.toHaveAttribute('open');
    const summary = details.querySelector('summary');
    expect(summary).toHaveTextContent('What this calculator does NOT model');
  });

  it('renders children <li>s inside a list-disc <ul>', () => {
    render(
      <NotModeledDisclosure testId="nmd">
        <li>First bullet</li>
        <li>Second bullet</li>
      </NotModeledDisclosure>,
    );
    const ul = screen.getByTestId('nmd').querySelector('ul');
    expect(ul).toHaveClass('list-disc');
    expect(ul?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders the optional intro before the list and footer after it', () => {
    render(
      <NotModeledDisclosure testId="nmd" intro="Intro paragraph" footer="Run it past a CPA.">
        <li>Bullet</li>
      </NotModeledDisclosure>,
    );
    const details = screen.getByTestId('nmd');
    const nodes = Array.from(details.children).map((el) => el.tagName);
    expect(nodes).toEqual(['SUMMARY', 'P', 'UL', 'P']);
    expect(screen.getByText('Intro paragraph')).toBeInTheDocument();
    expect(screen.getByText('Run it past a CPA.')).toBeInTheDocument();
  });

  it('omits intro/footer paragraphs when not provided', () => {
    render(
      <NotModeledDisclosure testId="nmd">
        <li>Bullet</li>
      </NotModeledDisclosure>,
    );
    const details = screen.getByTestId('nmd');
    expect(details.querySelectorAll(':scope > p')).toHaveLength(0);
  });
});
