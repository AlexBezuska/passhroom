#!/usr/bin/env bash
set -euo pipefail

# Deploy Passhroom to a deploy host using rsync over SSH.
#
# Defaults are loaded from an uncommitted config file:
#   ./.deploy.env  (copy from .deploy.env.example)
#
# This script does NOT overwrite the server-side .env.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"

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

RUN_REMOTE="false"
DRY_RUN="false"
BOOTSTRAP_ENV="false"

usage() {
  cat <<EOF
Usage:
  scripts/deploy-host/rsync-deploy.sh [--dry-run] [--run-remote] [--bootstrap-env]

Env overrides:
  DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_PORT
  DEPLOY_ROOT, PASSHROOM_DIR, WEBSERVER_DIR, NGINX_CONFD_DIR, SITE_DIR
  DOCKER_NETWORK_WEB_NAME
  PASSHROOM_DOMAIN, PASSHROOM_UPSTREAM

Behavior:
  - rsyncs ./passhroom/ -> $PASSHROOM_DIR/passhroom/
  - copies docker-compose.passhroom.yml -> $PASSHROOM_DIR/docker-compose.yml
  - copies ./.env.example -> $PASSHROOM_DIR/.env.example
  - renders nginx/passhroom.*.conf.template -> $NGINX_CONFD_DIR/$PASSHROOM_DOMAIN.conf
  - creates $SITE_DIR (empty; for your nginx hosted files pattern)
  - never overwrites $PASSHROOM_DIR/.env

--bootstrap-env:
  - if $PASSHROOM_DIR/.env is missing, copies $PASSHROOM_DIR/.env.example -> $PASSHROOM_DIR/.env
  - does NOT start containers (you must edit .env first)

--run-remote will also:
  - ensure docker network '$DOCKER_NETWORK_WEB_NAME'
  - run docker compose up -d --build

EOF
}

for arg in "$@"; do
  case "$arg" in
    --run-remote) RUN_REMOTE="true" ;;
    --dry-run) DRY_RUN="true" ;;
    --bootstrap-env) BOOTSTRAP_ENV="true" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

require_cmd rsync
require_cmd ssh

SSH_OPTS=(
  -p "$DEPLOY_SSH_PORT"
  -o BatchMode=yes
)

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "ERROR: DEPLOY_HOST is required (set in .deploy.env)" >&2
  exit 2
fi
if [[ -z "$DEPLOY_ROOT" || -z "$PASSHROOM_DIR" || -z "$WEBSERVER_DIR" || -z "$NGINX_CONFD_DIR" ]]; then
  echo "ERROR: DEPLOY_ROOT/PASSHROOM_DIR/WEBSERVER_DIR/NGINX_CONFD_DIR must be set (set in .deploy.env)" >&2
  exit 2
fi
if [[ -z "$SITE_DIR" ]]; then
  echo "ERROR: SITE_DIR must be set (set in .deploy.env; ex: <webserver>/site/<hostname>)" >&2
  exit 2
fi
if [[ -z "$PASSHROOM_DOMAIN" ]]; then
  echo "ERROR: PASSHROOM_DOMAIN must be set (set in .deploy.env)" >&2
  exit 2
fi

echo "Connecting to $REMOTE ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$PASSHROOM_DIR' '$NGINX_CONFD_DIR' '$SITE_DIR' '$PASSHROOM_DIR/passhroom'"

RSYNC_COMMON_OPTS=(
  -az
  --delete
  --checksum
  --info=stats2,progress2
  -e "ssh -p $DEPLOY_SSH_PORT"
)

if [[ "$DRY_RUN" == "true" ]]; then
  RSYNC_COMMON_OPTS+=(--dry-run)
fi

echo "Rsyncing service folder -> $REMOTE:$PASSHROOM_DIR/passhroom/ ..."
rsync "${RSYNC_COMMON_OPTS[@]}" \
  --exclude "/node_modules/" \
  --exclude "/dist/" \
  --exclude "/.env" \
  "$REPO_ROOT/passhroom/" \
  "$REMOTE:$PASSHROOM_DIR/passhroom/"

echo "Copying compose file -> $REMOTE:$PASSHROOM_DIR/docker-compose.yml ..."
rsync -az -e "ssh -p $DEPLOY_SSH_PORT" \
  "$REPO_ROOT/docker-compose.passhroom.yml" \
  "$REMOTE:$PASSHROOM_DIR/docker-compose.yml"

echo "Copying env example -> $REMOTE:$PASSHROOM_DIR/.env.example ..."
rsync -az -e "ssh -p $DEPLOY_SSH_PORT" \
  "$REPO_ROOT/.env.example" \
  "$REMOTE:$PASSHROOM_DIR/.env.example"

echo "Copying scripts folder -> $REMOTE:$PASSHROOM_DIR/scripts/ ..."
rsync "${RSYNC_COMMON_OPTS[@]}" \
  "$REPO_ROOT/scripts/" \
  "$REMOTE:$PASSHROOM_DIR/scripts/"

echo "Selecting nginx conf based on cert presence..."
render_template() {
  local template="$1" out="$2"
  sed \
    -e "s|__DOMAIN__|$PASSHROOM_DOMAIN|g" \
    -e "s|__UPSTREAM__|$PASSHROOM_UPSTREAM|g" \
    "$template" > "$out"
}

NGINX_TEMPLATE="$REPO_ROOT/nginx/passhroom.bootstrap.conf.template"
if ssh "${SSH_OPTS[@]}" "$REMOTE" "
  set -euo pipefail
  # Prefer checking inside the nginx container (works regardless of host bind mount paths)
  if docker ps --format '{{.Names}}' | grep -qx '$NGINX_CONTAINER_NAME'; then
    docker exec -i '$NGINX_CONTAINER_NAME' sh -lc 'test -f /etc/nginx/certs/live/$PASSHROOM_DOMAIN/fullchain.pem'
    exit 0
  fi
  # Fallback: check host path if nginx container name differs
  test -d '$CERTS_DIR_HOST'
"; then
  NGINX_TEMPLATE="$REPO_ROOT/nginx/passhroom.tls.conf.template"
  echo "Found cert dir on server; deploying full TLS config."
else
  echo "Cert dir not found; deploying HTTP bootstrap config."
fi

tmp_conf="$(mktemp)"
render_template "$NGINX_TEMPLATE" "$tmp_conf"
echo "Copying nginx conf -> $REMOTE:$NGINX_CONFD_DIR/$PASSHROOM_DOMAIN.conf ..."
rsync -az -e "ssh -p $DEPLOY_SSH_PORT" \
  "$tmp_conf" \
  "$REMOTE:$NGINX_CONFD_DIR/$PASSHROOM_DOMAIN.conf"
rm -f "$tmp_conf"

if [[ "$BOOTSTRAP_ENV" == "true" ]]; then
  echo "Bootstrapping server .env if missing..."
  ssh "${SSH_OPTS[@]}" "$REMOTE" "
    set -euo pipefail
    if [[ -f '$PASSHROOM_DIR/.env' ]]; then
      echo 'OK: .env already exists; not touching it.'
      exit 0
    fi
    if [[ ! -f '$PASSHROOM_DIR/.env.example' ]]; then
      echo 'ERROR: missing $PASSHROOM_DIR/.env.example (deploy did not copy it?)' >&2
      exit 1
    fi
    cp '$PASSHROOM_DIR/.env.example' '$PASSHROOM_DIR/.env'
    chmod 600 '$PASSHROOM_DIR/.env'
    echo 'Created .env from .env.example. Edit it before starting containers.'
  "

  cat <<EOF

OK: Bootstrapped $PASSHROOM_DIR/.env on the server.

Next:
  1) SSH to the server and edit that .env (fill PASSHROOM_DB_PASSWORD + SMTP_*).
  2) Re-run: scripts/deploy-host/rsync-deploy.sh --run-remote
EOF
  exit 0
fi

if [[ "$RUN_REMOTE" != "true" ]]; then
  cat <<EOF

OK: Files synced.

Next (on server):
  - Ensure $PASSHROOM_DIR/.env exists (create once via scripts/deploy-host/setup-env.sh if desired)
  - Start/build:
      cd $PASSHROOM_DIR && docker compose --env-file .env up -d --build
EOF
  exit 0
fi

echo "Running remote docker compose..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  set -euo pipefail
  if ! docker compose version >/dev/null 2>&1; then
    echo 'ERROR: docker compose plugin not available on server' >&2
    exit 1
  fi
  if [[ ! -f '$PASSHROOM_DIR/.env' ]]; then
    if [[ -f '$PASSHROOM_DIR/passhroom/.env' ]]; then
      echo 'ERROR: found .env at $PASSHROOM_DIR/passhroom/.env but expected it at $PASSHROOM_DIR/.env' >&2
      echo 'Fix: cp $PASSHROOM_DIR/passhroom/.env $PASSHROOM_DIR/.env && chmod 600 $PASSHROOM_DIR/.env' >&2
      exit 1
    fi
    echo 'ERROR: missing $PASSHROOM_DIR/.env (create it once; do not commit secrets)' >&2
    exit 1
  fi
  if ! docker network inspect '$DOCKER_NETWORK_WEB_NAME' >/dev/null 2>&1; then
    docker network create '$DOCKER_NETWORK_WEB_NAME' >/dev/null
  fi
  cd '$PASSHROOM_DIR'
  docker compose --env-file .env -f docker-compose.yml up -d --build
"

cat <<EOF

OK: Remote deploy complete.

Next (on server, once per fresh DB):
  docker exec -it passhroom-api sh -lc "cd /app && npx node-pg-migrate -f node-pg-migrate.config.cjs up"
EOF
