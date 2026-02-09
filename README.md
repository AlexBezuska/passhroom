<h1>
  <img src="passhroom/assets/passhroom.png" alt="Passhroom logo" width="48" height="48" style="vertical-align: middle; margin-right: 8px;" />
  Passhroom
</h1>

*Because passwords SUCK!*


Self-hosted passwordless magic-link auth service.

Created by fufroom (Alex Bezuska).

## What this repo contains

- Passhroom API service (Node.js + TypeScript + Fastify)
- Postgres migrations
- CLI for client management (create/rotate/enable/disable + allowlists)
- Docker Compose template + Nginx vhost snippet

## Setup

1) Create an external docker network for your existing nginx container (if you don't already have one):

`docker network create web`

2) Create a `.env` at repo root:

- Copy `.env.example` to `.env` and fill it in.
- `cp .env.example .env`
- Required:
  - `PASSHROOM_DB_PASSWORD=...`
  - `COOKIE_SECRET=...` (long random string)
  - `PASSHROOM_PUBLIC_BASE_URL=...`
  - SMTP env vars (see below)

3) Start services:

`docker compose -f docker-compose.passhroom.yml up -d --build`

4) Run migrations:

`docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"`

## Rsync deploy (no git needed on server)

From your dev machine (where this repo is):

- Sync files only:

`scripts/deploy-host/rsync-deploy.sh`

- Sync and also run remote `docker compose up -d --build`:

`scripts/deploy-host/rsync-deploy.sh --run-remote`

- If the server does not have an env file yet, bootstrap it once (creates a template .env on the server):

`scripts/deploy-host/rsync-deploy.sh --bootstrap-env`

If the server uses a non-default SSH port:

`DEPLOY_SSH_PORT=2222 scripts/deploy-host/rsync-deploy.sh --run-remote`

Server layout + nginx/certbot details:

- docs/webserver-deploy.md

## Admin dashboard (black + magenta)

Passhroom now includes a small admin-only dashboard to:

- view all signed-up emails (from the `users` table)
- test the auth flow by calling the real `/v1/auth/start` and `/v1/auth/token` endpoints

### Configure

- Set these in your root `.env` (used by compose):
  - `COOKIE_SECRET` (required)
  - `ADMIN_ENABLED=true`

### Migrate

This feature adds two DB tables: `admin_login_requests` and `admin_sessions`.

- Run migrations on the server (from inside the API container):
  - `docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"`

### Use

## License

MIT (see LICENSE).

- Visit: `https://passhroom.example.com/admin/login`
- Enter the admin email and click “Send magic link”
- After clicking the link in the email, you’ll land on: `/admin/`

## Webserver notes

See: docs/webserver-deploy.md

## Env vars

Compose reads env vars from the repo root `.env` (copy from `.env.example`).

- Required:
  - `PASSHROOM_DB_PASSWORD`
  - `COOKIE_SECRET`
  - `PASSHROOM_PUBLIC_BASE_URL`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`

Deliverability: configure SPF/DKIM/DMARC for the `SMTP_FROM` domain.

## Client management (CLI)

Run from inside the api container (or locally with `DATABASE_URL` configured):

- Create:

`node dist/cli.js clients:create --client-id myapp --redirect-uri https://myapp.com/auth/callback --allowed-origin https://myapp.com`

- Rotate secret:

`node dist/cli.js clients:rotate-secret --client-id myapp`

## Minimal curl examples

### Start login

`curl -X POST https://passhroom.example.com/v1/auth/start \
  -H 'content-type: application/json' \
  -d '{"client_id":"myapp","email":"me@example.com","redirect_uri":"https://myapp.com/auth/callback","state":"opaque-csrf"}'`

### Code exchange

`curl -X POST https://passhroom.example.com/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"client_id":"myapp","client_secret":"<secret>","code":"<code>","redirect_uri":"https://myapp.com/auth/callback"}'`

## Notes

- Tokens/codes are generated with CSPRNG and only hashes are stored.
- Redirect URIs are exact-match allowlisted per client.
