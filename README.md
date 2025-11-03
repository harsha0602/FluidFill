# FluidFill

## Overview
FluidFill streamlines the way teams prepare repeatable legal and fundraising paperwork. Upload a `.docx`, the FastAPI document service detects placeholders, and the Express API gateway stores schemas plus partially filled answers in PostgreSQL. A React/Next.js UI lets operators review suggestions, reconcile values, and download a freshly rendered document that stays stylistically faithful to the source template.

## Demo
[Demo video – coming soon](https://example.com/your-demo-url)

## Tech Stack
| Layer | Tech | Versions / Constraints | Notes |
| --- | --- | --- | --- |
| Web UI | Next.js 14.2, React 18.3, TypeScript, Tailwind CSS | Node `>=18.17 <21`, pnpm `9.x` | Customer-facing interface for upload, review, and filling workflows. |
| API gateway (`apps/api-gw`) | Express 4, Multer, pg, tsx, TypeScript 5.4 | Same Node constraint as above | Orchestrates uploads, persists schemas/answers, migrates PostgreSQL. |
| Doc service (`apps/doc-service`) | Python 3.11, FastAPI 0.111, Uvicorn 0.30, python-docx, Google AI Studio SDK | Python `3.11.x` | Parses placeholders, renders filled `.docx`, proxies AI-powered schema extraction. |
| Database | PostgreSQL 15+ | Docker or local install | Stores documents, schemas, and answer sets. |
| Tooling & Ops | Docker 24+, Render Blueprint (`render.yaml`), dotenv |  | Container images and Infrastructure-as-code deployment pipeline. |

## Local Development Setup

### Prerequisites
- Node.js `18.17 – 20.x`
- pnpm `9.12` (see `packageManager` in `package.json`)
- Python `3.11.x` with `venv`
- Docker Desktop 24+ (for running PostgreSQL locally) or a native PostgreSQL 15+ installation
- Make sure `psql` is on your PATH for applying migrations

### Base Environment
```bash
cp .env.example .env
```
Populate `.env` with the endpoints you expect during development:
```bash
NEXT_PUBLIC_API_BASE=http://localhost:4000
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgres://fluidfill:fluidfill@localhost:5432/fluidfill
DOC_SERVICE_URL=http://localhost:5001
AI_STUDIO_MODEL=gemini-2.5-flash
AI_STUDIO_API_KEY=<your-gemini-key>   # optional; required for /schema
```

### Database (PostgreSQL)
1. Start a dev database (Docker example):
   ```bash
   docker run --name fluidfill-db \
     -e POSTGRES_DB=fluidfill \
     -e POSTGRES_USER=fluidfill \
     -e POSTGRES_PASSWORD=fluidfill \
     -p 5432:5432 \
     -d postgres:15
   ```
2. Apply migrations from the API gateway:
   ```bash
   cd apps/api-gw
   pnpm install
   DATABASE_URL=postgres://fluidfill:fluidfill@localhost:5432/fluidfill pnpm migrate
   ```

### Doc Service (`apps/doc-service`)
1. Create a virtualenv and install dependencies:
   ```bash
   cd apps/doc-service
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install -e .
   ```
2. Run the FastAPI server:
   ```bash
   export AI_STUDIO_API_KEY=your-gemini-key   # optional unless calling /schema
   uvicorn app.main:app --reload --host 0.0.0.0 --port 5001
   ```
   The health check is available at `http://localhost:5001/health`.

### API Gateway (`apps/api-gw`)
1. Install dependencies and start the watcher:
   ```bash
   cd apps/api-gw
   pnpm install
   pnpm dev
   ```
2. Required environment variables (read from the repo root `.env`):
   - `DATABASE_URL` – Postgres connection string
   - `DOC_SERVICE_URL` – defaults to `http://localhost:5001`
   - `FRONTEND_ORIGIN` – allow-listed UI origin (`http://localhost:3000` for dev)
   - `PORT` – defaults to `4000`
3. Verify the gateway with `curl http://localhost:4000/api/health`.

### Web UI (`app/`, `components/`, `lib/`)
1. From the repository root:
   ```bash
   pnpm install
   pnpm dev
   ```
2. Open `http://localhost:3000` and confirm uploads proxy through `NEXT_PUBLIC_API_BASE`.

## Ports (Local Defaults)
| Service | Port | Source |
| --- | --- | --- |
| Next.js web UI | 3000 | `pnpm dev` in repo root |
| API gateway | 4000 | `PORT` env / defaults in `apps/api-gw/src/index.ts` |
| Doc service | 5001 | `uvicorn` started with `--port 5001` |
| PostgreSQL | 5432 | Docker example above |

## Repository Structure
```text
FluidFill/
├─ app/                  # Next.js App Router pages, layouts, API routes
├─ apps/
│  ├─ api-gw/            # Express gateway for uploads, schema storage, migrations
│  └─ doc-service/       # FastAPI document parsing & rendering microservice
├─ components/           # Reusable client-side UI primitives
├─ db/
│  └─ migrations/        # Ordered PostgreSQL schema migrations
├─ lib/                  # Frontend utilities and API clients
├─ public/               # Static assets served by Next.js
├─ uploads/              # Scratch space for uploaded docs during development
├─ render.yaml           # Render Blueprint (API + doc service + Postgres)
└─ ...
```

## If I Had a Bit More Time

**Tech hardening**
- Replace AI Studio with OpenAI API for better output quality and tooling; keep a provider interface so either can be swapped.
- Move from Render free tier to GCP/AWS/Railway to cut cold starts and latency; wire proper observability (structured logs, traces, error rates).
- Add robust retries and circuit breakers on AI calls; cache schemas server-side by doc hash to control LLM cost.

**Functionality**
- Integrate Supermemory.ai for intelligent cross-document memory: auto-suggest known company/investor details, recall prior governing-law defaults, and provide persistent user/org-level context across sessions.
- AI-assisted placeholder extraction (not just regex). Use a lightweight model to propose spans + types.
- Live preview filling — update left pane as you type (currently supported by API, just wire a debounce).
- Pre-download verification step with inline edits (single pass before generating the `.docx`).
- Multi-format support: PDF (via docx→pdf or direct), TXT, and templated HTML.
- batch doc upload and edits
- Context block: 500-word doc summary + filling guide; generated once and cached per document.
- Field validation rules from AI (email/date/number constraints) and cross-field checks.

**UX polish**
- Two-pane smart editor with sticky group nav, search, and required-field counters.
- Navigation between docs per user during batch mode
- Toasts, optimistic save states, and resume-progress banners.
