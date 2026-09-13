# Samadhaan AI Service

FastAPI service that owns every model and provider interaction for the platform.
The NestJS API is its only client — see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Run

```bash
./scripts/dev.sh          # creates .venv on first run, then hot-reloads
```

Or manually:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001
```

## Verify

```bash
curl http://localhost:8001/health
```

Interactive docs at http://localhost:8001/docs (disabled when `NODE_ENV=production`).

## Test

```bash
.venv/bin/pytest       # tests
.venv/bin/ruff check . # lint
```

## Layout

| Path           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `app/main.py`  | App construction, middleware, error handlers                    |
| `app/api/`     | Routers and FastAPI dependencies                                |
| `app/core/`    | Settings, logging, constants, internal-token auth, taxonomy     |
| `app/prompts/` | System prompts, kept out of service code                        |
| `app/providers/`| Vision-language providers behind one interface                 |
| `app/schemas/` | Pydantic request/response contracts                             |
| `app/services/`| Business logic; one module per AI capability                    |
| `app/models/`  | Model loading and inference wrappers (empty until models land)  |
| `app/utils/`   | Small shared helpers                                            |

## Capabilities

| Endpoint | Capability | State |
| --- | --- | --- |
| `POST /analyze/problem` | Multimodal problem analysis | Implemented |

See [`docs/ML_PLAN.md`](../../docs/ML_PLAN.md) for the remaining systems and
their milestones.

## Providers

`LLM_PROVIDER` selects the implementation:

- `anthropic` — Claude vision. Requires `ANTHROPIC_API_KEY`. The factory refuses
  to build it without one; it does **not** fall back to a stub, because a
  fabricated analysis is worse than an absent one.
- `development` — a keyword-matching stub for working offline. Labels itself
  `development-keyword-stub`, reports low confidence, and the factory **refuses
  to build it when `NODE_ENV=production`**.

Adding a provider means one class implementing `VisionLanguageProvider` in
`app/providers/` and one line in `app/providers/factory.py`. Nothing else in the
pipeline — normalisation, calibration, the NestJS side — knows which provider
answered.

## Security

- The service is never reachable from a browser. NestJS is its only client.
- Every capability route requires the `x-internal-token` shared secret; health
  routes stay open so orchestrators can probe them.
- Images arrive **inlined as base64, never as URLs** — the service fetches no
  remote resource on a caller's behalf, which removes the SSRF surface.
- Provider API keys live only in this process and are never logged.
- Raw provider responses are never returned; failures are mapped to a structured
  `{ code, message, retryable }` body.
