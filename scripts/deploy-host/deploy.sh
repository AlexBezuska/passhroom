#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

DEPLOY_ROOT="${DEPLOY_ROOT:-}"
PASSHROOM_DIR="${PASSHROOM_DIR:-${DEPLOY_ROOT:+$DEPLOY_ROOT/passhroom}}"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "$DEPLOY_ROOT" || -z "$PASSHROOM_DIR" ]]; then
  echo "ERROR: DEPLOY_ROOT/PASSHROOM_DIR must be set (use .deploy.env)" >&2
  exit 2
fi

if [[ ! -d "$PASSHROOM_DIR" ]]; then
  echo "ERROR: $PASSHROOM_DIR does not exist; run install first." >&2
  exit 1
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

echo "Updating code in $PASSHROOM_DIR ..."
copy_tree "$REPO_ROOT/passhroom" "$PASSHROOM_DIR/passhroom"
cp "$REPO_ROOT/docker-compose.passhroom.yml" "$PASSHROOM_DIR/docker-compose.yml"

cd "$PASSHROOM_DIR"
docker compose -f docker-compose.yml --env-file .env up -d --build

echo "OK: Deployed and rebuilt passhroom-api"
