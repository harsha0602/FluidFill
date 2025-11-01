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
