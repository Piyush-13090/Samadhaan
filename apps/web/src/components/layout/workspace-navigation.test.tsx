import { describe, expect, it, vi } from 'vitest';
import { workspaceMobileNavigation, workspaceNavigation } from '@/lib/navigation';
import { renderWithProviders as render, screen, within } from '@/test/render';
import { AppSidebar } from './app-sidebar';
import { MobileNav } from './mobile-nav';

describe('Workspace navigation', () => {
  it('gives the phone bar five workspace targets and no Report action', () => {
    render(<MobileNav items={workspaceMobileNavigation('clean-city')} />);

    const bar = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Home',
      'Problems',
      'Opportunities',
      'Allocations',
      'Activity',
    ]);
    expect(links[0]).toHaveAttribute('href', '/organization/clean-city/dashboard');
    expect(within(bar).queryByText('Report')).not.toBeInTheDocument();
    // Hidden from large screens, where the sidebar takes over.
    expect(bar).toHaveClass('lg:hidden');
  });

  it('shows the workspace sections and the organisation switcher in the sidebar', () => {
    render(
      <AppSidebar
        sections={workspaceNavigation('clean-city')}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        homeHref="/organization/clean-city/dashboard"
        context={<div>Clean City Foundation</div>}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of [
      'Dashboard',
      'Problems',
      'Opportunities',
      'Allocations',
      'Organisation',
      'Settings',
      'Notifications',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('Clean City Foundation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Samadhaan home' })).toHaveAttribute(
      'href',
      '/organization/clean-city/dashboard',
    );
  });

  it('collapses to icons with names kept for assistive technology', () => {
    render(
      <AppSidebar
        sections={workspaceNavigation('clean-city')}
        collapsed
        onToggleCollapsed={vi.fn()}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Main' });
    // No visible text when collapsed, so each link is named by its label.
    for (const label of ['Dashboard', 'Opportunities', 'Team', 'Settings']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});
