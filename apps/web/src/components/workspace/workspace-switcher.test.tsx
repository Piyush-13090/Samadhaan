import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WorkspaceSummary } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { WorkspaceSwitcher } from './workspace-switcher';

const foundation: WorkspaceSummary = {
  organizationId: 'o1',
  slug: 'samadhaan-foundation',
  name: 'Samadhaan Foundation',
  type: 'NGO',
  logoUrl: null,
  verificationStatus: 'VERIFIED',
  membershipRole: 'OWNER',
  isAccessible: true,
};
const university: WorkspaceSummary = {
  ...foundation,
  organizationId: 'o2',
  slug: 'tech-university',
  name: 'Tech University',
  type: 'UNIVERSITY',
  membershipRole: 'MEMBER',
};
const industry: WorkspaceSummary = {
  ...foundation,
  organizationId: 'o3',
  slug: 'acme-infrastructure',
  name: 'Acme Infrastructure',
  type: 'INDUSTRY',
  isAccessible: false,
};

describe('WorkspaceSwitcher', () => {
  it('is a plain label when there is only one organisation', () => {
    render(
      <WorkspaceSwitcher
        current={foundation}
        workspaces={[foundation]}
        personal={null}
        canSwitch={false}
      />,
    );

    expect(
      screen.getByRole('group', { name: 'Organisation: Samadhaan Foundation' }),
    ).toBeInTheDocument();
    expect(screen.getByText('NGO')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the current organisation on the trigger', () => {
    render(
      <WorkspaceSwitcher
        current={university}
        workspaces={[foundation, university, industry]}
        personal={null}
        canSwitch
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Switch organisation. Current: Tech University, University',
      }),
    ).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('lists every organisation by name and type, marking the current one', async () => {
    render(
      <WorkspaceSwitcher
        current={university}
        workspaces={[foundation, university, industry]}
        personal={null}
        canSwitch
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Switch organisation/ }));

    const items = await screen.findAllByRole('menuitem');
    const byName = (name: string) =>
      items.find((item) => item.textContent?.includes(name))!;

    expect(byName('Samadhaan Foundation')).toHaveAttribute(
      'href',
      '/organization/samadhaan-foundation/dashboard',
    );
    expect(byName('Samadhaan Foundation')).toHaveTextContent('NGO');
    expect(byName('Tech University')).toHaveAttribute('aria-current', 'true');
    expect(byName('Samadhaan Foundation')).not.toHaveAttribute('aria-current');
    expect(byName('Acme Infrastructure')).toHaveTextContent('Industry · Suspended');
    expect(byName('All organisations')).toHaveAttribute('href', '/organization');
  });

  it('is keyboard operable', async () => {
    render(
      <WorkspaceSwitcher
        current={foundation}
        workspaces={[foundation, university]}
        personal={null}
        canSwitch
      />,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Switch organisation/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it("offers a citizen's personal space beside their workspaces", async () => {
    render(
      <WorkspaceSwitcher
        current={null}
        workspaces={[foundation]}
        personal={{ href: '/dashboard', label: 'Personal' }}
        canSwitch
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to an organisation workspace' }),
    );
    const personal = (await screen.findAllByRole('menuitem')).find((item) =>
      item.textContent?.includes('Personal'),
    )!;
    expect(personal).toHaveAttribute('href', '/dashboard');
    expect(personal).toHaveAttribute('aria-current', 'true');
  });

  it('surfaces pending invitations even with one organisation', async () => {
    render(
      <WorkspaceSwitcher
        current={foundation}
        workspaces={[foundation]}
        personal={null}
        canSwitch={false}
        invitationCount={2}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Switch organisation/ }));
    expect(
      await screen.findByRole('menuitem', { name: /Invitations \(2\)/ }),
    ).toHaveAttribute('href', '/organization');
  });
});
