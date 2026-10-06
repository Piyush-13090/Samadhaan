import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type {
  ResolutionMessageView,
  ResolutionParticipants,
  ResolutionRoomView,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { describeRoomActivity } from '@/lib/resolution';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { MessageComposer } from './message-composer';
import { ResolutionMessage } from './resolution-message';
import { ResolutionRoom } from './resolution-room';
import { RoomList } from './room-list';

const service = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  fetchParticipants: vi.fn(),
  fetchActivity: vi.fn(),
  postMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  markRoomRead: vi.fn(),
  closeRoom: vi.fn(),
  uploadAttachment: vi.fn(),
}));
vi.mock('@/services/resolution.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resolution.service')>()),
  ...service,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const VIEWER = '11111111-1111-4111-8111-111111111111';
const PRIYA = '22222222-2222-4222-8222-222222222222';

function message(overrides: Partial<ResolutionMessageView> = {}): ResolutionMessageView {
  return {
    id: 'm1',
    body: 'Our field team will inspect the location tomorrow morning.',
    author: {
      userId: PRIYA,
      name: 'Priya Mehta',
      avatarUrl: null,
      organizationName: 'Gurugram Municipal Corporation',
      side: 'GOVERNMENT',
    },
    mentions: [],
    attachments: [],
    createdAt: '2026-10-06T10:42:00.000Z',
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const participants: ResolutionParticipants = {
  government: {
    name: 'Gurugram Municipal Corporation',
    members: [
      {
        userId: PRIYA,
        name: 'Priya Mehta',
        avatarUrl: null,
        membershipRole: 'OWNER',
        side: 'GOVERNMENT',
        joined: true,
      },
    ],
  },
  organization: {
    name: 'RoadSafe Foundation',
    members: [
      {
        userId: VIEWER,
        name: 'Aarav Sharma',
        avatarUrl: null,
        membershipRole: 'ADMIN',
        side: 'ORGANIZATION',
        joined: true,
      },
    ],
  },
};

function roomView(overrides: Partial<ResolutionRoomView> = {}): ResolutionRoomView {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'OPEN',
    createdAt: '2026-10-06T11:20:00.000Z',
    closedAt: null,
    closeReason: null,
    problem: {
      publicId: 'SAM-1023',
      title: 'Large pothole causing traffic disruption',
      description: 'A deep pothole on the main road.',
      status: 'IN_PROGRESS',
      severity: 'HIGH',
      category: 'POTHOLES',
      subcategory: 'Road surface cavity',
      address: 'Sector 48',
      city: 'Gurugram',
      state: 'Haryana',
      latitude: 28.41,
      longitude: 77.04,
      reportedAt: '2026-10-05T08:00:00.000Z',
      imageUrl: null,
      analysis: {
        summary: 'Large road damage.',
        severity: 'HIGH',
        category: 'POTHOLES',
        subcategory: null,
      },
    },
    government: {
      slug: 'gurugram-mc',
      name: 'Gurugram Municipal Corporation',
      type: 'GOVERNMENT',
      logoUrl: null,
    },
    organization: {
      slug: 'roadsafe',
      name: 'RoadSafe Foundation',
      type: 'NGO',
      logoUrl: null,
    },
    allocation: {
      id: 'a1',
      proposedAt: '2026-10-06T10:45:00.000Z',
      acceptedAt: '2026-10-06T11:20:00.000Z',
      instructions: 'Inspect within 48 hours.',
    },
    viewer: {
      userId: VIEWER,
      side: 'ORGANIZATION',
      canPost: true,
      canClose: false,
      homePath: '/organization/roadsafe/allocations/a1',
    },
    unreadCount: 1,
    lastReadAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.fetchMessages.mockResolvedValue({ items: [message()], nextCursor: null });
  service.fetchParticipants.mockResolvedValue(participants);
  service.fetchActivity.mockResolvedValue([]);
  service.markRoomRead.mockResolvedValue({ unreadCount: 0 });
});

describe('ResolutionMessage', () => {
  it('renders the body as text — markup is shown, never run', () => {
    const { container } = render(
      <ResolutionMessage
        message={message({
          body: '<img src=x onerror=alert(1)><script>alert(1)</script>',
        })}
        isOwn={false}
        canChange
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('names the author, organisation and side, and highlights mentions', () => {
    render(
      <ResolutionMessage
        message={message({
          body: '@Aarav Sharma please upload the evidence.',
          mentions: [{ userId: VIEWER, name: 'Aarav Sharma' }],
          editedAt: '2026-10-06T10:50:00.000Z',
        })}
        isOwn={false}
        canChange
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Priya Mehta')).toBeInTheDocument();
    expect(screen.getByText(/Gurugram Municipal Corporation/)).toBeInTheDocument();
    expect(screen.getByText('(Government)')).toBeInTheDocument();
    expect(screen.getByText('@Aarav Sharma')).toHaveClass('text-primary');
    expect(screen.getByText('(Edited)')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Edit your message/ }),
    ).not.toBeInTheDocument();
  });

  it('lets the author edit their own message', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <ResolutionMessage
        message={message()}
        isOwn
        canChange
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    const box = screen.getByLabelText('Edit message');
    await userEvent.clear(box);
    await userEvent.type(box, 'Moved to Friday.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('Moved to Friday.');
  });

  it('shows a deleted message as deleted, with no content', () => {
    render(
      <ResolutionMessage
        message={message({ body: null, deletedAt: '2026-10-06T11:00:00.000Z' })}
        isOwn
        canChange
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /your message/ }),
    ).not.toBeInTheDocument();
  });
});

describe('MessageComposer', () => {
  const all = [...participants.government.members, ...participants.organization.members];

  it('mentions a participant from the keyboard and sends their id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MessageComposer
        roomId="r"
        participants={all}
        viewerId={VIEWER}
        onSubmit={onSubmit}
      />,
    );
    const box = screen.getByRole('combobox', { name: 'Message' });
    await userEvent.type(box, 'Hello @Pri');
    const list = screen.getByRole('listbox', { name: 'Mention a participant' });
    expect(within(list).getByRole('option', { name: /Priya Mehta/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The viewer is never offered.
    expect(within(list).queryByRole('option', { name: /Aarav/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Hello @Priya Mehta ');
    await userEvent.type(box, 'please review.');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledWith({
      body: 'Hello @Priya Mehta please review.',
      mentionUserIds: [PRIYA],
      attachmentIds: [],
    });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('refuses an empty message', async () => {
    const onSubmit = vi.fn();
    render(
      <MessageComposer
        roomId="r"
        participants={all}
        viewerId={VIEWER}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a message first.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('drops a mention whose name was edited out', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MessageComposer
        roomId="r"
        participants={all}
        viewerId={VIEWER}
        onSubmit={onSubmit}
      />,
    );
    const box = screen.getByRole('combobox', { name: 'Message' });
    await userEvent.type(box, '@Pri{Enter}');
    await userEvent.clear(box);
    await userEvent.type(box, 'No mention now');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ mentionUserIds: [] }),
    );
  });
});

describe('ResolutionRoom', () => {
  it('shows context, participants, messages and an unread marker', async () => {
    render(<ResolutionRoom initial={roomView()} />);
    expect(screen.getByRole('heading', { name: 'Resolution Room' })).toBeInTheDocument();
    expect(
      screen.getAllByText('Large pothole causing traffic disruption').length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText(/inspect the location tomorrow/)).toBeInTheDocument();
    expect(screen.getByText('New messages')).toBeInTheDocument();
    await waitFor(() => expect(service.markRoomRead).toHaveBeenCalled());
    // jsdom has no EventSource: the room falls back to polling, and says so.
    expect(screen.getByText('Auto-refresh')).toBeInTheDocument();
  });

  it('sends through the composer and shows the result', async () => {
    service.postMessage.mockResolvedValue(
      message({
        id: 'm2',
        body: 'On our way.',
        createdAt: '2026-10-06T12:00:00.000Z',
        author: {
          ...message().author,
          userId: VIEWER,
          name: 'Aarav Sharma',
          side: 'ORGANIZATION',
        },
      }),
    );
    render(<ResolutionRoom initial={roomView()} />);
    await screen.findByText(/inspect the location tomorrow/);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Message' }),
      'On our way.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(service.postMessage).toHaveBeenCalledWith(roomView().id, {
      body: 'On our way.',
      mentionUserIds: [],
      attachmentIds: [],
    });
    expect(await screen.findByText('On our way.')).toBeInTheDocument();
  });

  it('is read-only once closed', async () => {
    render(
      <ResolutionRoom
        initial={roomView({
          status: 'CLOSED',
          closedAt: '2026-10-07T09:00:00.000Z',
          closeReason: 'Handed over.',
          viewer: { ...roomView().viewer, canPost: false },
        })}
      />,
    );
    expect(screen.getByText('This room is closed')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Message' })).not.toBeInTheDocument();
    expect(await screen.findByText(/inspect the location tomorrow/)).toBeInTheDocument();
  });

  it('lets the allocating office close it, with a reason', async () => {
    service.closeRoom.mockResolvedValue(
      roomView({ status: 'CLOSED', closeReason: 'Handed over to the ward team.' }),
    );
    render(
      <ResolutionRoom
        initial={roomView({
          viewer: { ...roomView().viewer, side: 'GOVERNMENT', canClose: true },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close room' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Close this resolution room?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close room' }));
    expect(
      within(dialog).getByText('Give a reason for closing the room.'),
    ).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('textbox'),
      'Handed over to the ward team.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close room' }));
    expect(service.closeRoom).toHaveBeenCalledWith(
      roomView().id,
      'Handed over to the ward team.',
    );
  });

  it('offers no close control to the organisation', () => {
    render(<ResolutionRoom initial={roomView()} />);
    expect(screen.queryByRole('button', { name: 'Close room' })).not.toBeInTheDocument();
  });

  it('turns the panels into tabs on small screens, Messages first', async () => {
    render(<ResolutionRoom initial={roomView()} />);
    const tabs = screen.getByRole('tablist', { name: 'Room sections' });
    const names = within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent);
    expect(names[0]).toMatch(/^Messages/);
    expect(within(tabs).getByRole('tab', { name: /Messages/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Participants' }));
    expect(within(tabs).getByRole('tab', { name: 'Participants' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('RoomList', () => {
  it('has an empty state', () => {
    render(<RoomList rooms={[]} />);
    expect(screen.getByText('No resolution rooms yet')).toBeInTheDocument();
  });

  it('links to each room with its unread count', () => {
    render(
      <RoomList
        rooms={[
          {
            id: 'r1',
            status: 'OPEN',
            problem: {
              publicId: 'SAM-1023',
              title: 'Pothole',
              status: 'IN_PROGRESS',
              severity: 'HIGH',
            },
            government: { name: 'Gurugram MC' },
            organization: { name: 'RoadSafe' },
            side: 'GOVERNMENT',
            createdAt: '2026-10-06T11:20:00.000Z',
            lastMessageAt: null,
            unreadCount: 3,
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Pothole' })).toHaveAttribute(
      'href',
      '/resolution/r1',
    );
    expect(screen.getByText('3 unread')).toBeInTheDocument();
  });
});

describe('describeRoomActivity', () => {
  it('words system events without message content', () => {
    const entry = {
      id: 'e',
      actor: { name: 'Aarav Sharma', organizationName: 'RoadSafe' },
      organizationName: 'RoadSafe',
      fileName: 'site.png',
      reason: null,
      createdAt: '2026-10-06T11:22:00.000Z',
    };
    expect(describeRoomActivity({ ...entry, kind: 'ACCEPTED' })).toBe(
      'RoadSafe accepted the allocation',
    );
    expect(describeRoomActivity({ ...entry, kind: 'PARTICIPANT_JOINED' })).toBe(
      'Aarav Sharma joined the discussion',
    );
    expect(describeRoomActivity({ ...entry, kind: 'ATTACHMENT_ADDED' })).toBe(
      'Aarav Sharma added site.png',
    );
  });
});
