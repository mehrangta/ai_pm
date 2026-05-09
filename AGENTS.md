## Project Notes

- Stack: SvelteKit 2, Svelte 5, TypeScript, Bun, Better Auth, Drizzle ORM, Cloudflare D1.
- Package manager: Bun. Prefer `bun install`, `bun run check`, and `bun run build`.
- Runtime target: Cloudflare Workers via `@sveltejs/adapter-cloudflare`.
- D1 binding name: `ai_pm_db`.
- Auth: Better Auth email/password in `src/lib/server/auth.ts`.
- Database schema: `src/lib/server/db/schema.ts`; generated auth tables live in `src/lib/server/db/auth.schema.ts`.
- Migrations: generated under `drizzle/` with `bun run db:generate`.

## Safety

- Do not commit `.env`, `.env.*` except intentional examples, `.wrangler/`, `.svelte-kit/`, `node_modules/`, or build output.
- Treat Cloudflare account IDs, D1 tokens, Better Auth secrets, and local database state as confidential.
- Before public pushes, inspect staged files with `git diff --cached --name-only` and scan for secret-like values.
- Do not revert unrelated user edits. If `AGENTS.md` or docs are already dirty, update them directly instead of resetting.

## Verification

- Run `bun run check` before committing source changes.
- Run `bun run build` for route, adapter, schema, or deployment-related changes.
- If `wrangler types --check` reports stale types, run `bun run gen`.
- If generated `.svelte-kit` output causes type noise, remove ignored `.svelte-kit/`, run `bun run gen`, and rerun checks.
