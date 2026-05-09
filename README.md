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

## Public Repository Hygiene

This repository is intended to be public. Keep these out of commits:

- `.env` and non-example env files
- `.wrangler/`
- `.svelte-kit/`
- `node_modules/`
- Local databases, logs, and generated build output
