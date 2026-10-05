import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommentPage, CommentView } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import { ToastProvider } from '@/components/ui/toast';
import { renderWithProviders, screen } from '@/test/render';

/** Community actions report failures as toasts, so the provider the app supplies is needed. */
const render = (ui: React.ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);
import { CommunityDiscussion, removeFromThreads } from './community-discussion';

const { fetchComments, postComment, editComment, deleteComment } = vi.hoisted(() => ({
  fetchComments: vi.fn(),
  postComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock('@/services/community.service', () => ({
  fetchComments,
  postComment,
  editComment,
  deleteComment,
}));

let sequence = 0;

function comment(overrides: Partial<CommentView> = {}): CommentView {
  sequence += 1;
  return {
    id: `c${sequence}`,
    body: 'This road becomes very dangerous after rain.',
    author: {
      id: 'u-piyush',
      name: 'Piyush',
      avatarUrl: null,
      role: 'CITIZEN',
      isReporter: false,
    },
    parentCommentId: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    isEdited: false,
    isRemoved: false,
    canEdit: false,
    canDelete: false,
    replies: [],
    replyCount: 0,
    repliesCursor: null,
    ...overrides,
  };
}

function page(items: CommentView[], overrides: Partial<CommentPage> = {}): CommentPage {
  return { items, nextCursor: null, commentCount: items.length, ...overrides };
}

function renderDiscussion(initial: CommentPage | null, acceptsEngagement = true) {
  return render(
    <CommunityDiscussion
      publicId="SAM-1023"
      initial={initial}
      acceptsEngagement={acceptsEngagement}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('CommunityDiscussion', () => {
  it('is a labelled section with a comment count', () => {
    renderDiscussion(page([comment()], { commentCount: 12 }));

    expect(
      screen.getByRole('region', { name: 'Community Discussion' }),
    ).toBeInTheDocument();
    expect(screen.getByText('12').parentElement).toHaveTextContent('12 comments');
  });

  it('shows the empty state when there are no comments', () => {
    renderDiscussion(page([]));

    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    expect(screen.getByText('Be the first to share what you know.')).toBeInTheDocument();
  });

  it('shows the error state, and a skeleton while retrying', async () => {
    let release!: (value: CommentPage) => void;
    fetchComments.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderDiscussion(null);

    expect(screen.getByText("Couldn't load comments.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByLabelText('Loading comments')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    release(page([comment({ body: 'Loaded after retry.' })]));
    expect(await screen.findByText('Loaded after retry.')).toBeInTheDocument();
  });

  it('renders comment text as text, never as markup', () => {
    renderDiscussion(page([comment({ body: '<img src=x onerror=alert(1)>' })]));

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('has a labelled comment box', () => {
    renderDiscussion(page([]));
    expect(screen.getByLabelText('Add a comment')).toBeInTheDocument();
  });

  it('posts a comment and shows it at the top with the server’s count', async () => {
    postComment.mockResolvedValue({
      comment: comment({ body: 'Same issue near the next intersection.', canEdit: true }),
      commentCount: 2,
    });
    const user = userEvent.setup();
    renderDiscussion(page([comment()]));

    await user.type(
      screen.getByLabelText('Add a comment'),
      'Same issue near the next intersection.',
    );
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(
      await screen.findByText('Same issue near the next intersection.'),
    ).toBeInTheDocument();
    expect(postComment).toHaveBeenCalledWith('SAM-1023', {
      body: 'Same issue near the next intersection.',
    });
    // The form clears and the count is the server's.
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
    expect(screen.getByText('2', { selector: 'span' }).parentElement).toHaveTextContent(
      '2 comments',
    );
    const items = within(screen.getByRole('list', { name: 'Comments' })).getAllByRole(
      'article',
    );
    expect(items[0]).toHaveTextContent('Same issue near the next intersection.');
  });

  it('refuses an empty comment before calling the API', async () => {
    const user = userEvent.setup();
    renderDiscussion(page([]));

    await user.type(screen.getByLabelText('Add a comment'), '   ');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByText('Write a comment first.')).toBeInTheDocument();
    expect(postComment).not.toHaveBeenCalled();
  });

  it('shows the API’s reason when posting fails, and keeps the draft', async () => {
    postComment.mockRejectedValue(
      new ApiError({
        code: 'RATE_LIMITED',
        message:
          'You are commenting very quickly. Please wait a minute before posting again.',
        status: 429,
      }),
    );
    const user = userEvent.setup();
    renderDiscussion(page([]));

    await user.type(screen.getByLabelText('Add a comment'), 'An important observation.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByText(/commenting very quickly/)).toBeInTheDocument();
    expect(screen.getByLabelText('Add a comment')).toHaveValue(
      'An important observation.',
    );
  });

  it('offers edit and delete only where the server allows', () => {
    renderDiscussion(
      page([
        comment({ body: 'Mine.', canEdit: true, canDelete: true }),
        comment({ body: 'Someone else’s.' }),
      ]),
    );

    const [mine, theirs] = within(
      screen.getByRole('list', { name: 'Comments' }),
    ).getAllByRole('article');
    expect(
      within(mine!).getByRole('button', { name: 'Edit your comment' }),
    ).toBeInTheDocument();
    expect(
      within(mine!).getByRole('button', { name: 'Delete comment' }),
    ).toBeInTheDocument();
    expect(
      within(theirs!).queryByRole('button', { name: /Edit/ }),
    ).not.toBeInTheDocument();
    expect(
      within(theirs!).queryByRole('button', { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  it('edits in place, showing the existing text and marking it edited', async () => {
    const original = comment({ body: 'Original text.', canEdit: true, canDelete: true });
    editComment.mockResolvedValue({
      comment: { ...original, body: 'Corrected text.', isEdited: true },
      commentCount: 1,
    });
    const user = userEvent.setup();
    renderDiscussion(page([original]));

    await user.click(screen.getByRole('button', { name: 'Edit your comment' }));
    const box = screen.getByLabelText('Edit your comment');
    expect(box).toHaveValue('Original text.');
    expect(box).toHaveFocus();

    await user.clear(box);
    await user.type(box, 'Corrected text.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Corrected text.')).toBeInTheDocument();
    expect(screen.getByText('· edited')).toBeInTheDocument();
    expect(editComment).toHaveBeenCalledWith('SAM-1023', original.id, 'Corrected text.');
  });

  it('cancels an edit with Escape, leaving the comment unchanged', async () => {
    const user = userEvent.setup();
    renderDiscussion(page([comment({ body: 'Keep me.', canEdit: true })]));

    await user.click(screen.getByRole('button', { name: 'Edit your comment' }));
    await user.type(screen.getByLabelText('Edit your comment'), ' extra');
    await user.keyboard('{Escape}');

    expect(screen.getByText('Keep me.')).toBeInTheDocument();
    expect(editComment).not.toHaveBeenCalled();
  });

  it('deletes after confirmation', async () => {
    const target = comment({ body: 'Delete me.', canEdit: true, canDelete: true });
    deleteComment.mockResolvedValue({ comment: null, commentCount: 0 });
    const user = userEvent.setup();
    renderDiscussion(page([target]));

    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deletion' });
    // Focus lands on the safe choice.
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Delete me.')).not.toBeInTheDocument());
    expect(deleteComment).toHaveBeenCalledWith('SAM-1023', target.id);
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });

  it('keeps a deleted comment with replies as a placeholder', async () => {
    const reply = comment({ body: 'A reply that stays.', parentCommentId: 'parent' });
    const parent = comment({
      id: 'parent',
      body: 'Parent to remove.',
      canDelete: true,
      replies: [reply],
      replyCount: 1,
    });
    deleteComment.mockResolvedValue({ comment: null, commentCount: 1 });
    const user = userEvent.setup();
    renderDiscussion(page([parent], { commentCount: 2 }));

    await user.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]!);
    await user.click(
      within(screen.getByRole('group', { name: 'Confirm deletion' })).getByRole(
        'button',
        {
          name: 'Delete',
        },
      ),
    );

    expect(await screen.findByText('This comment was removed.')).toBeInTheDocument();
    expect(screen.queryByText('Parent to remove.')).not.toBeInTheDocument();
    expect(screen.getByText('A reply that stays.')).toBeInTheDocument();
  });

  it('keeps the comment and explains when delete fails', async () => {
    deleteComment.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderDiscussion(page([comment({ body: 'Still here.', canDelete: true })]));

    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Confirm deletion' })).getByRole(
        'button',
        {
          name: 'Delete',
        },
      ),
    );

    expect(await screen.findByText("Couldn't delete the comment")).toBeInTheDocument();
    expect(screen.getByText('Still here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete comment' })).toBeEnabled();
  });

  it('replies under the comment, keyboard-first', async () => {
    const parent = comment({ body: 'This road becomes very dangerous after rain.' });
    postComment.mockResolvedValue({
      comment: comment({
        body: 'Same issue near the next intersection.',
        parentCommentId: parent.id,
        author: {
          id: 'u-rahul',
          name: 'Rahul',
          avatarUrl: null,
          role: 'CITIZEN',
          isReporter: false,
        },
      }),
      commentCount: 2,
    });
    const user = userEvent.setup();
    renderDiscussion(page([parent]));

    const replyButton = screen.getByRole('button', { name: 'Reply to Piyush' });
    expect(replyButton).toHaveAttribute('aria-expanded', 'false');
    replyButton.focus();
    await user.keyboard('{Enter}');
    expect(replyButton).toHaveAttribute('aria-expanded', 'true');

    const box = screen.getByLabelText('Reply to Piyush');
    expect(box).toHaveFocus();
    await user.type(box, 'Same issue near the next intersection.');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));

    const replies = await screen.findByRole('list', { name: 'Replies to Piyush' });
    expect(replies).toHaveTextContent('Same issue near the next intersection.');
    expect(postComment).toHaveBeenCalledWith('SAM-1023', {
      body: 'Same issue near the next intersection.',
      parentCommentId: parent.id,
    });
  });

  it('does not offer Reply on replies — threads are one level deep', () => {
    const reply = comment({ body: 'A reply.', parentCommentId: 'p1' });
    renderDiscussion(page([comment({ id: 'p1', replies: [reply], replyCount: 1 })]));

    expect(screen.getAllByRole('button', { name: /^Reply/ })).toHaveLength(1);
  });

  it('loads more replies on request', async () => {
    const parent = comment({
      id: 'busy',
      replies: [comment({ body: 'Reply 1', parentCommentId: 'busy' })],
      replyCount: 3,
      repliesCursor: 'cursor-1',
    });
    fetchComments.mockResolvedValue(
      page([
        comment({ body: 'Reply 2', parentCommentId: 'busy' }),
        comment({ body: 'Reply 3', parentCommentId: 'busy' }),
      ]),
    );
    const user = userEvent.setup();
    renderDiscussion(page([parent]));

    await user.click(screen.getByRole('button', { name: 'Show 2 more replies' }));

    expect(await screen.findByText('Reply 3')).toBeInTheDocument();
    expect(fetchComments).toHaveBeenCalledWith('SAM-1023', {
      parentCommentId: 'busy',
      cursor: 'cursor-1',
    });
    expect(
      screen.queryByRole('button', { name: /more replies/ }),
    ).not.toBeInTheDocument();
  });

  it('pages top-level comments with a button, not infinite scroll', async () => {
    fetchComments.mockResolvedValue(page([comment({ body: 'An older comment.' })]));
    const user = userEvent.setup();
    renderDiscussion(page([comment()], { nextCursor: 'next-1', commentCount: 21 }));

    await user.click(screen.getByRole('button', { name: 'Show more comments' }));

    expect(await screen.findByText('An older comment.')).toBeInTheDocument();
    expect(fetchComments).toHaveBeenCalledWith('SAM-1023', { cursor: 'next-1' });
  });

  it('closes the discussion on a report that no longer accepts it', () => {
    renderDiscussion(page([comment()]), false);

    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
    expect(screen.getByText('Discussion is closed on this report.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reply/ })).not.toBeInTheDocument();
  });

  /** Replies are indented once and modestly, so threads fit a phone. */
  it('keeps thread indentation shallow and free of fixed widths', () => {
    const reply = comment({ body: 'A reply.', parentCommentId: 'p1' });
    const { container } = renderDiscussion(
      page([comment({ id: 'p1', replies: [reply], replyCount: 1 })]),
    );

    for (const element of container.querySelectorAll('*')) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(classes).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
      // No indentation step beyond ml-11 (2.75rem) at any breakpoint.
      expect(classes).not.toMatch(/\bml-(1[2-9]|[2-9]\d)\b/);
    }
  });
});

describe('removeFromThreads', () => {
  it('drops a removed placeholder once its last reply goes', () => {
    const reply = comment({ parentCommentId: 'p' });
    const placeholder = comment({
      id: 'p',
      isRemoved: true,
      body: null,
      author: null,
      replies: [reply],
      replyCount: 1,
    });

    expect(removeFromThreads([placeholder], reply)).toEqual([]);
  });
});
