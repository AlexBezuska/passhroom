#!/usr/bin/env bash
set -euo pipefail

# Streams a compressed custom-format pg_dump from the server to a local file.
#
# Usage (defaults target Passhroom):
#   npm run db:backup
#
# Usage (any app):
#   SERVER=user@host \
#   REMOTE_DIR=<deploy-root>/<app> \
#   DB_CONTAINER=<app>-db DB_USER=<app> DB_NAME=<app> \
#   OUT=backups/<app>.dump \
#   npm run db:backup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
SSH_OPTS="${SSH_OPTS:--o ConnectTimeout=10}"

DB_CONTAINER="${DB_CONTAINER:-passhroom-db}"
DB_USER="${DB_USER:-passhroom}"
DB_NAME="${DB_NAME:-passhroom}"

mkdir -p backups

if [[ -z "$SERVER" ]]; then
  echo "ERROR: SERVER is required (set in .deploy.env as SERVER=user@host)" >&2
  exit 2
fi

if [[ -z "$REMOTE_DIR" ]]; then
  echo "ERROR: REMOTE_DIR is required (set in .deploy.env)" >&2
  exit 2
fi

if [[ -z "${OUT:-}" ]]; then
  OUT="backups/passhroom-$(date -u +%Y%m%dT%H%M%SZ).dump"
fi

# Custom format (-Fc) is the common "industry standard" for reliable restores via pg_restore.
# -Z 9 = max compression in pg_dump.
ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker exec -i \"$DB_CONTAINER\" pg_dump -U \"$DB_USER\" -d \"$DB_NAME\" -Fc -Z 9 --no-owner --no-acl" > "$OUT"

echo "OK: wrote $OUT"
