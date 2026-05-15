## Project Notes

- Stack: SvelteKit 2, Svelte 5, TypeScript, Bun, Better Auth, Drizzle ORM, Cloudflare D1.
- Package manager: Bun. Prefer `bun install`, `bun run check`, and `bun run build`.
- Runtime target: Cloudflare Workers via `@sveltejs/adapter-cloudflare`.
- Desktop target: Tauri 2 under `src-tauri/`; frontend build for desktop uses `bun run build:tauri`.
- D1 binding name: `ai_pm_db`.
- Auth: Better Auth email/password in `src/lib/server/auth.ts`.
- Database schema: `src/lib/server/db/schema.ts`; generated auth tables live in `src/lib/server/db/auth.schema.ts`.
- Migrations: generated under `drizzle/` with `bun run db:generate`.
- Tauri window behavior is configured in `src-tauri/tauri.conf.json` and reinforced in `src-tauri/src/lib.rs`.

## Workflow

- After completing a user-requested code, configuration, or documentation change, commit it and push it unless the user explicitly says not to.
- Always push completed commits to the configured remote. Do not skip push because command output is noisy or includes warnings; only stop for an actual command failure, missing credentials, or a detected secret/artifact risk.
- Cloudflare deploys are an approved workflow step. For changes that affect the deployed Worker, routes, API behavior, Cloudflare config, or deployed frontend, run `bun run deploy:cloudflare` after verification unless the user explicitly says not to deploy.
- Keep each commit scoped to the completed change. Do not stage unrelated dirty files or generated output from earlier work.
- Before commit and push, inspect `git status`, `git diff --cached --name-only`, and the staged diff for secrets or accidental build artifacts.
- Use concise conventional commit messages.
- When the user gives a visual reference, preserve the intended text, labels, and workflow names unless they explicitly ask to rename them.
- When editing Svelte UI, prefer existing project patterns and use `shadcn-svelte` where it fits the requested interface.
- For Tauri clipboard features, ensure matching capability permissions are present in `src-tauri/capabilities/default.json`.
- Do not start a dev server for routine validation unless the user explicitly asks for one; build the desktop executable instead when a runnable app artifact is needed.

## Safety

- Do not commit `.env`, `.env.*` except intentional examples, `.wrangler/`, `.svelte-kit/`, `node_modules/`, or build output.
- Treat Cloudflare account IDs, D1 tokens, Better Auth secrets, and local database state as confidential.
- Before public pushes, inspect staged files with `git diff --cached --name-only` and scan for secret-like values.
- Do not revert unrelated user edits. If `AGENTS.md` or docs are already dirty, update them directly instead of resetting.

## Verification

- Run `bun run check` before committing source changes.
- Run `bun run build` for route, adapter, schema, or deployment-related changes.
- Run `cargo check` from `src-tauri/` for Rust/Tauri source changes.
- Run `bun tauri build --no-bundle` to produce a local desktop executable at `src-tauri/target/release/app.exe`; prefer this over starting a dev server.
- If `wrangler types --check` reports stale types, run `bun run gen`.
- If generated `.svelte-kit` output causes type noise, remove ignored `.svelte-kit/`, run `bun run gen`, and rerun checks.
- If `cargo` is installed but not on PATH in PowerShell, prepend `$env:USERPROFILE\.cargo\bin` for that shell.
