# Search security

How search (Prompt 25) keeps people from finding what they may not see.
Architecture: [`SEARCH_ARCHITECTURE.md`](./SEARCH_ARCHITECTURE.md).

## 1. Principle: authorise inside retrieval

```
search ─▶ candidate retrieval WITH the access policy in SQL ─▶ ranking ─▶ response
```

- **Rows the caller may not see are never fetched,** scored, cached for them
  or counted.
- **Detail rows are re-read for each page with the same predicate.** A
  stale cached list cannot reveal a problem that has since been hidden.
- **The frontend hides nothing:** there is nothing to hide.

## 2. Policies (`SearchAuthorizationService`)

| Entity | Who finds what |
| --- | --- |
| Problem | Published civic reports: not draft, not deleted, not a merged duplicate. Rejected, archived and duplicate reports are hidden unless asked for by status. Public fields only: no reporter, coordinates, internal notes or allocation reasons |
| Problem, `office=` | Narrows to that office's jurisdiction, through the same `GovernmentAccessService.resolve` as the portal. Citizens get 403; officials of another office get 404 |
| Organisation | Public profiles: active, not deleted, verified or pending. Never suspended or rejected |
| Knowledge | The Prompt 20 predicate: public; own office's or organisation's; own private; a project's only with `projectId` **and** proven participation (otherwise 404). Returned sources are re-checked before display |
| Project | Members of the assigned organisation, or officials of the government office within its jurisdiction. This mirrors the resolution-room rule. Citizens: none (the section is omitted). Room messages are never searched |

## 3. Input handling

- **Every parameter is validated** (class-validator, whitelist,
  `forbidNonWhitelisted`):
  - enums for category, severity, urgency, priority, status (DRAFT excluded)
    and organisation type;
  - lengths: `q` ≤ 200, city/state ≤ 100;
  - formats: dates, postal code, slugs, bbox;
  - ranges: lat/lng, radius 0.5–50 km, `limit` ≤ 50.
- **Unknown parameters get 400.**
- **SQL injection.** All values are bound parameters through `Prisma.sql`;
  nothing is concatenated.
  - Full-text queries go through `plainto_tsquery`, which ignores operator
    syntax.
  - The suggestion prefix query is rebuilt from letters and digits only.
- **Cursors** are opaque, validated (shape, bounded offset), and **bound to
  the search's cache key**. A cursor from another query or user is rejected.
- **Highlighting returns text segments,** never HTML. The client renders
  `<mark>` around them as React text, so content cannot inject markup.

## 4. AI and prompt injection

- **The AI parser sees one query string,** wrapped and neutralised as
  untrusted data, with instructions to ignore embedded instructions and
  never output SQL or code.
- **Its schema is enum-bounded** (Pydantic, `extra="forbid"`). The Python
  service drops cities and rewrites not grounded in the query. NestJS
  re-validates every field against the taxonomy and the known-city list.
- **Its output can only add filters, and filters only narrow.** It cannot
  name an entity the caller may not see, change scope, or produce SQL. A
  test makes the AI claim "PROJECT" and a made-up city: the citizen still
  sees no projects and the city is dropped.

## 5. Abuse protection

| Endpoint | Limit (per user) |
| --- | --- |
| `GET /search`, `/search/problems`, `/organizations`, `/knowledge` (may embed and parse) | 30 / minute |
| `GET /search/projects` | 60 / minute |
| `GET /search/suggest` (indexed prefix only) | 120 / minute |
| AI query understanding | `SEARCH_AI_PARSE_PER_HOUR` (30) / hour, cached 24 h |

- **Work is bounded:**
  - at most 200 candidates per channel;
  - a 5° bounding box;
  - a 731-day custom range (analytics helpers);
  - a 12-term highlight;
  - an 8-second AI timeout.
- **Pathological queries** (200 characters of common words, every filter)
  are tested to stay bounded.

## 6. Privacy

- **Recent searches.**
  - **Bounds:** at most 10 per user, expiring 30 days after the last search.
  - **Never stored:** keystrokes or suggestion requests, and anything that
    looks personal (email, 8+ digit number, PAN-like code).
  - **Clearable** at any time (`DELETE /search/recent`).
- **Telemetry** holds daily counters only, with no query text and no user,
  and is visible to administrators only.
- **Logs** record counts and intent, never query text.
- **Location.** "Near me" is rounded to ~100 m in the browser; results give
  rounded distances, never coordinates.

## 7. Tested (e2e, real database)

- **Hidden records:** drafts never appear; rejected reports only when asked
  for.
- **Organisations:** suspended ones never appear.
- **Knowledge:** an organisation's private source is invisible to a citizen
  and visible to its member, and project knowledge needs participation.
- **Projects:** visible only to the assigned organisation and the
  jurisdiction's office, never to another office, another organisation or
  a citizen.
- **Office narrowing:** a citizen gets 403, another office 404.
- **Cursors:** a reused cursor is rejected, as is a tampered one.
- **Inputs and the AI:** malformed or unknown inputs give 400, and the AI
  cannot widen access.
- **Suggestions** obey the same policies and never call the AI.
- **Telemetry** never contains the query.
