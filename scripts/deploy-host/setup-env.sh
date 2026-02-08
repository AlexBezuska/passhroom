#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

DEPLOY_ROOT="${DEPLOY_ROOT:-}"
PASSHROOM_DIR="${PASSHROOM_DIR:-${DEPLOY_ROOT:+$DEPLOY_ROOT/passhroom}}"

if [[ -z "$DEPLOY_ROOT" || -z "$PASSHROOM_DIR" ]]; then
  echo "ERROR: DEPLOY_ROOT and PASSHROOM_DIR must be set (use .deploy.env)" >&2
  exit 2
fi

if [[ ! -d "$DEPLOY_ROOT" ]]; then
  echo "ERROR: DEPLOY_ROOT does not exist: $DEPLOY_ROOT" >&2
  exit 1
fi

mkdir -p "$PASSHROOM_DIR"

if [[ -f "$PASSHROOM_DIR/.env" ]]; then
  echo "OK: $PASSHROOM_DIR/.env already exists"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cp "$REPO_ROOT/.env.example" "$PASSHROOM_DIR/.env"
chmod 600 "$PASSHROOM_DIR/.env"

cat <<EOF
Created: $PASSHROOM_DIR/.env

Next:
  1) Edit that file and fill in PASSHROOM_DB_PASSWORD + SMTP_*.
  2) Re-run install: scripts/deploy-host/install.sh
EOF
