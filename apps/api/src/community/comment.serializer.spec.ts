import { describe, expect, it } from 'vitest';
import { toCommentView, type CommentRow } from './comment.serializer.js';

const row = (overrides: Partial<CommentRow> = {}): CommentRow => ({
  id: 'c1',
  problemId: 'p1',
  userId: 'author',
  parentCommentId: null,
  body: 'The drain overflows every evening.',
  isEdited: false,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  deletedAt: null,
  user: {
    id: 'author',
    fullName: 'Arjun Mehta',
    displayName: 'arjun',
    avatarUrl: null,
    role: 'CITIZEN',
    deletedAt: null,
  },
  ...overrides,
});

const context = { viewerId: 'author', viewerIsAdmin: false, reporterId: 'reporter' };

describe('toCommentView', () => {
  it('lets the author edit and delete their own comment', () => {
    expect(toCommentView(row(), context)).toMatchObject({
      canEdit: true,
      canDelete: true,
    });
  });

  it('gives other viewers neither control', () => {
    const view = toCommentView(row(), { ...context, viewerId: 'someone-else' });
    expect(view).toMatchObject({ canEdit: false, canDelete: false });
  });

  it('lets an admin delete but never edit someone else’s words', () => {
    const view = toCommentView(row(), {
      ...context,
      viewerId: 'admin',
      viewerIsAdmin: true,
    });
    expect(view).toMatchObject({ canEdit: false, canDelete: true });
  });

  it('drops body and author from a removed comment', () => {
    const view = toCommentView(row({ deletedAt: new Date(), isEdited: true }), context);
    expect(view).toMatchObject({
      body: null,
      author: null,
      isRemoved: true,
      isEdited: false,
      canEdit: false,
      canDelete: false,
    });
  });

  it('prefers the display name and marks the reporter', () => {
    const view = toCommentView(row({ userId: 'reporter' }), context);
    expect(view.author).toMatchObject({ name: 'arjun', isReporter: true });
  });

  it('never exposes more than the public author fields', () => {
    const view = toCommentView(row(), context);
    expect(Object.keys(view.author ?? {}).sort()).toEqual(
      ['avatarUrl', 'id', 'isReporter', 'name', 'role'].sort(),
    );
  });

  it('anonymises a departed account but keeps its words', () => {
    const view = toCommentView(
      row({ user: { ...row().user, deletedAt: new Date(), avatarUrl: 'x' } }),
      context,
    );
    expect(view.author).toMatchObject({ name: 'Former member', avatarUrl: null });
    expect(view.body).toBe('The drain overflows every evening.');
  });
});
