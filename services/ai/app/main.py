"""Samadhaan AI service.

Owns every model and provider interaction for the platform. The NestJS API is
its only client; the browser never reaches it directly.

Run standalone:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.constants import REQUEST_ID_HEADER, SERVICE_NAME, SERVICE_VERSION
from app.core.logging import configure_logging, get_logger
from app.schemas.common import ErrorResponse

settings = get_settings()
configure_logging(settings)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hook.

    Model loading and provider client construction belong here, so they happen
    once per process rather than per request.
    """
    logger.info(
        "ai_service_starting",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        environment=settings.environment,
        internal_token_enforced=bool(settings.internal_token),
    )
    yield
    logger.info("ai_service_stopping")


app = FastAPI(
    title="Samadhaan AI Service",
    description="Multimodal civic problem understanding for the Samadhaan platform",
    version=SERVICE_VERSION,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Normally empty: traffic should arrive from the NestJS API (server to server,
# where CORS does not apply), not from a browser.
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def request_context(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Binds the correlation id sent by the API to every log line in this
    request, and echoes it back so the trace stays joinable."""
    request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)

    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            code="VALIDATION_FAILED",
            message="Request validation failed",
            detail=str(exc.errors()),
        ).model_dump(),
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Normalises aborts into the error envelope.

    A handler that raised with a structured `detail` (the analysis endpoint
    does, to carry `code` and `retryable`) has that shape preserved. Stringifying
    it would cost the caller the retry signal it needs to decide whether trying
    again could ever help.
    """
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)

    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(code="HTTP_ERROR", message=str(exc.detail)).model_dump(),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """Logs the real cause, returns an opaque message — internals must not leak."""
    logger.exception("unhandled_error", error=str(exc))
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            code="INTERNAL_ERROR",
            message="An unexpected error occurred",
        ).model_dump(),
    )


app.include_router(api_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "health": "/health"}
