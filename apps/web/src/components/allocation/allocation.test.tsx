import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { OrganizationAllocationDetail as Detail } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import {
  allocationCandidate,
  allocationPanel,
  governmentAllocation,
} from '@/test/government-fixtures';
import { routerMock } from '../../../vitest.setup';
import { allocationTimelineEvents } from './allocation-timeline';
import {
  ALLOCATION_NOTICE,
  GovernmentAllocationPanel,
} from './government-allocation-panel';
import { OrganizationAllocationDetail } from './organization-allocation-detail';
import { OrganizationAllocationList } from './organization-allocation-list';
import { ProblemAssignmentCard } from './problem-assignment-card';

const service = vi.hoisted(() => ({
  searchAllocationCandidates: vi.fn(),
  createAllocation: vi.fn(),
  cancelAllocation: vi.fn(),
  acceptAllocation: vi.fn(),
  declineAllocation: vi.fn(),
}));
vi.mock('@/services/allocation.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/allocation.service')>()),
  ...service,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  routerMock.refresh.mockClear();
});

function orgDetail(overrides: Partial<Detail> = {}): Detail {
  return {
    id: 'a7c1b0e4-0f7e-4c55-9b0b-6c0a3c8b1f01',
    status: 'PENDING',
    problem: {
      publicId: 'SAM-1023',
      title: 'Large pothole causing traffic disruption',
      category: 'POTHOLES',
      subcategory: null,
      severity: 'HIGH',
      status: 'VERIFIED',
      area: 'Sector 48',
      city: 'Gurugram',
      description: 'A deep pothole on the main road.',
      address: 'Sector 48',
      state: 'Haryana',
      latitude: 28.41,
      longitude: 77.04,
      reportedAt: '2026-10-05T08:00:00.000Z',
      voteCount: 12,
      aiSubcategory: null,
    },
    government: { name: 'Gurugram Municipal Corporation' },
    proposedAt: '2026-10-06T10:00:00.000Z',
    respondedAt: null,
    instructions: 'Coordinate with the ward engineer.',
    responseNote: null,
    declineReason: null,
    cancellationReason: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    canRespond: true,
    roomId: null,
    ...overrides,
  };
}

describe('GovernmentAllocationPanel', () => {
  it('presents recommendations as decision support, never as the decision', () => {
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel()}
      />,
    );

    expect(
      screen.getByText(
        'Recommendations are AI-assisted suggestions. Final allocation is made by an authorized government official.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Green Earth NGO')).toBeInTheDocument();
    expect(screen.getByText('86%', { exact: false })).toBeInTheDocument();
    // Nothing is sent until an official confirms in the dialog.
    expect(service.createAllocation).not.toHaveBeenCalled();
  });

  it('sends only the chosen organisation and the notes after confirmation', async () => {
    service.createAllocation.mockResolvedValueOnce(governmentAllocation());
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Allocate to Green Earth NGO' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Allocate SAM-1023 to Green Earth NGO?',
    });
    expect(within(dialog).getByText(ALLOCATION_NOTICE)).toBeInTheDocument();
    expect(ALLOCATION_NOTICE).toBe(
      'This action sends an official allocation request to the selected organization.',
    );

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Instructions/ }),
      'Start with the lane closure.',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Internal reason/ }),
      'Closest capable team.',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send allocation request' }),
    );

    expect(service.createAllocation).toHaveBeenCalledWith('gurgaon-mc', 'SAM-1023', {
      organizationId: allocationCandidate().organization.id,
      instructions: 'Start with the lane closure.',
      internalReason: 'Closest capable team.',
    });
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('shows the conflict when another official allocated first', async () => {
    service.createAllocation.mockRejectedValueOnce(
      new ApiError({
        code: 'CONFLICT',
        message: 'Another official allocated this problem moments ago.',
        status: 409,
      }),
    );
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel()}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Allocate to Green Earth NGO' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send allocation request' }),
    );

    expect(
      await within(dialog).findByText(
        'Another official allocated this problem moments ago.',
      ),
    ).toBeInTheDocument();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('cannot select an ineligible organisation, and says why', () => {
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          candidates: [
            allocationCandidate({
              eligible: false,
              ineligibleReason: 'SUSPENDED',
              organization: {
                ...allocationCandidate().organization,
                verificationStatus: 'SUSPENDED',
              },
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Allocate to Green Earth NGO' }),
    ).toBeDisabled();
    expect(screen.getByText(/Cannot be allocated: suspended/)).toBeInTheDocument();
  });

  it('flags an organisation that declined this problem before', () => {
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          candidates: [allocationCandidate({ previouslyDeclined: true })],
        })}
      />,
    );
    expect(screen.getByText('Declined this problem before')).toBeInTheDocument();
  });

  it('searches any organisation by name', async () => {
    service.searchAllocationCandidates.mockResolvedValueOnce([
      allocationCandidate({
        match: null,
        organization: {
          ...allocationCandidate().organization,
          id: 'x',
          name: 'IIT Delhi',
          type: 'UNIVERSITY',
        },
      }),
    ]);
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel()}
      />,
    );

    await userEvent.type(
      screen.getByRole('searchbox', { name: /Find any organisation/ }),
      'IIT',
    );
    expect(await screen.findByText('IIT Delhi')).toBeInTheDocument();
    expect(service.searchAllocationCandidates).toHaveBeenCalledWith(
      'gurgaon-mc',
      'SAM-1023',
      'IIT',
      expect.any(AbortSignal),
    );
  });

  it('explains that only verified problems can be allocated', () => {
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'NOT_VERIFIED',
          candidates: [],
        })}
      />,
    );
    expect(
      screen.getByText(/Only verified problems can be allocated/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Allocate/ })).not.toBeInTheDocument();
  });

  it('lets the allocating office withdraw a pending allocation', async () => {
    const active = governmentAllocation();
    service.cancelAllocation.mockResolvedValueOnce({ ...active, status: 'CANCELLED' });
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'ACTIVE_ALLOCATION',
          active,
          history: [active],
        })}
      />,
    );
    expect(screen.getByText('Awaiting response')).toBeInTheDocument();
    expect(screen.getByText('Strong record on road repair.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw allocation' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Withdraw this allocation?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(service.cancelAllocation).toHaveBeenCalledWith(
      'gurgaon-mc',
      active.id,
      undefined,
    );
  });

  it("does not offer to withdraw another office's allocation", () => {
    const active = governmentAllocation({
      ownedByThisOffice: false,
      internalReason: null,
    });
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'ACTIVE_ALLOCATION',
          active,
          history: [active],
        })}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Withdraw allocation' }),
    ).not.toBeInTheDocument();
  });

  it('keeps history across reallocation', () => {
    const declined = governmentAllocation({
      id: 'd1',
      status: 'DECLINED',
      declineReason: 'Outside our current capacity',
      respondedAt: '2026-10-06T11:00:00.000Z',
      declinedAt: '2026-10-06T11:00:00.000Z',
    });
    const accepted = governmentAllocation({
      id: 'a2',
      status: 'ACCEPTED',
      organization: { slug: 'iit', name: 'IIT Delhi', type: 'UNIVERSITY', logoUrl: null },
      proposedAt: '2026-10-06T12:00:00.000Z',
      acceptedAt: '2026-10-06T13:00:00.000Z',
      respondedAt: '2026-10-06T13:00:00.000Z',
    });
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'ACTIVE_ALLOCATION',
          active: accepted,
          history: [accepted, declined],
        })}
      />,
    );
    const timeline = screen.getByRole('list', { name: 'Allocation timeline' });
    expect(
      within(timeline)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Verified'),
      expect.stringContaining('Allocated to Green Earth NGO'),
      expect.stringContaining('Declined by Green Earth NGO'),
      expect.stringContaining('Allocated to IIT Delhi'),
      expect.stringContaining('Accepted by IIT Delhi'),
      expect.stringContaining('In progress'),
    ]);
    expect(screen.getByText(/Outside our current capacity/)).toBeInTheDocument();
  });
});

describe('allocationTimelineEvents', () => {
  it('orders by time and keeps causal order at the same instant', () => {
    const events = allocationTimelineEvents(
      [
        {
          id: 'a',
          status: 'ACCEPTED',
          organizationName: 'Org',
          proposedAt: '2026-10-02T00:00:00.000Z',
          acceptedAt: '2026-10-03T00:00:00.000Z',
          declinedAt: null,
          cancelledAt: null,
        },
      ],
      '2026-10-01T00:00:00.000Z',
    );
    expect(events.map((event) => event.kind)).toEqual([
      'VERIFIED',
      'ALLOCATED',
      'ACCEPTED',
      'IN_PROGRESS',
    ]);
  });
});

describe('OrganizationAllocationDetail', () => {
  it('lets an owner or admin accept, with an optional note', async () => {
    service.acceptAllocation.mockResolvedValueOnce(orgDetail({ status: 'ACCEPTED' }));
    render(<OrganizationAllocationDetail slug="green-earth" allocation={orgDetail()} />);

    expect(screen.getByText('Coordinate with the ward engineer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog', { name: 'Accept SAM-1023?' });
    expect(within(dialog).getByText(/moves to In progress/)).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Accept allocation' }),
    );

    expect(service.acceptAllocation).toHaveBeenCalledWith(
      'green-earth',
      orgDetail().id,
      undefined,
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('requires a reason to decline, and offers examples', async () => {
    service.declineAllocation.mockResolvedValueOnce(orgDetail({ status: 'DECLINED' }));
    render(<OrganizationAllocationDetail slug="green-earth" allocation={orgDetail()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline SAM-1023?' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Decline allocation' }),
    );
    expect(
      await within(dialog).findByText(/Give a reason for declining/),
    ).toBeInTheDocument();
    expect(service.declineAllocation).not.toHaveBeenCalled();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Outside our current capacity' }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Decline allocation' }),
    );
    expect(service.declineAllocation).toHaveBeenCalledWith(
      'green-earth',
      orgDetail().id,
      'Outside our current capacity',
    );
  });

  it('explains when another member responded first', async () => {
    service.acceptAllocation.mockRejectedValueOnce(
      new ApiError({
        code: 'CONFLICT',
        message: 'This allocation was already responded to by another authorized user.',
        status: 409,
      }),
    );
    render(<OrganizationAllocationDetail slug="green-earth" allocation={orgDetail()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Accept allocation' }),
    );

    expect(
      await screen.findByText(
        'This allocation was already responded to by another authorized user.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('lets a member read but not respond', () => {
    render(
      <OrganizationAllocationDetail
        slug="green-earth"
        allocation={orgDetail({ canRespond: false })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/An owner or admin of your organisation can accept/),
    ).toBeInTheDocument();
  });

  it('says when the office withdrew the request', () => {
    render(
      <OrganizationAllocationDetail
        slug="green-earth"
        allocation={orgDetail({
          status: 'CANCELLED',
          canRespond: false,
          cancelledAt: '2026-10-06T11:00:00.000Z',
        })}
      />,
    );
    expect(
      screen.getByText(/The government office withdrew this request/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});

describe('OrganizationAllocationList', () => {
  it('has an empty state per view', () => {
    render(
      <OrganizationAllocationList
        slug="green-earth"
        view="pending"
        data={{ items: [], page: 1, limit: 20, totalCount: 0, totalPages: 0 }}
      />,
    );
    expect(screen.getByText('No allocation requests waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Awaiting response' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('links each request to its detail page', () => {
    const detail = orgDetail();
    render(
      <OrganizationAllocationList
        slug="green-earth"
        view="pending"
        data={{ items: [detail], page: 1, limit: 20, totalCount: 1, totalPages: 1 }}
      />,
    );
    expect(screen.getByRole('link', { name: detail.problem.title })).toHaveAttribute(
      'href',
      `/organization/green-earth/allocations/${detail.id}`,
    );
    expect(screen.getByText(/From Gurugram Municipal Corporation/)).toBeInTheDocument();
  });
});

describe('ProblemAssignmentCard', () => {
  it('shows who is assigned and nothing private', () => {
    render(
      <ProblemAssignmentCard
        assignment={{
          organization: {
            slug: 'green-earth',
            name: 'Green Earth NGO',
            type: 'NGO',
            logoUrl: null,
          },
          assignedAt: '2026-10-06T13:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByText('Assigned organisation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Green Earth NGO' })).toHaveAttribute(
      'href',
      '/organizations/green-earth',
    );
    expect(screen.getByText('Government-assigned')).toBeInTheDocument();
  });
});

describe('Resolution room entry points', () => {
  const ROOM = '33333333-3333-4333-8333-333333333333';

  it('lets the office open the room once the allocation is accepted', () => {
    const active = governmentAllocation({
      status: 'ACCEPTED',
      acceptedAt: '2026-10-06T11:20:00.000Z',
      respondedAt: '2026-10-06T11:20:00.000Z',
      roomId: ROOM,
    });
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'NOT_VERIFIED',
          active,
          history: [active],
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open Resolution Room' })).toHaveAttribute(
      'href',
      `/resolution/${ROOM}`,
    );
  });

  it('offers no room while the allocation is pending', () => {
    const active = governmentAllocation();
    render(
      <GovernmentAllocationPanel
        slug="gurgaon-mc"
        publicId="SAM-1023"
        panel={allocationPanel({
          canAllocate: false,
          blockedReason: 'ACTIVE_ALLOCATION',
          active,
          history: [active],
        })}
      />,
    );
    expect(
      screen.queryByRole('link', { name: 'Open Resolution Room' }),
    ).not.toBeInTheDocument();
  });

  it('lets the organisation open the room from an accepted allocation', () => {
    render(
      <OrganizationAllocationDetail
        slug="green-earth"
        allocation={orgDetail({
          status: 'ACCEPTED',
          canRespond: false,
          acceptedAt: '2026-10-06T11:20:00.000Z',
          roomId: ROOM,
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open Resolution Room' })).toHaveAttribute(
      'href',
      `/resolution/${ROOM}`,
    );
  });
});
