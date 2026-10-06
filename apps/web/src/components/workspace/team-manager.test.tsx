import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { renderWithProviders, screen, within } from '@/test/render';
import {
  ADMIN_PERMISSIONS,
  MEMBER_PERMISSIONS,
  OWNER_PERMISSIONS,
  member,
} from '@/test/workspace-fixtures';
import { routerMock } from '../../../vitest.setup';
import { TeamManager } from './team-manager';

const service = vi.hoisted(() => ({
  inviteMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('@/services/workspace.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/workspace.service')>()),
  ...service,
}));

const render = (ui: ReactNode) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const team = [
  member('m-owner', 'Aarav Sharma', 'OWNER'),
  member('m-admin', 'Priya Mehta', 'ADMIN'),
  member('m-member', 'Rahul Verma', 'MEMBER'),
  member('m-invited', 'Neha Iyer', 'MEMBER', 'INVITED'),
];

describe('TeamManager', () => {
  it('shows a member the roster, read-only', () => {
    render(
      <TeamManager
        organizationId="org-1"
        members={team.filter((m) => m.status === 'ACTIVE')}
        viewerMembershipId="m-member"
        viewerRole="MEMBER"
        permissions={MEMBER_PERMISSIONS}
      />,
    );

    const roster = screen.getByRole('list');
    expect(within(roster).getAllByRole('listitem')).toHaveLength(3);
    expect(roster).toHaveTextContent('Aarav Sharma');
    expect(roster).toHaveTextContent('Owner');
    expect(roster).toHaveTextContent('Rahul Verma (you)');

    expect(
      screen.queryByRole('button', { name: 'Invite member' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only owners and admins can invite/)).toBeInTheDocument();
  });

  it('lets an owner manage everyone but themselves', () => {
    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Role for Aarav Sharma' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Remove Aarav Sharma/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Role for Priya Mehta' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Role for Rahul Verma' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Withdraw invitation to Neha Iyer' }),
    ).toBeInTheDocument();
  });

  it('gives an admin no controls over an owner, and no owner role to grant', async () => {
    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-admin"
        viewerRole="ADMIN"
        permissions={ADMIN_PERMISSIONS}
      />,
    );

    expect(
      screen.queryByRole('combobox', { name: 'Role for Aarav Sharma' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Remove Aarav Sharma/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Role for Priya Mehta' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Role for Rahul Verma' }));
    const options = (await screen.findAllByRole('option')).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['Admin', 'Member']);
  });

  it('changes a role and refreshes from the server', async () => {
    service.changeMemberRole.mockResolvedValue(
      member('m-member', 'Rahul Verma', 'ADMIN'),
    );
    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Role for Rahul Verma' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));

    expect(service.changeMemberRole).toHaveBeenCalledWith('org-1', 'm-member', 'ADMIN');
    expect(await screen.findByText('Rahul Verma is now an admin')).toBeInTheDocument();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('shows the server refusal when a change is not allowed', async () => {
    service.changeMemberRole.mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        message: 'This is the only owner. Make someone else an owner first.',
        status: 409,
      }),
    );
    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Role for Priya Mehta' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Member' }));

    expect(
      await screen.findByText(
        'This is the only owner. Make someone else an owner first.',
      ),
    ).toBeInTheDocument();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it('confirms before removing a member', async () => {
    service.removeMember.mockResolvedValue(undefined);
    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Rahul Verma from the team' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Remove member?' });
    expect(dialog).toHaveTextContent('Rahul Verma will lose access to this workspace');
    expect(service.removeMember).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(service.removeMember).toHaveBeenCalledWith('org-1', 'm-member');
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('invites by email with a role, and shows a refusal inline', async () => {
    service.inviteMember
      .mockRejectedValueOnce(
        new ApiError({
          code: 'NOT_FOUND',
          message:
            'No active Samadhaan account uses that email address. Ask them to register first.',
          status: 404,
        }),
      )
      .mockResolvedValueOnce(member('m-new', 'Kabir Rao', 'ADMIN', 'INVITED'));

    render(
      <TeamManager
        organizationId="org-1"
        members={team}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a member' });

    await userEvent.type(
      within(dialog).getByLabelText('Email address'),
      'kabir@example.org',
    );
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    const roles = (await screen.findAllByRole('option')).map(
      (option) => option.textContent,
    );
    // Ownership is never granted by invitation.
    expect(roles).toEqual(['Admin', 'Member']);
    await userEvent.click(screen.getByRole('option', { name: 'Admin' }));

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send invitation' }),
    );
    expect(service.inviteMember).toHaveBeenCalledWith('org-1', {
      email: 'kabir@example.org',
      membershipRole: 'ADMIN',
    });
    expect(
      await within(dialog).findByText(/No active Samadhaan account uses that email/),
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send invitation' }),
    );
    expect(await screen.findByText('Invitation sent to Kabir Rao')).toBeInTheDocument();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('shows an empty state when there are no members to list', () => {
    render(
      <TeamManager
        organizationId="org-1"
        members={[]}
        viewerMembershipId="m-owner"
        viewerRole="OWNER"
        permissions={OWNER_PERMISSIONS}
      />,
    );

    expect(screen.getByText('No team members yet')).toBeInTheDocument();
    expect(screen.getByText('No pending invitations')).toBeInTheDocument();
  });
});
