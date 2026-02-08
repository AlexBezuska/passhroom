#!/usr/bin/env bash
set -euo pipefail

# Restores a local pg_dump custom-format file into the server database.
#
# Usage (defaults target Passhroom):
#   BACKUP_FILE=backups/passhroom-YYYYMMDDTHHMMSSZ.dump npm run db:restore
#
# Usage (any app):
#   SERVER=user@host \
#   REMOTE_DIR=<deploy-root>/<app> \
#   DB_CONTAINER=<app>-db DB_USER=<app> DB_NAME=<app> \
#   STOP_SERVICE=<app>-api \
#   BACKUP_FILE=backups/<app>.dump \
#   npm run db:restore

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
BACKUP_FILE="${BACKUP_FILE:-}"
SSH_OPTS="${SSH_OPTS:--o ConnectTimeout=10}"

DB_CONTAINER="${DB_CONTAINER:-passhroom-db}"
DB_USER="${DB_USER:-passhroom}"
DB_NAME="${DB_NAME:-passhroom}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
STOP_SERVICE="${STOP_SERVICE:-passhroom-api}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "ERROR: BACKUP_FILE is required (path to local .dump file)" >&2
  exit 1
fi

if [[ -z "$SERVER" ]]; then
  echo "ERROR: SERVER is required (set in .deploy.env as SERVER=user@host)" >&2
  exit 2
fi

if [[ -z "$REMOTE_DIR" ]]; then
  echo "ERROR: REMOTE_DIR is required (set in .deploy.env)" >&2
  exit 2
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# Stop app service to reduce the chance of active connections during restore.
# Then restore with --clean/--if-exists for a "catastrophic restore" workflow.
if [[ -n "$STOP_SERVICE" ]]; then
  ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker compose --env-file \"$ENV_FILE\" -f \"$COMPOSE_FILE\" stop \"$STOP_SERVICE\"" || true
fi

ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker exec -i \"$DB_CONTAINER\" pg_restore -U \"$DB_USER\" -d \"$DB_NAME\" --clean --if-exists --no-owner --no-acl" < "$BACKUP_FILE"

if [[ -n "$STOP_SERVICE" ]]; then
  ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker compose --env-file \"$ENV_FILE\" -f \"$COMPOSE_FILE\" up -d \"$STOP_SERVICE\""
fi

echo "OK: restored from $BACKUP_FILE"
