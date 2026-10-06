# Resolution Rooms

The private collaboration space between a government office and the
organisation it allocated a problem to (Prompt 17).

> **Scope.** This is the collaboration foundation: the room, its participants,
> messages, mentions, attachments, activity, unread state, realtime updates
> and closure. Tasks, milestones, budgets, progress tracking, the AI project
> coordinator, RAG, priority ranking, completion verification, impact points
> and analytics are later milestones. Nothing here performs or imitates them.

```
Problem VERIFIED → office allocates → organisation accepts
                                         │  one transaction
                                         ▼
          allocation ACCEPTED + problem IN_PROGRESS + room OPEN
                                         │
                                         ▼
                     Resolution room  ──▶  project management (Prompt 18)
```

---

## 1. Lifecycle

| Room status | Meaning |
| --- | --- |
| `OPEN` | Created when the allocation is accepted. Participants can read and post. |
| `CLOSED` | Closed by the allocating office, with a reason. Read-only, and history stays readable. |
| `ARCHIVED` | Reserved for a later retention workflow. Nothing sets it. |

A room is **never closed automatically**. A later change to the problem's
status, including resolution, does not touch it; closing on resolution
belongs to the verification workflow.

### Creation is part of acceptance

`AllocationsService.accept` runs one transaction:

```
UPDATE problem_allocations  SET status='ACCEPTED'   WHERE id=? AND status='PENDING'
UPDATE problems             SET status='IN_PROGRESS' WHERE id=? AND status='VERIFIED'
INSERT resolution_rooms      (openRoomInTransaction)
INSERT resolution_room_events ROOM_CREATED
INSERT audit_logs            ALLOCATION_ACCEPTED, PROBLEM_STATUS_CHANGED, RESOLUTION_ROOM_CREATED
COMMIT
```

If the room cannot be created, nothing commits: the allocation stays
`PENDING` and the problem stays `VERIFIED`. The e2e suite proves this by
making the insert fail.

### Database guarantees

- **One room per accepted allocation:** `resolution_rooms.allocationId` is
  `UNIQUE`.
- **Only for an accepted allocation:** the trigger
  `resolution_rooms_accepted_allocation` refuses a room whose allocation is
  not `ACCEPTED`, or whose problem or organisations differ from that
  allocation's.
- **A closed room carries a time and a reason:** CHECK
  `resolution_rooms_closed_consistent`.
- **Bounded messages:** CHECK `resolution_messages_body_length` (1–4000
  characters).

The migration backfills a room for any allocation that was already accepted.

## 2. Participants and authorisation

Participants are **not stored**. On every request they are resolved from
membership (`ResolutionAccessService.resolve`):

| Side | Conditions |
| --- | --- |
| Government | Platform role `GOVERNMENT`; ACTIVE member of the **allocating** office; the office is operational; the problem is **still inside its jurisdiction** (same predicate as the portal) |
| Organisation | ACTIVE member of the **assigned** organisation; the organisation is operational |

Anyone else gets **404**, exactly as for a room that does not exist, so room
ids cannot be probed. That includes another organisation, another office, the
reporter or any citizen, a member of the office without the government role,
and a platform administrator who is not a member. Suspended organisations get
403 with an explanation. Problems that are deleted, or that leave the office's
jurisdiction, close the room to that office.

Membership changes take effect immediately: a removed member loses access on
their next request, and an open stream re-checks every minute.

The client never supplies `authorId`, `roomId` (outside the URL),
`organizationId` or a side. The global validation pipe rejects unknown fields
with 400.

The participants panel shows name, avatar, membership role, side, and whether
each person has opened the room. It never shows an email, phone number or
profile details.

## 3. Messages

`resolution_messages`:
- `authorId`
- `authorOrganizationId` and `authorSide`, fixed at write time from the
  proven context
- `body` (plain text)
- `editedAt`, `deletedAt`

| Action | Who | Notes |
| --- | --- | --- |
| Read | Participants | Includes deleted messages as "Message deleted" (no content) |
| Post | Participants, room `OPEN` | 1–4000 chars, trimmed, control characters stripped; 20 per minute per user |
| Edit | The author only, live message, room `OPEN` | Sets `editedAt` ("Edited"); 30 per minute |
| Delete | The author only | Soft: `deletedAt` set; the row and text are kept for the record and never returned; audited |

Nobody else can edit or delete a message: not an official of the other side,
not an owner, not an administrator. A message in the room that is not yours
gets 403; one outside the room gets 404.

**Safe rendering.** Bodies are stored and returned as plain text. The web app
renders them as React text nodes, so `<script>` in a message is displayed
literally and never parsed. No markdown, no HTML.

**Ordering and pagination.** Keyset on `(createdAt, id)`, newest page first
and oldest first within a page. The cursor is an opaque base64url of both
values, with index `(roomId, createdAt, id)`. The client merges pages and live
events by id and sorts on the same key, so the order is deterministic even for
equal timestamps.

### Mentions

The composer offers participants as an `@` autocomplete (a keyboard listbox).
It sends `mentionUserIds`. The API keeps only ids of **current participants**,
excluding the author and capped at 10, and stores them in
`resolution_message_mentions`. Mentions are never re-parsed from text.

### Unread

`resolution_room_reads (roomId, userId, lastReadAt, joinedAt)`:
- The row is created on the user's first visit, which also records
  `PARTICIPANT_JOINED`.
- Unread means messages from others, not deleted, created after `lastReadAt`.
- The page marks the room read on open, and again as messages arrive while it
  is visible.
- Posting a message also advances your marker.

## 4. Attachments (foundation)

`resolution_attachments` stores metadata only: `fileName` (sanitised, display
only), `mimeType`, `size`, `storageKey`, `uploadedById`, `messageId`. The bytes
go through `StorageService` under `resolution/<roomId>/<yyyy>/<mm>/<random>.<ext>`.

- **Types**, detected from the bytes: JPEG, PNG, WebP (also decoded with
  sharp) and PDF (`%PDF-`). Everything else is refused, including executables,
  HTML and archives.
- **Extension** must match the detected type (an image named `.exe` is
  refused). Client-supplied names and Content-Type headers are ignored.
- **Size:** at most 10 MB, enforced by multer and checked again.
  Rate-limited to 10 uploads per 10 minutes.
- **Lifecycle:** upload first (`POST …/attachments`), then reference the ids
  when posting. Only the uploader's own, unattached uploads in this room can
  be attached.
- **Access:** served only through `GET …/attachments/:id/file` after the room
  check. Responses set `nosniff`, `Content-Security-Policy: sandbox`,
  `Cache-Control: private` and a download disposition for PDFs. The public
  `/media/*` route refuses every `resolution/` key. Attachments on deleted
  messages are no longer served.

Not built yet: evidence review, versions, before/after pairing, virus
scanning, and cleanup of uploads that were never attached.

## 5. Activity

`resolution_room_events` records system events, never message text:
`ROOM_CREATED`, `PARTICIPANT_JOINED`, `MESSAGE_SENT`, `MESSAGE_EDITED`,
`MESSAGE_DELETED`, `ATTACHMENT_ADDED` and `ROOM_CLOSED`. The timeline adds the
allocation and acceptance from the allocation row itself. Keeping events
separate from authored messages is deliberate: later AI processing can tell
"what people said" from "what happened".

Security-relevant actions also go to the append-only `audit_logs`
(`entityType = 'ResolutionRoom'`): `RESOLUTION_ROOM_CREATED`,
`RESOLUTION_ROOM_CLOSED` and `RESOLUTION_MESSAGE_DELETED`.

## 6. Notifications

Through the existing event bus, planner and in-app channel. Never the author.
Notifications never include message text.

| Type | Recipients | Rule |
| --- | --- | --- |
| `RESOLUTION_MENTION` | Mentioned participants | Once per message |
| `RESOLUTION_MESSAGE` | Every other participant | **Once per unread streak**: the dedupe key includes the recipient's read marker, so further messages add nothing until they open the room again |
| `RESOLUTION_ROOM_CLOSED` | Every participant but the closer | Once |

Recipients are the current participants (the same rule as access). Links go
to `/resolution/:roomId`.

## 7. Realtime

```
POST message ─▶ ResolutionRoomsService ─▶ ResolutionRealtimeService.publish
                                              │ Redis pub/sub (all API instances)
                                              ▼
                       GET /resolution-rooms/:id/stream  (Server-Sent Events)
                                              ▼
                                     EventSource in the room page
```

- **SSE rather than WebSockets.** It rides the same-origin Next.js proxy and
  the cookie session like every other request (verified end to end through
  the proxy), needs no new protocol or dependency, and browsers reconnect
  automatically. The events are `message.created`, `message.updated`,
  `activity` and `room.closed`.
- **Access** is checked when the stream opens, re-checked every 60 s, and the
  stream ends after 15 minutes so the reconnect re-authenticates. A heartbeat
  comment every 25 s keeps it open. Non-participants get 404 and anonymous
  callers 401.
- **Fallback.** If the stream fails, the page polls every 15 s and retries the
  stream a minute later. The header shows *Live* or *Auto-refresh*. Without
  Redis, events still reach streams on the same instance.
- Typing indicators and presence are not built.

## 8. Privacy

| | Allocating office | Assigned organisation | Another org/office | Citizens/public |
| --- | --- | --- | --- | --- |
| Room, messages, attachments, activity | ✓ | ✓ | — (404) | — (404) |
| Participant names and roles | ✓ | ✓ | — | — |
| Assigned organisation, *In progress* | ✓ | ✓ | ✓ | ✓ (public problem page) |

The public problem page is unchanged: the assigned organisation and the
status. Nothing from the room appears there.

## 9. Interfaces

- **`/resolution/[roomId]`** is a single route for both sides. The viewer's
  side decides the controls (Close room for the office) and the back link.
  - **Desktop:** problem context (photo, status, severity, category, location,
    AI summary, authority, organisation, dates, instructions) and participants
    beside the collaboration panel, with activity below.
  - **Phone:** the same panels as tabs, with Messages first. Panels stay
    mounted, so drafts survive tab switches.
- **`/resolution`** lists every room you take part in, with unread counts.
  It is linked from the government and workspace navigation.
- **Entry points:**
  - "Open Resolution Room" on the government allocation panel and on the
    organisation's allocation detail and inbox.
  - Room counts on both dashboards.
- **Components:** `ResolutionRoom`, `ResolutionMessageList`,
  `ResolutionMessage`, `MessageComposer`, `ParticipantAvatar`,
  `ProblemContextPanel`, `ParticipantsPanel`, `RoomActivity`, `RoomList`,
  `useRoomStream`.
- **Accessibility:**
  - Every control has a label, and the composer is a combobox with an
    `@`-mention listbox.
  - Ctrl/⌘+Enter to send, as stated under the box.
  - A polite live region announces new messages.
  - Unread state is text ("3 unread", "New messages"), and a side is always
    written, never shown by ring colour alone.
  - The tabs use ARIA tab semantics, and dialogs come from Radix.

## 10. Not yet (and where it goes)

- Tasks, milestones and progress: done in Prompt 18. See
  [`PROJECT_MANAGEMENT.md`](./PROJECT_MANAGEMENT.md). Budgets are not built.
- AI coordinator and progress extraction: Prompt 19. It reads messages versus
  events, which is why they are separate.
- Automatic closure on verified resolution: Prompt 22.
- Typing and presence, read receipts per message, message search, email or
  push delivery, attachment cleanup and scanning, and an `ARCHIVED` workflow.
