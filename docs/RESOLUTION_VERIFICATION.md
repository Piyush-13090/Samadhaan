# Resolution verification

AI-assisted verification of resolved civic problems (Prompt 22):

1. The assigned organisation submits completion evidence.
2. The AI reviews it and gives an advisory recommendation.
3. The government office that allocated the work inspects the evidence and
   decides.

> **AI verification is advisory.** AI never declares a problem resolved. Its
> vocabulary has no "resolved": only *insufficient evidence*, *possibly
> resolved*, *likely resolved* and *likely not resolved*. Only an authorised
> government official can approve a resolution, and approval is what moves
> the problem to RESOLVED.
>
> AI assists verification but does not prove that a real-world problem has
> been permanently fixed.

Security of uploads, files and metadata: [`EVIDENCE_SECURITY.md`](./EVIDENCE_SECURITY.md).

---

## 1. Flow

```
Resolution project (ACTIVE)
  ─▶ organisation member: draft evidence ─▶ upload files (one per request) ─▶ submit
  ─▶ background job ─▶ FastAPI /verify/evidence ─▶ assessment (advisory) ─▶ AI_REVIEWED
  ─▶ organisation OWNER/ADMIN: request verification (one pending per project)
  ─▶ allocating office: APPROVE · REJECT (reason) · REQUEST MORE EVIDENCE (reason)
        approve ─▶ one transaction: problem IN_PROGRESS → RESOLVED (resolvedAt)
                                    project ACTIVE → COMPLETED
                                    evidence → APPROVED
  ─▶ audit entries + notifications (organisation, officials, reporter, followers)
```

The allocation stays **ACCEPTED**, its final state; the allocation lifecycle
has no later state. The resolution room stays open until the office closes it.

**Organisations can no longer complete a project themselves.** From this
milestone, `POST /resolution-projects/:id/status { COMPLETED }` returns 409:
completion happens only through an approved verification.

## 2. Evidence model

| Model | Holds |
| --- | --- |
| `ResolutionEvidence` | Project, plus problem, room, allocation and organisation copied **server-side** from the project; submitter; type; title; description; status; `version`; `replacesEvidenceId` (the previous version, which is kept); the verification request; `aiStatus` and `aiAttempts`; the government's `decisionReason`; timestamps |
| `ResolutionEvidenceFile` | `role` (BEFORE, AFTER, DOCUMENT, OTHER); storage key (never exposed); safe display name; detected MIME type; size; `checksum` (SHA-256 of the upload); `storedChecksum`; 64-bit `perceptualHash`; dimensions; EXIF `capturedAt` and GPS (never exposed raw); `locationDistanceM`; metadata |
| `ResolutionVerificationAssessment` | One AI review: eight signal scores, `evidenceQuality`, `confidence`, `aiRecommendation` and the guarded `recommendation`, explanation, concerns, missing evidence, guidance, model, prompt, embedding and verification versions, timing, failure message |
| `ResolutionVerificationRequest` | The organisation's request (note, requester), the allocating office, and the decision (status, official, time, reason, note). A partial unique index allows at most one PENDING per project |

**Evidence types:** `BEFORE_AFTER_IMAGE`, `AFTER_IMAGE`, `VIDEO`, `DOCUMENT`,
`LOCATION_PROOF`, `PROGRESS_UPDATE` and `OTHER`. The enum is extensible.

**Versioning.** Evidence is never overwritten once submitted:

- Files can be added or removed only while the evidence is a draft.
- A correction is a new evidence item with `replacesEvidenceId`, which bumps
  `version`. The old item stays visible as "replaced by a newer version".
- Rejected and withdrawn evidence keeps its files and its history.

## 3. Lifecycle

```
DRAFT ─submit▶ SUBMITTED ─job▶ PROCESSING ─▶ AI_REVIEWED
AI_REVIEWED / NEEDS_MORE_EVIDENCE ─request verification▶ UNDER_GOVERNMENT_REVIEW
UNDER_GOVERNMENT_REVIEW ─government▶ APPROVED / REJECTED / NEEDS_MORE_EVIDENCE
DRAFT / SUBMITTED / AI_REVIEWED / NEEDS_MORE_EVIDENCE ─organisation▶ WITHDRAWN
```

- **The table is enforced by the API.** It lives in `EVIDENCE_TRANSITIONS`,
  in `packages/shared`, and **no endpoint accepts a status.** Every change is a
  conditional update on the status the actor saw, so concurrent actions get
  409.
- **Re-running the AI review** (`POST /evidence/:id/analyze`) changes only
  `aiStatus`. Evidence under government review stays under review.

## 4. AI verification pipeline

`VerificationAnalysisService` builds a **bounded** context for one evidence
item:

| Input | Bound |
| --- | --- |
| The problem: title, description, category, analysis summary and observations | Truncated |
| Project progress: status, task counts and progress, milestones, tasks | ≤ 8 milestones, ≤ 10 tasks |
| This evidence's photos, resized to `VERIFICATION_IMAGE_MAX_PX`, re-encoded JPEG | ≤ 4 (after-photos first) |
| The citizen's original report photos, as B1 and B2 | ≤ 2 |
| PDF documents, with text extracted in Python | ≤ 2 documents, 6000 characters each |
| Earlier evidence for the project, one line each | ≤ 5 |
| Guidance from PUBLIC knowledge and this project's PROJECT knowledge (RAG) | ≤ 3 passages |
| Per file: role, capture date, distance from the report | Never coordinates or storage keys |

- **Python** (`POST /verify/evidence`, prompt `evidence-verification-2026-10-v1`)
  sends the photos with constrained structured output. The output is four
  signals (each a value and a confidence), a recommendation from the
  controlled vocabulary, a confidence, and up to five supporting
  observations and five remaining issues, each citing F#, B# or G#.
- **Validation in Python:**
  - Uncited observations are dropped.
  - Visual consistency is nulled without both a before and an after photo,
    and documentation without a readable document.
  - With neither a photo nor a readable document, the recommendation is
    INSUFFICIENT_EVIDENCE.
- **Validation in NestJS:** refs, ranges and the vocabulary are re-checked.
  **Any other verdict, including "RESOLVED", is rejected** as invalid output.
- **Development provider:** no model runs, so every signal is null and there
  is no recommendation (`status UNAVAILABLE`).

### Deterministic signals (no model)

| Signal | How | Confidence |
| --- | --- | --- |
| Location consistency | Closest photo GPS to the reported location (PostGIS). 1 within `VERIFICATION_LOCATION_NEAR_M` (100 m), linear to 0 at `…_FAR_M` (1000 m). **Unavailable** without GPS | 0.5 (EXIF can be edited) |
| Time consistency | Share of after-photo capture times after the report and not in the future (1-day tolerance). Unavailable without EXIF time | 0.4 |
| Completeness | Expected evidence for the category present: required items count 1, suggestions 0.5 | 1 |
| Image quality | Short side / 720 px, capped at 1, averaged | 0.8 |

### Evidence quality (0–100)

A confidence-weighted mean over the available signals:

| Signal | Weight |
| --- | --- |
| Relevance | 0.25 |
| Completion signals | 0.25 |
| Visual consistency | 0.10 |
| Location | 0.10 |
| Documentation | 0.10 |
| Completeness | 0.10 |
| Time | 0.05 |
| Image quality | 0.05 |

The weights are in `verification-scoring.ts` and are a documented baseline,
not fitted values. **Evidence quality is never the decision.**

### Guard rules

The guard rules apply to the AI's recommendation and only ever move it
towards caution. Each records why.

- No photo and no readable document → INSUFFICIENT_EVIDENCE.
- Relevance below 0.3 → INSUFFICIENT_EVIDENCE.
- AI confidence below 0.4 → LIKELY_RESOLVED becomes POSSIBLY_RESOLVED, and
  LIKELY_NOT_RESOLVED becomes INSUFFICIENT_EVIDENCE.
- LIKELY_RESOLVED becomes POSSIBLY_RESOLVED when location consistency is
  below 0.3, or when there is a serious concern (§7).

### Jobs

- **Background:** submission returns at once.
- **Idempotent:** a job claims its evidence with a conditional update.
- **Retryable:** up to `VERIFICATION_MAX_ATTEMPTS` (3), spaced by
  `VERIFICATION_RETRY_SECONDS`.
- **Bounded:** after the last attempt the review is recorded as FAILED, and
  the evidence still moves to AI_REVIEWED so a reviewer is never blocked. The
  deterministic signals are computed even then.
- **Observable:** progress is visible as `aiStatus` and in the logs.
- **Resumed on start-up.**

### Image embeddings

**Not used.** Samadhaan has no image-embedding model yet, so none is
simulated. Visual comparison is the vision model's judgement, one signal
among several, and near-duplicate detection uses a 64-bit difference hash.

## 5. Expected evidence (by category)

`EXPECTED_EVIDENCE` in `packages/shared/src/types/verification.ts` is a
checklist, not a gate.

- **Required everywhere:** only an after photo.
- **Suggested per category:** a before photo (the citizen's report photo
  counts), location proof (a photo GPS within 100 m, or LOCATION_PROOF
  evidence), and a document where the category calls for one. Examples:
  roads, potholes and infrastructure suggest a completion document; drainage
  and public safety an inspection; electricity a safety certificate; water an
  inspection or quality report.

Nothing in the checklist blocks a decision.

## 6. RAG integration

Guidance is retrieved by `KnowledgeRetrievalService` with the access
predicate limited to **PUBLIC and this project's PROJECT knowledge**. The
query is "completion criteria / repair standard" for the problem's category
and title.

- **The passages are sent** to the model as untrusted reference material (G1…).
- **They are stored** with the assessment and **re-checked at read time**: a
  passage that was deleted or re-scoped disappears.
- **They never approve anything.**

## 7. Anti-fraud signals

These produce **"Potential evidence concern"** notes. They are never
accusations and never act automatically: no ban, no rejection, no score
penalty beyond the guard rule above.

| Code | Signal | Serious |
| --- | --- | --- |
| `DUPLICATE_FILE_OTHER_PROBLEM` | Same upload checksum as evidence for another problem | ✓ |
| `NEAR_DUPLICATE_OTHER_PROBLEM` | Perceptual hash within 6 of 64 bits of another problem's evidence | ✓ |
| `AFTER_MATCHES_BEFORE` | An after-photo within 4 bits of the citizen's report photo (may show no change) | ✓ |
| `CAPTURED_BEFORE_REPORT` | After-photo capture time before the report | ✓ |
| `LOCATION_FAR` | Photo GPS beyond `VERIFICATION_LOCATION_FAR_M` | ✓ |
| `CAPTURED_IN_FUTURE` | Impossible capture time | |
| `DUPLICATE_UPLOAD` | Same file in earlier evidence for this project | |
| `CONFLICTING_ASSESSMENTS` | Reviews of different evidence disagree (roll-up only) | |

## 8. Government review

`GET /government/:slug/problems/:publicId/verification` returns:

- the original problem and its photos;
- the project's progress (tasks and milestones);
- every non-draft evidence item, with its raw files (opened through the API's
  access check), its AI review, signals, concerns and guidance;
- a roll-up: the latest recommendation, conflicts flagged;
- expected evidence;
- request history;
- the timeline;
- `approvalBlockers`;
- the limitations.

**Decisions:**

- `approve` with an optional `note`.
- `reject` and `request-evidence`, each requiring a `reason` of 10–2000
  characters. The reason is shared with the organisation, which must act on
  it.

**Who decides:** an official of the **allocating** office (role GOVERNMENT, an
active membership of an operational office, and the problem in its
jurisdiction). Another office whose area also covers the problem can see the
problem but not the evidence, and its decisions get 404.

**Approval** is one transaction:

1. The request moves PENDING → APPROVED (conditional).
2. Evidence → APPROVED.
3. The project moves ACTIVE → COMPLETED. This is refused (409) while tasks
   are open, and the UI shows the blocker.
4. The problem moves IN_PROGRESS → RESOLVED with `resolvedAt`.
5. Audit entries are written.

Any failure rolls back everything. A concurrent second approval gets 409.

**Rejection and requests for more evidence** move the evidence to REJECTED or
NEEDS_MORE_EVIDENCE with the reason. The problem stays IN_PROGRESS and the
project stays ACTIVE. Nothing is deleted.

## 9. History and audit

The append-only audit log records:

| Action | Recorded |
| --- | --- |
| `EVIDENCE_SUBMITTED` | |
| `EVIDENCE_WITHDRAWN` | Only if the evidence was ever submitted |
| `EVIDENCE_AI_REVIEWED` | With no human actor |
| `EVIDENCE_REVIEW_REQUESTED` | A re-run of the AI review |
| `EVIDENCE_REJECTED` | Per rejected item |
| `RESOLUTION_VERIFICATION_REQUESTED` | |
| `RESOLUTION_APPROVED` | |
| `RESOLUTION_REJECTED` | |
| `MORE_EVIDENCE_REQUESTED` | |
| `PROBLEM_STATUS_CHANGED` | `viaVerification` |
| `RESOLUTION_PROJECT_STATUS_CHANGED` | |

The verification timeline shown to both sides is read from these entries.

## 10. Notifications

| Event | To | Type |
| --- | --- | --- |
| Evidence submitted | The allocating office's officials | `RESOLUTION_EVIDENCE_SUBMITTED` |
| AI review finished | Officials and the submitter | `RESOLUTION_EVIDENCE_REVIEWED` |
| Verification requested | Officials ("awaiting review") and the organisation's managers ("with the government office") | `RESOLUTION_VERIFICATION_REQUESTED` |
| Approved | The organisation's managers and the submitters | `RESOLUTION_APPROVED` |
| Approved | The reporter: "Your reported problem SAM-XXXX has been resolved, verified by …". Followers get the existing follower notification | `PROBLEM_STATUS_CHANGED` |
| Rejected / more evidence | The organisation's managers and the submitters, with the reason | `RESOLUTION_REJECTED` / `RESOLUTION_MORE_EVIDENCE_REQUESTED` |

**Links:**

- officials → `/government/{slug}/problems/{id}#verification`;
- the organisation → `/resolution/{roomId}/project#evidence`.

**Nobody is notified of their own action.** No AI output, private note or
room message is included.

## 11. Citizen view

The public problem page shows:

- **Before resolution:** the assigned organisation and a public work-progress
  percentage (the share of tasks completed).
- **After approval:** **Resolved**, *Verified by {office}*, *Resolved on {date}*.

It never shows evidence, AI reviews, reasons, notes, room messages or
internal state.

## 12. Limitations

AI review cannot reliably determine any of the following, and the UI says so
wherever a review is shown:

- structural durability;
- long-term maintenance;
- hidden defects;
- service quality;
- work outside the evidence;
- whether evidence is fraudulent.

Further limitations:

- **Metadata is a claim.** EXIF time and GPS can be edited or stripped, which
  is why their confidence is capped and their absence is not a concern.
- **Videos are stored and shown but not analysed** by AI.
- **Near-duplicate search** scans evidence hashes linearly, which is fine at
  current scale; a BK-tree or index would be needed later. Problem report
  photos are hashed on the fly.
- **Weights and thresholds** are documented baselines, not validated.

## 13. Future improvements

- An image-embedding model for visual similarity.
- On-site inspection scheduling.
- A durability follow-up: re-inspection after N months.
- Video frame sampling.
- Signed upload URLs for very large files.
- Verified-device or verified-capture apps.
- Calibration of the evidence-quality weights against officials' decisions,
  treating those decisions as labels with known bias.
