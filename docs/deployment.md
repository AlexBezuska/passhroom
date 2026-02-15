# Deployment (Generic Self-Host)

## Prerequisites

- Docker + Docker Compose
- Public domain for Passhroom (for HTTPS + email links)
- SMTP provider credentials
- Reverse proxy that terminates TLS and forwards to Passhroom

## 1) Configure environment

Copy and edit:

```sh
cp .env.example .env
```

Required minimum:
- `PASSHROOM_DB_PASSWORD`
- `COOKIE_SECRET`
- `PASSHROOM_PUBLIC_BASE_URL` (for example `https://auth.example.com`)
- SMTP values (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)

Recommended production values:
- `NODE_ENV=production`
- `REQUIRE_HTTPS=true`

## 2) Start services

```sh
docker compose -f docker-compose.passhroom.yml up -d --build
```

## 3) Run migrations

```sh
docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"
```

## 4) Reverse proxy routing

Route `https://<your-domain>` to Passhroom API at the compose published endpoint (default `127.0.0.1:18080`).

Proxy requirements:
- preserve host and forwarding headers
- send `x-forwarded-proto: https` when TLS is terminated upstream

## 5) Verify

Health check (direct):

```sh
curl -i -H 'x-forwarded-proto: https' http://127.0.0.1:18080/healthz
```

Public check (through proxy):

```sh
curl -i https://<your-domain>/healthz
```

## Maintenance

- Back up Postgres regularly
- Rotate SMTP and client secrets
- Keep dependencies and base images updated
- Monitor logs and rate-limit metrics

## Notes for Maintainers

Private infrastructure automation is intentionally optional and lives outside public runtime requirements. If you maintain the upstream environment, initialize `servertron-docs` only when needed:

```sh
git submodule update --init -- servertron-docs
```