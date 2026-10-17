# Incident response

A basic process for a small team. It does not assume a 24/7 security
operations centre. Audit: [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md).

## Severity policy

| Severity | Meaning | Samadhaan examples | Response target |
| --- | --- | --- | --- |
| **Critical** | Broad unauthorised access or control; data of many users exposed | Government-wide data access; authentication bypass; leaked JWT signing key; remote code execution | Start immediately; contain within hours |
| **High** | Unauthorised access across a tenant boundary, or a strong abuse path | Cross-organisation project or evidence access; one office reading another's jurisdiction; unauthenticated AI service reachable from the internet; a critical dependency advisory that is exploitable | Same day |
| **Medium** | Weakness that needs another condition, or a limited exposure | Missing security header; EXIF location in public photos; a reporter bypassing a workflow step; CSRF from a same-site origin | Within a sprint |
| **Low** | Defence-in-depth gap; minor information exposure | Verbose non-sensitive log; raw dependency error on `/health`; delayed effect of a role change | Planned |
| **Informational** | Observation or accepted risk | Fail-open rate limiting; dev-only tooling advisories | Record |

## Process

```
Detect → Contain → Investigate → Rotate / revoke → Fix → Verify → Document
```

1. **Detect.** Sources:
   - user or researcher reports;
   - error spikes in logs;
   - repeated `RATE_LIMITED`, refresh-token reuse warnings, or
     `IP-wide rate limit` warnings;
   - unexpected `ANALYTICS_EXPORTED` or `IMPACT_POINTS_ADJUSTED` audit
     entries;
   - dependency advisories.

   Record the time, the reporter and the first `requestId`.
2. **Contain.** Limit the damage first:
   - **Accounts:** suspend the affected accounts (set `status` to
     `SUSPENDED`; this takes effect on the next request) and revoke their
     sessions.
   - **Features:** disable the affected feature with its configuration flag
     (`*_ENABLED=false`, e.g. `RAG_ENABLED`, `ANALYTICS_INSIGHTS_ENABLED`,
     `SEARCH_AI_PARSE_ENABLED`) or remove the route from the proxy.
   - **AI provider:** if it is misbehaving, switch it off. Every AI feature
     degrades to a non-AI fallback.
3. **Investigate.** Follow the `requestId` across the API and AI service
   logs. Use `audit_logs` (append-only) to see who did what. Find the first
   exploited request, the affected records and the users concerned.
4. **Rotate / revoke** whatever may have leaked:

   | What leaked | Action |
   | --- | --- |
   | JWT key | Rotate `JWT_ACCESS_SECRET` (all access tokens die) and revoke all sessions |
   | AI token | Rotate the token on both sides |
   | Database or Redis passwords | Rotate them |
   | Provider API keys | Rotate them with the provider |
   | Committed secret | Purge it from history **after** rotating |

5. **Fix.** Patch the root cause. Add a regression test to the
   `security.e2e` / `security.spec` / `test_hardening` suites. Review for the
   same pattern elsewhere.
6. **Verify.** Run the full test suites. Reproduce the original exploit
   against the fix. Confirm the contained features are back and the
   monitoring is quiet.
7. **Document.** Write a short record: timeline, impact, root cause, fix,
   follow-ups. Update [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) and notify
   affected users where personal data was involved. Applicable law (for
   example, India's DPDP Act) may set notification duties; take legal advice.

## Useful levers

| Lever | Effect |
| --- | --- |
| `UPDATE users SET status='SUSPENDED'` | Blocks the account on its next request; refresh refused |
| `SessionService.revokeAllForUser` / revoke `sessions` rows | Signs the user out everywhere, immediately |
| Rotate `JWT_ACCESS_SECRET` | Invalidates every access token |
| `*_ENABLED=false` flags | Switch off AI, RAG, insights, AI search parsing and impact awarding |
| Rate-limit configuration | Tighten under attack (`AUTH_RATE_LIMIT_*`, `@UserRateLimit` buckets) |
| `audit_logs` | Append-only trail of government, allocation, verification, export and admin actions |

## Reporting a vulnerability

Contact the maintainers privately; do not open a public issue. Include the
steps to reproduce and the affected endpoint. We acknowledge reports and keep
reporters informed until a fix ships.
