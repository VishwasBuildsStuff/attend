# Cloudflare deployment

BunkBudget can serve both its static frontend and FastAPI API from one
Cloudflare Python Worker, with Neon for PostgreSQL. Wrangler's `ASSETS` binding
serves the generated frontend files after the API routes have been checked.
Deploy the Python Worker with `pywrangler` rather than the JavaScript-only
`wrangler deploy` command.

## One-time Neon setup

1. In the Neon SQL Editor, select the branch used by BunkBudget and run
   [`scripts/cloudflare-neon-migration.sql`](scripts/cloudflare-neon-migration.sql).
   It creates `pgcrypto` and applies the app's tables/indexes without deleting
   existing attendance or user rows.
2. In Cloudflare, create a Hyperdrive configuration for that Neon database.
   Enter the connection string directly in Cloudflare; do not put it in Git or
   paste it into a chat. Copy the Hyperdrive configuration ID.
3. Confirm the `HYPERDRIVE` ID in `wrangler.jsonc` matches the configuration
   you created. A Hyperdrive configuration ID is a reference, not the database
   connection string or password.
4. In the `attend` Worker settings, add `SECRET_KEY` as a secret and set
   `ADMIN_EMAIL` to the single owner email. `JWT_ALGORITHM` is already set to
   `HS256` in `wrangler.jsonc`.

## Deploy the Worker

The GitHub repository's Workers Build settings should use:

- Root directory: `/`
- Build command: `uv sync && npm ci && npm run build:worker`
- Deploy command: `uv run pywrangler deploy`

The build creates `dist/` for the Worker's static assets without a Netlify-only
`_redirects` file. This replaces the
previous `npx wrangler deploy` command, which deployed a generic Worker rather
than the Python ASGI app. The Worker URL is
`https://attend.vishwasbnglr2024.workers.dev`; its health endpoint is
`https://attend.vishwasbnglr2024.workers.dev/api/health`.

## Optional: keep Netlify as the frontend

If the frontend is served from Netlify instead, set `BUNKBUDGET_API_URL` to the
Worker origin without a trailing slash:

```text
https://attend.vishwasbnglr2024.workers.dev
```

Then redeploy Netlify. The generated Netlify rewrite forwards its same-origin
`/api` requests to the Worker. If the frontend is served by the Worker itself,
no Netlify API proxy setting is needed.

## Runtime notes

- Passwords continue to use bcrypt cost 12. Hashing and verification run in
  Neon with `pgcrypto`, keeping the expensive bcrypt work off the Worker's CPU
  budget and remaining compatible with existing bcrypt user hashes.
- Cloudflare Workers Free has a 10 ms CPU limit per request and Hyperdrive's
  Free allowance is 100,000 database statements per day. Python/FastAPI request
  overhead still needs to stay within the CPU limit; check Worker metrics after
  deployment. The Paid Workers plan has a higher configurable CPU allowance.
- Apply database schema changes using an explicit SQL migration. The API no
  longer creates or alters tables on Worker startup.
- Local Uvicorn development still reads `DATABASE_URL` and `SECRET_KEY` from
  `.env`; the Cloudflare Worker reads `HYPERDRIVE`, `SECRET_KEY`, and
  `ADMIN_EMAIL` from request bindings.
