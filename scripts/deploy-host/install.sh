#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEPLOY_ROOT="${DEPLOY_ROOT:-}"
PASSHROOM_DIR="${PASSHROOM_DIR:-${DEPLOY_ROOT:+$DEPLOY_ROOT/passhroom}}"
WEBSERVER_DIR="${WEBSERVER_DIR:-${DEPLOY_ROOT:+$DEPLOY_ROOT/webserver}}"
NGINX_CONFD_DIR="${NGINX_CONFD_DIR:-${WEBSERVER_DIR:+$WEBSERVER_DIR/nginx/conf.d}}"
SITE_DIR="${SITE_DIR:-}"
DOCKER_NETWORK_WEB_NAME="${DOCKER_NETWORK_WEB_NAME:-web}"
NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-nginx_web}"
PASSHROOM_DOMAIN="${PASSHROOM_DOMAIN:-}"
PASSHROOM_UPSTREAM="${PASSHROOM_UPSTREAM:-http://127.0.0.1:18080}"

CERTS_DIR_HOST="${CERTS_DIR_HOST:-$WEBSERVER_DIR/nginx/certs/live/$PASSHROOM_DOMAIN}"

if [[ -z "$DEPLOY_ROOT" || -z "$PASSHROOM_DIR" || -z "$WEBSERVER_DIR" || -z "$NGINX_CONFD_DIR" ]]; then
  echo "ERROR: DEPLOY_ROOT/PASSHROOM_DIR/WEBSERVER_DIR/NGINX_CONFD_DIR must be set (use .deploy.env)" >&2
  exit 2
fi
if [[ -z "$SITE_DIR" ]]; then
  echo "ERROR: SITE_DIR must be set (use .deploy.env; ex: <webserver>/site/<hostname>)" >&2
  exit 2
fi
if [[ -z "$PASSHROOM_DOMAIN" ]]; then
  echo "ERROR: PASSHROOM_DOMAIN must be set (use .deploy.env)" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not found (need 'docker compose')" >&2
  exit 1
fi

if [[ ! -d "$DEPLOY_ROOT" ]]; then
  echo "ERROR: DEPLOY_ROOT does not exist: $DEPLOY_ROOT" >&2
  exit 1
fi

mkdir -p "$PASSHROOM_DIR" "$NGINX_CONFD_DIR" "$SITE_DIR"

if [[ ! -f "$PASSHROOM_DIR/.env" ]]; then
  echo "Missing $PASSHROOM_DIR/.env; creating from example..."
  "$SCRIPT_DIR/setup-env.sh"
  echo "Edit $PASSHROOM_DIR/.env then re-run install." >&2
  exit 1
fi

echo "Ensuring external docker network '$DOCKER_NETWORK_WEB_NAME' exists..."
if ! docker network inspect "$DOCKER_NETWORK_WEB_NAME" >/dev/null 2>&1; then
  docker network create "$DOCKER_NETWORK_WEB_NAME" >/dev/null
fi

copy_tree() {
  local src="$1" dst="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src" "$dst"
  else
    rm -rf "$dst"
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}

echo "Syncing Passhroom files into $PASSHROOM_DIR ..."
copy_tree "$REPO_ROOT/passhroom" "$PASSHROOM_DIR/passhroom"
cp "$REPO_ROOT/docker-compose.passhroom.yml" "$PASSHROOM_DIR/docker-compose.yml"

echo "Installing nginx vhost conf..."
render_template() {
  local template="$1" out="$2"
  sed \
    -e "s|__DOMAIN__|$PASSHROOM_DOMAIN|g" \
    -e "s|__UPSTREAM__|$PASSHROOM_UPSTREAM|g" \
    "$template" > "$out"
}

NGINX_TEMPLATE="$REPO_ROOT/nginx/passhroom.bootstrap.conf.template"
if docker ps --format '{{.Names}}' | grep -qx "$NGINX_CONTAINER_NAME"; then
  if docker exec -i "$NGINX_CONTAINER_NAME" sh -lc "test -f /etc/nginx/certs/live/$PASSHROOM_DOMAIN/fullchain.pem"; then
    NGINX_TEMPLATE="$REPO_ROOT/nginx/passhroom.tls.conf.template"
  fi
else
  if [[ -d "$CERTS_DIR_HOST" ]]; then
    NGINX_TEMPLATE="$REPO_ROOT/nginx/passhroom.tls.conf.template"
  fi
fi

tmp_conf="$(mktemp)"
render_template "$NGINX_TEMPLATE" "$tmp_conf"
cp "$tmp_conf" "$NGINX_CONFD_DIR/$PASSHROOM_DOMAIN.conf"
rm -f "$tmp_conf"

echo "Starting Passhroom stack..."
cd "$PASSHROOM_DIR"
docker compose -f docker-compose.yml --env-file .env up -d --build

cat <<EOF

OK: Passhroom containers started.

Next steps:
  1) Run migrations:
     docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"
  2) Create a client:
     docker exec -it passhroom-api sh -lc "cd /app && node dist/cli.js clients:create --client-id <id> --redirect-uri <https://yourapp.tld/auth/callback> --allowed-origin <https://yourapp.tld>"
  3) Reload nginx (depends on how your webserver container is managed).
     If your nginx container supports it: docker exec -it <nginx_container> nginx -s reload
  4) Smoke test:
    curl -i https://passhroom.example.com/healthz
EOF
