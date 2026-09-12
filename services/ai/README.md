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
uvicorn app.main:app --reload --port 8000
```

## Verify

```bash
curl http://localhost:8000/health
```

Interactive docs at http://localhost:8000/docs (disabled when `NODE_ENV=production`).

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
| `app/core/`    | Settings, logging, constants, internal-token auth               |
| `app/schemas/` | Pydantic request/response contracts                             |
| `app/services/`| Business logic; one module per AI capability                    |
| `app/models/`  | Model loading and inference wrappers (empty until models land)  |
| `app/utils/`   | Small shared helpers                                            |

No AI capability is implemented yet — see [`docs/ML_PLAN.md`](../../docs/ML_PLAN.md)
for the planned systems and their milestones.
