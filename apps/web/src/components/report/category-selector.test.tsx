import userEvent from '@testing-library/user-event';
import { PROBLEM_CATEGORIES } from '@samadhaan/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render, screen } from '@/test/render';
import { CategorySelector } from './category-selector';

describe('CategorySelector', () => {
  it('offers every category as a radio option', () => {
    render(<CategorySelector value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole('radio')).toHaveLength(PROBLEM_CATEGORIES.length);
  });

  it('reports the chosen category', async () => {
    const onChange = vi.fn();
    render(<CategorySelector value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Drainage' }));

    expect(onChange).toHaveBeenCalledWith('DRAINAGE');
  });

  it('marks the current value as checked', () => {
    render(<CategorySelector value="POTHOLES" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Potholes' })).toBeChecked();
  });

  // Native radios give arrow-key navigation for free; a div-based picker would
  // have to reimplement it.
  it('groups the options so keyboard navigation works', () => {
    render(<CategorySelector value={null} onChange={vi.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios.every((radio) => radio.getAttribute('name') === 'category')).toBe(true);
  });

  it('associates an error with the group', () => {
    render(
      <CategorySelector value={null} onChange={vi.fn()} error="Choose a category." />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category.');
  });
});
