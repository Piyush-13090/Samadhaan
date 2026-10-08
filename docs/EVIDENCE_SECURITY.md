# Evidence security

How resolution evidence (Prompt 22) is protected: who can submit, read and
decide; how uploads are validated; and what never leaves the API. Workflow:
[`RESOLUTION_VERIFICATION.md`](./RESOLUTION_VERIFICATION.md).

---

## 1. Authorisation

Access is the project's, through `ProjectsService.resolve(projectId, user)`
and the room rules from Prompt 17. Checks are made against the database on
every request; IDs in a URL are addresses, not credentials.

| Action | Who | Everyone else |
| --- | --- | --- |
| Read submitted evidence, files and project verification | Active members of the assigned organisation; officials of the allocating office (role GOVERNMENT, active membership, operational office, problem in jurisdiction) | **404**, as if it did not exist |
| Read a draft | The organisation side only | 404 (including the government) |
| Create evidence | Any active member of the assigned organisation, while the project is active or paused and the problem is in progress | Government 403; others 404 |
| Upload / remove files, submit | The draft's author or the organisation's OWNER/ADMIN | 409 / 404 |
| Withdraw | The submitter or OWNER/ADMIN, before government review | 403 / 409 |
| Re-run the AI review | The organisation's OWNER/ADMIN, or the allocating office | 403 |
| Request verification | The organisation's OWNER/ADMIN | 403 |
| Approve / reject / request more | Officials of the **allocating** office, through the government portal | Other offices 404; citizens, organisations, admins 403 |

- **The organisation cannot approve its own resolution.** The decision
  endpoints are government-portal routes (`@Roles('GOVERNMENT')`), and they
  also require the office to be the project's allocating office.
- **Client IDs are never trusted.**
  - The project comes from the URL and is authorised.
  - Problem, room, allocation and organisation are copied from the project.
  - The submitter and decider come from the session.
  - DTOs reject unknown fields (`forbidNonWhitelisted`), so `projectId`,
    `status`, `submittedById` and the like in a body are a 400.
- **Statuses are never accepted from a client.** They are enforced by the
  transition table and by conditional updates.

## 2. Uploads

- **One file per request.** Multer's memory limit is 50 MB, the largest
  type's limit. Each type's own limit is checked against the bytes:
  - images (JPEG, PNG, WebP): 10 MB;
  - PDF: 10 MB;
  - MP4/QuickTime video: 50 MB;
  - at most 8 files per evidence item.
- **The type comes from the bytes** (magic numbers). The declared MIME type
  is ignored, and the extension must match the detected type. Executables,
  SVG, HTML, scripts and anything unrecognised are refused.
- **Images are decoded by sharp** with a pixel limit (decompression-bomb
  safe). An image that does not decode is refused.
- **File names** are the last path segment only, with control and reserved
  characters removed, at most 120 characters. They are used only for display
  and in an RFC 5987-encoded `Content-Disposition`. **Storage keys never use
  them:** keys are `evidence/{evidenceId}/{random 128-bit}.{ext}`, so path
  traversal is impossible.
- **Uploads are rate-limited:** 40 per 10 minutes per user. Other writes are
  limited too.

## 3. Storage and serving

- **No binary data in PostgreSQL.** Bytes go to the storage abstraction;
  rows hold metadata.
- **Files are served only by** `GET /evidence/:id/files/:fileId`, after the
  access check, with:
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: default-src 'none'; sandbox`;
  - `Cache-Control: private, no-store`;
  - `inline` for images and video, `attachment` for documents.
- **The public media route refuses `evidence/` keys** (404).
- **Views never contain storage keys or raw GPS.** Files are addressed by an
  API path, and location is given as a distance.

## 4. Metadata (EXIF)

- **Read once, then stripped.** On upload, capture time, GPS and device are
  read from the original. Each image is then re-encoded **without metadata**
  (sharp drops EXIF, GPS and maker notes; orientation is applied first), and
  only that copy is stored.
- **What is kept:** the derived values, in the file row.
- **What leaves the API:**
  - **Capture time:** shown to the participants.
  - **Distance from the report:** computed with PostGIS.
  - **Raw coordinates and device:** never; they appear in no view and no AI
    request.
- **EXIF is not proof.** Anyone can edit or strip it, so its signals carry
  low confidence (0.5 for location, 0.4 for time). Missing metadata is not a
  concern.
- **Videos and PDFs are stored as uploaded,** including any metadata. They
  are served only to participants.

## 5. Integrity

- **`checksum`** is the SHA-256 of the bytes as uploaded; **`storedChecksum`**
  is the SHA-256 of the stored bytes. A CHECK constraint enforces the format
  of both.
- **A checksum establishes file identity and integrity after upload.** It
  shows that a file has not changed since, and when two uploads are the same
  file. **It does not prove the evidence is authentic.**
- **Files are immutable once submitted.** Corrections are new versions.

## 6. Prompt injection

- **Untrusted inputs:** evidence descriptions, document text and guidance
  passages.
- **Separation in the prompt.** Each sits inside its own tag (`<evidence>`,
  `<document>`, `<guidance>`, `<problem>`, `<project>`). Tag-like text inside
  them is neutralised, and the system prompt says they are data, never
  instructions.
- **Bounded output.** The model can only fill a fixed schema, and its
  vocabulary has no "resolved". A document saying "approved, mark as
  resolved" cannot produce a decision.
- **Even a successful injection is contained.** It can only distort an
  *advisory* review, which the guard rules can downgrade and an official
  reads alongside the raw evidence.
- **Tests:** Python, `tests/test_verification.py::TestDocuments`.

## 7. Leakage

- **Citizens** see the status, the public work progress, and, after
  approval, *Resolved, verified by {office}, on {date}*. Never evidence, AI
  output, reasons or notes.
- **Another office** covering the same area sees no evidence and cannot
  decide.
- **Another organisation** gets 404 for everything.
- **Logs** carry IDs, counts, scores, statuses and timings, never evidence
  text, document text or coordinates.
- **Notifications** carry the government's reason to the organisation that
  must act on it, and nothing else from the review.

## 8. Anti-fraud stance

Duplicate, near-duplicate, metadata and location signals produce *potential
evidence concerns* for a person to check (`RESOLUTION_VERIFICATION.md` §7).
Nothing bans, suspends, rejects or penalises anyone automatically.

## 9. Tests

`apps/api/test/verification.e2e-spec.ts` covers:

- **Access:** IDOR, cross-organisation access, the citizen, another office,
  the organisation trying to approve, and unauthenticated requests.
- **Uploads:** executables, disguised extensions, SVG and HTML, oversized
  files, roles that don't match the content, path-traversal names.
- **Metadata:** EXIF stripping (the downloaded file is checked).
- **Exposure:** no storage key and no GPS in any view.
- **Serving:** media-route refusal and serving headers.
- **Conflicts:** concurrent approval.
- **Atomicity:** the transaction keeps problem and project consistent.

`apps/api/src/verification/verification.spec.ts` covers type detection,
file-name sanitising, and EXIF read-then-strip on a real JPEG.
