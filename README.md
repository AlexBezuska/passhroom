<h1>
  <img src="passhroom/assets/passhroom.png" alt="Passhroom logo" width="48" height="48" style="vertical-align: middle; margin-right: 8px;" />
  Passhroom
</h1>

*Because passwords SUCK!*

Self-hosted passwordless magic-link auth service.

## What this repo contains

- Passhroom API service (Node.js + TypeScript + Fastify)
- Postgres migrations
- CLI for client management (create/rotate/enable/disable + allowlists)
- Docker Compose template + Nginx templates for reverse proxy setups
- Public docs for design, authentication, and generic deployment

## Public quick start (self-host)

1) Copy env template:

`cp .env.example .env`

2) Edit `.env` and set required values:

- `PASSHROOM_DB_PASSWORD`
- `COOKIE_SECRET` (long random value)
- `PASSHROOM_PUBLIC_BASE_URL` (for example `https://auth.example.com`)
- SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)

3) Start services:

`docker compose -f docker-compose.passhroom.yml up -d --build`

4) Run migrations:

`docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"`

5) Verify health:

`curl -i -H 'x-forwarded-proto: https' http://127.0.0.1:18080/healthz`

## Optional private submodule (maintainers only)

This repo supports an optional private operations docs submodule at `servertron-docs`.

- Public users can skip submodule initialization entirely.
- Maintainers can initialize it with:

`git submodule update --init -- servertron-docs`

The submodule contains private infrastructure and server automation material that is intentionally not required for building, testing, running, or self-hosting Passhroom.

Maintainer note:

- Private deploy scripts live at `servertron-docs/apps/passhroom/scripts/`.
- Public repo wrappers in `scripts/deploy-host/` delegate to those scripts so existing commands continue to work for maintainers.

## Documentation

- Architecture/design: `docs/design.md`
- Auth flow and security model: `docs/authentication.md`
- Generic deployment notes: `docs/deployment.md`
- App integration examples: `docs/pashroom-app-integration-guide.md`
- Legacy/private host automation notes: `servertron-docs/apps/passhroom/README.md` (maintainers only)

## Admin dashboard

Passhroom includes an admin-only dashboard for viewing users and testing auth flow endpoints.

- Enable in `.env`: `ADMIN_ENABLED=true`
- Visit: `https://<your-domain>/admin/login`

## Env vars

Compose reads env vars from root `.env` (copy from `.env.example`).

- Required:
  - `PASSHROOM_DB_PASSWORD`
  - `COOKIE_SECRET`
  - `PASSHROOM_PUBLIC_BASE_URL`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Recommended in production:
  - `NODE_ENV=production`
  - `REQUIRE_HTTPS=true`

## Client management (CLI)

Run from inside the API container (or locally with `DATABASE_URL` configured):

- Create client:

`node dist/cli.js clients:create --client-id myapp --redirect-uri https://myapp.com/auth/callback --allowed-origin https://myapp.com`

- Rotate secret:

`node dist/cli.js clients:rotate-secret --client-id myapp`

## Minimal curl examples

### Start login

`curl -X POST https://auth.example.com/v1/auth/start \
  -H 'content-type: application/json' \
  -d '{"client_id":"myapp","email":"me@example.com","redirect_uri":"https://myapp.com/auth/callback","state":"opaque-csrf"}'`

### Code exchange

`curl -X POST https://auth.example.com/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"client_id":"myapp","client_secret":"<secret>","code":"<code>","redirect_uri":"https://myapp.com/auth/callback"}'`

## Security notes

- Tokens/codes are generated with CSPRNG and only hashes are stored.
- Redirect URIs are exact-match allowlisted per client.
- Keep `.env` private; it is intentionally gitignored.
- Configure SPF/DKIM/DMARC for your sender domain.

## License

MIT (see LICENSE).
