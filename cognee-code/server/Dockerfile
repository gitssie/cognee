FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_LINK_MODE=copy
ENV UV_PROJECT_ENVIRONMENT=/app/.venv

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    clang \
    gcc \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /root/workspace/github/cognee

COPY . .

WORKDIR /root/workspace/github/cognee/cognee-code/server

RUN --mount=type=cache,target=/root/.cache/uv \
    mkdir -p /app && \
    uv sync --frozen --no-dev --no-editable && \
    cp -a pyproject.toml uv.lock README.md src /app/

FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local /usr/local
COPY --from=builder /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    PYTHONUNBUFFERED=1 \
    COGNEE_SKIP_CONNECTION_TEST=true

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
