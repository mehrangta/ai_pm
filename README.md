# AI PM

AI PM is a logged-in kanban workspace built with SvelteKit, Better Auth, Drizzle ORM, and Cloudflare D1.

## Features

- Email/password registration, login, and logout
- Private user-owned boards
- Board create, rename, and delete
- Column create, rename, recolor, delete, and drag reorder
- Text card create, edit, recolor, delete, reorder, and cross-column drag
- Pasted image cards compressed in-browser and stored in D1 as data URLs
- Image copy control with browser clipboard support and a fallback opener

## Stack

- SvelteKit 2 and Svelte 5
- Bun
- Better Auth
- Drizzle ORM
- Cloudflare Workers and D1
- `svelte-dnd-action`

## Setup

Install dependencies:

```sh
bun install
```

Create `.env` from `.env.example` and fill in local/private values:

```sh
cp .env.example .env
```

Required environment values include:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_DATABASE_ID`
- `CLOUDFLARE_D1_TOKEN`
- `ORIGIN`
- `BETTER_AUTH_SECRET`

Do not commit `.env` or real secrets.

## Development

Generate Cloudflare Worker types when configuration changes:

```sh
bun run gen
```

Start the development server:

```sh
bun run dev
```

Start the Cloudflare Worker locally:

```sh
bun run worker:dev
```

For Tauri development, point the SPA at a deployed Cloudflare API:

```sh
PUBLIC_API_BASE_URL="https://your-worker.example.com" bun run tauri:dev
```

For local desktop testing, keep `PUBLIC_API_BASE_URL` and `ORIGIN` pointed at the local Worker URL, usually `http://localhost:4173`, and keep `bun run worker:dev` running.

The Tauri app uses the static SvelteKit build from `build/`; Cloudflare Worker dev or the deployed Worker remains the API host.

## Cloudflare Worker

This app is configured for Cloudflare Workers in `wrangler.jsonc` with the D1 binding `ai_pm_db`.
The checked-in `wrangler.jsonc` intentionally uses public-safe placeholder values.

For real deployments, keep your account-specific Worker URL and D1 database id in `wrangler.local.jsonc`.
That file is ignored by git. Create it from the template and replace the placeholders:

```sh
cp wrangler.jsonc wrangler.local.jsonc
```

Deploy the Worker:

```sh
bun run deploy:cloudflare
```

The deploy and local Worker scripts use `wrangler.local.jsonc`.

The Cloudflare API token used by Wrangler must be able to edit Workers, read account metadata, and access the configured D1 database. A D1-only token is not enough to deploy the Worker.

After the Worker is deployed, set the desktop API target to the Worker URL:

```sh
PUBLIC_API_BASE_URL="https://your-worker.workers.dev"
ORIGIN="https://your-worker.workers.dev"
```

Then rebuild the desktop app:

```sh
bun run tauri:build
```

## Database

The Drizzle schema is in `src/lib/server/db/schema.ts`.

Generate migrations:

```sh
bun run db:generate
```

Apply migrations through the configured Drizzle/Cloudflare workflow:

```sh
bun run db:migrate
```

Remote D1 migration application should be an explicit deployment step.

## Verification

Run source checks:

```sh
bun run check
```

Build for production:

```sh
bun run build
```

The build targets Cloudflare Workers through `@sveltejs/adapter-cloudflare`.

Build the Tauri frontend bundle:

```sh
bun run build:tauri
```

Build the desktop app:

```sh
bun run tauri:build
```

## Public Repository Hygiene

This repository is intended to be public. Keep these out of commits:

- `.env` and non-example env files
- `wrangler.local.jsonc`
- `.wrangler/`
- `.svelte-kit/`
- `node_modules/`
- Local databases, logs, and generated build output
