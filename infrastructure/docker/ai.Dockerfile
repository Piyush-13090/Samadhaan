# syntax=docker/dockerfile:1.7
# Samadhaan AI service (FastAPI) — production image (Prompt 30).
#
#   docker build -f infrastructure/docker/ai.Dockerfile -t samadhaan/ai services/ai
#
# Build context: services/ai. CPU-only torch wheels (the CUDA build is several
# GB and unused). The embedding model is downloaded at build time by default
# (PRELOAD_EMBEDDING_MODEL=true), so a container starts without network
# access to Hugging Face and every replica serves the same model version.
# Model artifacts for registry models are NOT baked in: mount them read-only
# at ML_ARTIFACT_DIR (docs/MODEL_REGISTRY.md).

ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS runtime
ARG PRELOAD_EMBEDDING_MODEL=true
ARG EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/home/app/.cache/huggingface \
    NODE_ENV=production \
    AI_HOST=0.0.0.0 \
    AI_PORT=8001 \
    ML_ARTIFACT_DIR=/srv/ml_artifacts
RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
COPY app ./app
RUN mkdir -p /srv/ml_artifacts && chown -R app:app /srv
USER app
RUN if [ "$PRELOAD_EMBEDDING_MODEL" = "true" ]; then \
      python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')"; \
    fi
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health/live', timeout=2).status == 200 else 1)"
STOPSIGNAL SIGTERM
# One worker per container (the embedding model is loaded per process); scale
# with replicas. Graceful shutdown lets in-flight requests finish.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--timeout-graceful-shutdown", "30", "--proxy-headers"]
