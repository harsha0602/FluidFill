# syntax=docker/dockerfile:1

FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install --no-install-recommends -y build-essential curl \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
RUN mkdir -p "$RUSTUP_HOME" "$CARGO_HOME"
ENV PATH=$CARGO_HOME/bin:$PATH
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

COPY pyproject.toml ./
COPY app ./app

RUN pip install --upgrade pip \
  && pip install --no-cache-dir -e .

EXPOSE 5001

ENV PORT=5001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5001}"]
