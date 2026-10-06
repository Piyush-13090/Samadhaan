import type { OrganizationMemberRole, ProblemCategory, ProblemSeverity, ProblemStatus } from './problem.js';
import type { WorkspaceOrganizationType } from './workspace.js';

/**
 * Resolution rooms (Prompt 17): the private space where the allocating
 * government office and the organisation that accepted work together.
 *
 * A room opens in the same transaction as the acceptance. Participants are not
 * a stored list — they are the current ACTIVE members of the two
 * organisations, checked on every request. Nobody else, including a platform
 * administrator, can read a room.
 *
 * This is the collaboration foundation only. Tasks, milestones, budgets,
 * progress tracking and AI coordination are later milestones.
 */

export const RESOLUTION_ROOM_STATUSES = ['OPEN', 'CLOSED', 'ARCHIVED'] as const;
export type ResolutionRoomStatus = (typeof RESOLUTION_ROOM_STATUSES)[number];

export type ResolutionParticipantSide = 'GOVERNMENT' | 'ORGANIZATION';

export const RESOLUTION_MESSAGE_MAX_LENGTH = 4000;
export const RESOLUTION_CLOSE_REASON_MAX_LENGTH = 1000;
export const RESOLUTION_MESSAGES_PAGE_DEFAULT = 30;
export const RESOLUTION_MESSAGES_PAGE_MAX = 100;
export const RESOLUTION_MAX_MENTIONS = 10;
export const RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE = 4;

/** Detected from the bytes on upload. Executables and archives are refused. */
export const RESOLUTION_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type ResolutionAttachmentType = (typeof RESOLUTION_ATTACHMENT_TYPES)[number];
export const RESOLUTION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface ResolutionOrganizationRef {
  slug: string;
  name: string;
  type: WorkspaceOrganizationType | 'GOVERNMENT';
  logoUrl: string | null;
}

/** `GET /resolution-rooms/:id` */
export interface ResolutionRoomView {
  id: string;
  status: ResolutionRoomStatus;
  createdAt: string;
  closedAt: string | null;
  closeReason: string | null;
  problem: {
    publicId: string;
    title: string;
    description: string;
    status: ProblemStatus;
    severity: ProblemSeverity;
    category: ProblemCategory;
    subcategory: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number;
    longitude: number;
    reportedAt: string;
    imageUrl: string | null;
    /** The latest completed AI analysis, as the reviewer saw it. */
    analysis: {
      summary: string | null;
      severity: ProblemSeverity | null;
      category: ProblemCategory | null;
      subcategory: string | null;
    } | null;
  };
  government: ResolutionOrganizationRef;
  organization: ResolutionOrganizationRef;
  allocation: {
    id: string;
    proposedAt: string;
    acceptedAt: string | null;
    instructions: string | null;
  };
  viewer: {
    userId: string;
    side: ResolutionParticipantSide;
    /** Room is OPEN. */
    canPost: boolean;
    /** An official of the allocating office, while OPEN. */
    canClose: boolean;
    /** Where "back" goes for this viewer. */
    homePath: string;
  };
  unreadCount: number;
  lastReadAt: string | null;
}

/** A row in "your rooms". */
export interface ResolutionRoomSummary {
  id: string;
  status: ResolutionRoomStatus;
  problem: { publicId: string; title: string; status: ProblemStatus; severity: ProblemSeverity };
  government: { name: string };
  organization: { name: string };
  side: ResolutionParticipantSide;
  createdAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface ResolutionParticipant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  membershipRole: OrganizationMemberRole;
  side: ResolutionParticipantSide;
  /** Opened the room at least once. */
  joined: boolean;
}

export interface ResolutionParticipants {
  government: { name: string; members: ResolutionParticipant[] };
  organization: { name: string; members: ResolutionParticipant[] };
}

export interface ResolutionAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Same-origin, authorised by room membership. */
  url: string;
  uploadedBy: { userId: string; name: string };
  messageId: string | null;
  createdAt: string;
}

export interface ResolutionMessageView {
  id: string;
  /** Null once deleted. */
  body: string | null;
  author: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    organizationName: string;
    side: ResolutionParticipantSide;
  };
  mentions: Array<{ userId: string; name: string }>;
  attachments: ResolutionAttachmentView[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ResolutionMessagePage {
  /** Oldest first within the page. */
  items: ResolutionMessageView[];
  /** Pass back as `cursor` for older messages; null at the beginning. */
  nextCursor: string | null;
}

export type ResolutionActivityKind =
  | 'ALLOCATED'
  | 'ACCEPTED'
  | 'ROOM_CREATED'
  | 'PARTICIPANT_JOINED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_EDITED'
  | 'MESSAGE_DELETED'
  | 'ATTACHMENT_ADDED'
  | 'ROOM_CLOSED';

/** System activity — never message text. */
export interface ResolutionActivityEntry {
  id: string;
  kind: ResolutionActivityKind;
  actor: { name: string; organizationName: string | null } | null;
  /** The organisation the entry is about (allocation entries). */
  organizationName: string | null;
  fileName: string | null;
  reason: string | null;
  createdAt: string;
}

/** What a room stream pushes. The client already knows who it is. */
export type ResolutionStreamEvent =
  | { type: 'message.created'; message: ResolutionMessageView }
  | { type: 'message.updated'; message: ResolutionMessageView }
  | { type: 'activity'; entry: ResolutionActivityEntry }
  | { type: 'room.closed'; closedAt: string; closeReason: string };
