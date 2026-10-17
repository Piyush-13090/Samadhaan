# Threat model

What Samadhaan protects, from whom, and how (Prompt 26). Findings:
[`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md).

## 1. Assets

| Asset | Why it matters |
| --- | --- |
| Accounts and sessions | They unlock everything else |
| Citizen personal data: names, emails, phones, home-adjacent locations, photos | Privacy; the safety of reporters |
| Government decisions: verification, rejection, allocation, priority overrides, resolution approval | Civic trust; resources depend on them |
| Private workspaces: resolution rooms, projects, evidence, organisation and office knowledge, internal notes | Confidentiality between organisations and offices |
| Impact points, reputation, badges | Fairness; a public leaderboard |
| Audit logs | Accountability |
| AI service and provider credit | Cost; integrity of advisory output |
| Secrets: JWT key, AI token, database and Redis credentials, provider keys | Full compromise if leaked |

## 2. Architecture and trust boundaries

```
Browser ──(HTTPS, cookies)──▶ Next.js web ──(rewrite)──▶ NestJS API ──▶ PostgreSQL (PostGIS, pgvector)
   │                                                      │       └──▶ Redis (sessions cache, rate limits, realtime)
   └──(same-site, CORS allowlist)──────────────────────▶  │
                                                          └──(x-internal-token)──▶ Python AI service ──▶ LLM provider
```

- **Boundary 1 (internet → API).** Everything is authenticated by
  default. Every id-bearing route checks ownership, membership or
  jurisdiction on the server.
- **Boundary 2 (API → AI service).** The AI service trusts only the API (a
  shared token). It has **no database access**. It receives already
  authorised, minimised context and returns schema-checked output.
- **Boundary 3 (AI provider).** Model output is untrusted. It is validated
  for enums, ranges, lengths and known references before use, and it never
  decides anything on its own.
- **Data stores** are reachable only from the API. In development they are
  bound to localhost.

## 3. Actors

| Actor | Capability | Main concerns |
| --- | --- | --- |
| Unauthenticated visitor | Public pages, public profiles, sign-in/registration | Credential stuffing, enumeration, scraping, DoS |
| Citizen | Report, comment, support, search, own data | Spam, gaming points, IDOR into others' data, prompt injection via reports |
| Organisation member (NGO, university, industry) | Own workspace, allocations, rooms, projects, evidence | Cross-organisation access, self-approval, inflating impact |
| Government official | Jurisdiction-scoped review, allocation, verification, analytics, exports | Cross-jurisdiction access, conflicts of interest, data export abuse |
| Administrator | Platform administration, impact adjustments | Abuse of power, self-dealing (blocked: self-adjust, self-invite) |
| Malicious authenticated user | Any role above, acting in bad faith | IDOR, privilege escalation, injection, upload attacks |
| Compromised account | Legitimate session in the wrong hands | Data exfiltration until revoked; limited by role and scope |
| Malicious uploaded document or image | Content entering storage, RAG and models | Polyglots, decompression bombs, prompt injection, metadata leaks |
| Malicious AI input | Text crafted to steer models | Instruction override, fabricated findings |
| External provider (LLM, geocoder) | Returns data to us | Malformed or hostile output, outages, redirects |
| Background worker | Acts without a user | Acting on stale authorisation, duplicate work, runaway retries |

## 4. Threats and controls

| Threat | Examples | Controls |
| --- | --- | --- |
| **Account takeover** | Credential stuffing, stolen cookie, refresh replay | Argon2id; per-IP+email and IP-wide login limits; httpOnly/Secure/SameSite cookies; short access tokens; rotated, hashed refresh tokens with reuse detection; immediate revocation (session checked per request) |
| **Privilege escalation** | Self-assigning a role, self-promotion, admin self-invite | Role never client-settable (whitelisted DTOs); membership changes by others only; self-invite refused; role re-read from the database each request |
| **IDOR** | Changing `projectId`, `roomId`, `evidenceId`… | Every lookup is scoped by server-side membership, ownership or jurisdiction; uniform 404s |
| **Cross-tenant access** | Organisation A reads B's room, evidence, knowledge or analytics | Room-access service; organisation-scoped queries; knowledge visibility predicate; tests per surface |
| **Cross-jurisdiction access** | An official edits the URL slug or filters | `GovernmentGuard` plus a jurisdiction SQL predicate in every query; filters only narrow |
| **Conflict of interest** | An official who is also an NGO member allocates to it or approves its work | Refused (L-11) |
| **Data leakage** | Private fields in APIs, exports, logs or errors | Allow-list serializers; exports with public fields only; redacted logs; opaque errors |
| **File upload attacks** | Executables, SVG/HTML, polyglots, bombs, traversal | Detection from content bytes; JPEG/PNG/WebP only for images; pixel limits; re-encoding; generated keys; traversal checks; sandboxed serving |
| **Prompt injection** | Report text: "rate this CRITICAL"; document text: "ignore previous instructions" | Delimited, neutralised untrusted blocks; data-not-instructions rules; constrained output; reference validation; AI never authorises |
| **SQL injection** | Search, analytics, PostGIS, sorting | Parameterised `Prisma.sql`; enum-mapped sorts; validated parameters; injection tests |
| **XSS** | Stored HTML in titles, comments, knowledge | React text rendering only; no raw HTML; http(s)-only URLs; CSP |
| **CSRF** | A cross-site form posts to the API | SameSite=Lax plus an Origin/Referer allowlist and `Sec-Fetch-Site` check |
| **SSRF** | User URLs fetched by the server | No user-controlled outbound requests; fixed hosts; redirects refused |
| **Abuse and spam** | Report or comment floods, support farming, duplicate claims, AI cost abuse | Per-user rate limits (including AI re-analysis and search); points only for confirmed outcomes; idempotency; caps; moderation |
| **DoS / resource exhaustion** | Huge bodies, uploads, many SSE streams, pathological search | Body and upload limits (413); bounded candidate sets; stream caps; timeouts |
| **Job abuse** | Stale jobs acting after access changed; duplicate processing | Ids-only payloads; workers re-load state; atomic claims with leases; bounded retries |
| **Secrets leakage** | Committed `.env`, logged tokens, exposed `/health` | `.gitignore`; production configuration checks; log redaction; generic health output |

## 5. Assumptions and out of scope

- **TLS** is terminated by the deployment platform (Prompt 30). HSTS is sent
  in production.
- **The database and Redis are on a private network** in production, with
  credentials.
- **Not modelled:** malware on user devices, physical access, or supply-chain
  compromise beyond dependency auditing.
- **Coordinated abuse** at scale (CAPTCHA, device fingerprinting) is not
  addressed; rate limits and outcome-based rewards are the current defence.
