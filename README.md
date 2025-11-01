# FluidFill

FluidFill is a Next.js 14 starter styled with a Lexsy-inspired palette. It ships with Tailwind CSS, a global Inter font, and placeholder layout primitives so you can immediately start iterating on product flows.

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start the development server:
   ```bash
   pnpm dev
   ```
3. Open <http://localhost:3000> to view the landing page.

## Static Export

- Build locally with `npm run build:static` (or `pnpm run build:static`) to generate the static `out/` folder.

## GitHub Pages Deployment

- Enable GitHub Pages under **Settings → Pages** and select **GitHub Actions** as the source.
- Pushes to `main` trigger the `Deploy to GitHub Pages` workflow, which exports the site and deploys it to `https://<USER>.github.io/<REPO_NAME>/`.
- Base path and assets automatically adjust in CI via `GITHUB_REPOSITORY`; local `npm run dev` continues to serve from `/`.
- For a custom domain, add `public/CNAME` and configure the domain within Pages settings after the first successful deploy.

## Deploying on Render

1. Create a Render Blueprint deploy using `render.yaml`. It provisions the `fluidfill-db` Postgres instance plus the `fluidfill-api` (Node) and `fluidfill-docs` (FastAPI) services. The first manual deploy seeds both services.
2. Set the `FRONTEND_ORIGIN` environment variable on the `fluidfill-api` service to your public web origin (for example `https://<user>.github.io/<repo>` or a custom domain). Render injects `DATABASE_URL` automatically; `DOC_SERVICE_URL` is linked to the FastAPI service.
3. Store the `OPENAI_API_KEY` on the `fluidfill-docs` service if you wire up schema generation, otherwise leave it empty.
4. In GitHub, add a repository secret `RENDER_API_KEY` containing a Render API token with Blueprint deploy permissions. The `.github/workflows/deploy-api.yaml` workflow triggers a blueprint deploy on every push to `main`.
5. Define a repository variable `NEXT_PUBLIC_API_BASE` that points to the public API URL (for example `https://fluidfill-api.onrender.com`). The GitHub Pages workflow injects this at build time.
6. For local work, copy `.env.example` to `.env` and set `FRONTEND_ORIGIN=http://localhost:3000` so the API gateway accepts requests from the Next.js dev server.

## Tech Stack

- Next.js 14 (App Router, TypeScript)
- React 18
- Tailwind CSS 3
- ESLint (Next.js core web vitals)

## Project Structure

- `app/` – App Router routes, global layout, styles.
- `components/` – Shared UI primitives including the TopBar and Footer placeholders.
- `tailwind.config.ts` – Tailwind configuration with FluidFill theme tokens.

## Theming

- Background: `#1a1b1f`
- Primary: `#9d76dd`
- Text: `#f4f4f5`

Global typography uses the Inter typeface via `next/font`. Update the Tailwind theme tokens in `tailwind.config.ts` to extend the palette further as needed.
