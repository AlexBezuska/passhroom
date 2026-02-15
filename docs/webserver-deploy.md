# Web Services + Nginx Deployment Notes

This document describes a concrete deployment model for a single host so future services can be added and debugged consistently.

It is written for this environment:

- Host: `<server-host>`
- Primary container root: `<deploy-root>`
- Webserver stack root: `<deploy-root>/webserver/`

Tip:
- Keep your personal deploy-host values in an uncommitted config file:
  - copy `servertron-docs/apps/passhroom/.deploy.env.example` → `servertron-docs/apps/passhroom/.deploy.env`
  - edit `servertron-docs/apps/passhroom/.deploy.env`
- Nginx container name: `nginx_web`
- Certbot container name: `certbot`

If any of these change (different container names, different bind mounts, different compose layout), update this doc.

---

## 1) Directory Layout

### 1.1 Container project roots

- `<deploy-root>/`
  - General “home” for dockerized services.
- `<deploy-root>/webserver/`
  - The Nginx reverse proxy + certbot stack.

### 1.2 Nginx config and hosted files

The webserver repo uses a consistent convention:

- Hosted files (static sites) live under:
  - `<deploy-root>/webserver/site/<hostname>/`
- Nginx virtual host configs live under:
  - `<deploy-root>/webserver/nginx/conf.d/`
  - Example: `<deploy-root>/webserver/nginx/conf.d/<domain>.conf`

The `nginx_web` container bind-mounts these locations into:

- `/etc/nginx/conf.d`  (read-only)
- `/usr/share/nginx/html` (read-only, backing `root ...` sites)

---

## 2) Webserver Stack (Docker)

From:

- `<deploy-root>/webserver/docker-compose.yml`

Core containers:

- `nginx_web` (image `nginx:stable-alpine`)
- `certbot` (image `certbot/certbot`)

### 2.1 Important mount paths (this matters for TLS)

The containers share certificate storage via a host bind mount:

- Host: `<deploy-root>/webserver/nginx/certs`

Mounted as:

- In `nginx_web`: `/etc/nginx/certs`
- In `certbot`: `/etc/letsencrypt`

Key implication:

- Inside **Nginx**, certs live at `/etc/nginx/certs/live/<domain>/...`
- Inside **Certbot**, the same files live at `/etc/letsencrypt/live/<domain>/...`

If you run certbot commands, use `--config-dir /etc/letsencrypt` (not `/etc/nginx/certs`).

### 2.2 ACME (HTTP-01) webroot

The webroot for challenges is shared as:

- In `nginx_web`: `/var/www/certbot` (read-only)
- In `certbot`: `/var/www/certbot` (read-write)

Nginx vhosts should include:

- `location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; ... }`

---

## 3) Nginx Virtual Host Pattern (Recommended)

Most sites follow a 2-block pattern:

1) HTTP (port 80)
- Serves ACME challenge
- Redirects everything else to HTTPS

2) HTTPS (port 443)
- `listen 443 ssl;` and `http2 on;`
- references cert files

Example TLS paths (inside `nginx_web`):

- `ssl_certificate /etc/nginx/certs/live/<domain>/fullchain.pem;`
- `ssl_certificate_key /etc/nginx/certs/live/<domain>/privkey.pem;`

---

## 4) Networking Reality: Nginx is on `host` network

`nginx_web` is attached to Docker’s `host` network.

That means:

- Nginx **cannot use Docker service DNS** names like `passhroom-api`.
- Nginx must proxy to something reachable from the host network:
  - `127.0.0.1:<port>` (published ports)
  - or a real LAN IP

So for internal services that live in other compose projects, the most reliable approach is:

- Publish the service on localhost only, e.g. `127.0.0.1:18080:8080`
- Configure Nginx upstream as `proxy_pass http://127.0.0.1:18080;`

This avoids cross-compose networking pitfalls.

---

## 5) Passhroom Deployment Model (example)

### 5.1 Paths

Passhroom is deployed into:

- `<deploy-root>/passhroom/`
  - `docker-compose.yml`
  - `.env`  (secrets live here)
  - `passhroom/`  (service source)

### 5.2 Published port for host-network Nginx

Passhroom publishes its API to localhost:

- `127.0.0.1:18080` → `passhroom-api:8080`

So Nginx uses:

- `proxy_pass http://127.0.0.1:18080;`

### 5.3 Service env file location

IMPORTANT:

- The compose invocation uses: `docker compose --env-file .env ...`
- That `.env` must be at:
  - `<deploy-root>/passhroom/.env`

Do **not** place the env file only inside the service folder (`.../passhroom/passhroom/.env`) or compose will not see it.

### 5.4 Required `.env` values (production)

Minimum:

- `PASSHROOM_DB_PASSWORD=...`
- `DATABASE_URL` is provided to the API container by `docker-compose.yml` (it is constructed from `PASSHROOM_DB_PASSWORD`).
- `REDIS_URL=redis://passhroom-redis:6379`
- `PASSHROOM_PUBLIC_BASE_URL=https://passhroom.example.com`
- `NODE_ENV=production`
- `REQUIRE_HTTPS=true`
- SMTP:
  - `SMTP_HOST=<smtp-host>`
  - `SMTP_PORT=<smtp-port>`
  - `SMTP_USER=<smtp-user>`
  - `SMTP_PASS=...`
  - `SMTP_FROM=<from-email>`

---

## 6) Deploy Workflow (Rsync-based)

Maintainer/private automation can use rsync-based deploy tooling from the optional `servertron-docs` submodule.
Public users can self-host with standard Docker Compose and reverse proxy setup (see `docs/deployment.md`).

Script:

- `servertron-docs/apps/passhroom/scripts/rsync-deploy.sh` (private maintainer tooling)

### 6.1 What it syncs

- `passhroom/` → `<deploy-root>/passhroom/passhroom/`
  - excludes `node_modules/`, `dist/`, and `.env`
- `docker-compose.passhroom.yml` → `<deploy-root>/passhroom/docker-compose.yml`
- `nginx/<domain>.conf` → `<deploy-root>/webserver/nginx/conf.d/<domain>.conf`

### 6.2 Start/rebuild remotely

- `servertron-docs/apps/passhroom/scripts/rsync-deploy.sh --run-remote`

This runs on the server:

- `docker compose --env-file .env -f docker-compose.yml up -d --build`

### 6.3 When Nginx can’t reload (TLS config vs bootstrap)

Nginx can only load an HTTPS vhost when the cert files exist inside `nginx_web`.

The deploy script chooses between:

- HTTP-only bootstrap template: `nginx/passhroom.bootstrap.conf.template`
- Full HTTPS template: `nginx/passhroom.tls.conf.template`

It detects cert presence by checking (inside `nginx_web`):

- `/etc/nginx/certs/live/<domain>/fullchain.pem`

If that file is missing, it deploys the bootstrap config.

---

## 7) Certificate Issuance (Certbot)

Because of mount differences:

- In `certbot`, certs are at `/etc/letsencrypt/...`
- In `nginx_web`, certs are at `/etc/nginx/certs/...`

### 7.1 Correct command to issue passhroom cert

Run on the server:

`docker exec -it certbot certbot certonly --webroot -w /var/www/certbot -d passhroom.example.com --cert-name passhroom.example.com --email <you@example.com> --agree-tos --no-eff-email --rsa-key-size 4096 --config-dir /etc/letsencrypt --work-dir /var/lib/letsencrypt --logs-dir /var/log/letsencrypt`

Then verify Nginx can see it:

`docker exec -it nginx_web sh -lc "ls -la /etc/nginx/certs/live/passhroom.example.com/"`

---

## 7.2 New domain: automated 2-step nginx + certbot flow (run from local)

This repo already uses a **two-part nginx config** pattern:

1) Install an HTTP-only vhost (so nginx can load even when certs do not exist yet)
2) Run certbot (HTTP-01 via `--webroot`)
3) Replace the vhost with the HTTPS config and reload nginx

Pre-reqs:

- DNS: your new subdomain already points at the server’s IP.
- The webserver stack is running on the server (`nginx_web` + `certbot`).
- Your app is published on the server in a way nginx (host network) can reach, typically `http://127.0.0.1:<PORT>`.

Run from your local machine (maintainers using private automation):

`servertron-docs/apps/passhroom/scripts/setup-domain-ssl.sh --domain <newhost.example.com> --proxy-pass http://127.0.0.1:<PORT>`

Notes:

- The script will:
  - create `<deploy-root>/webserver/site/<domain>/` if missing
  - install the HTTP bootstrap vhost in `<deploy-root>/webserver/nginx/conf.d/<domain>.conf`
  - run certbot using your contact email (set `EMAIL`)
  - install the HTTPS vhost and reload nginx
- If you need to target a different server/user/port, set env vars:
  - `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PORT`

---

## 8) Operational Steps After Deploy

### 8.1 Migrations

Passhroom migrations are applied from inside `passhroom-api`.

One working approach:

- `docker exec -it passhroom-api sh -lc "cd /app && npx node-pg-migrate -f node-pg-migrate.config.cjs up"`

### 8.2 Nginx reload

- `docker exec -it nginx_web nginx -s reload`

### 8.3 Health check

Public:

- `curl -i https://passhroom.example.com/healthz`

Local (server bypass):

- `curl -k -i --resolve passhroom.example.com:443:127.0.0.1 https://passhroom.example.com/healthz`

---

## 9) Debug Playbook (Fast)

Use this sequence when something is “up but not working”:

1) Is the API container running?
- `docker ps -a --filter name=passhroom-api`
- `docker logs --tail 200 passhroom-api`

2) Can the host reach the published port?
- If `REQUIRE_HTTPS=true` and `NODE_ENV=production`, include the proxy header nginx normally sets:
  - `curl -i -H 'x-forwarded-proto: https' http://127.0.0.1:18080/healthz`

3) Is Nginx loading the intended vhost?
- `docker exec -it nginx_web sh -lc "nginx -T | grep -n 'server_name passhroom.example.com' -n"`
- `docker exec -it nginx_web sh -lc "sed -n '1,220p' /etc/nginx/conf.d/passhroom.example.com.conf"`

4) Does Nginx route correctly locally (SNI bypass)?
- `curl -k -i --resolve passhroom.example.com:443:127.0.0.1 https://passhroom.example.com/healthz`

5) If local works but public fails:
- DNS / Cloudflare tunnel / proxy host routing is the likely culprit.

---

## 10) Security / Hygiene Notes

- Do not paste secrets (SMTP passwords, client secrets) into chat logs.
- If you accidentally paste a secret, rotate it immediately.
- Keep `<deploy-root>/passhroom/.env` permissions to `600`.
- Prefer distinct passwords for:
  - mailbox (`SMTP_PASS`)
  - database (`PASSHROOM_DB_PASSWORD`)
