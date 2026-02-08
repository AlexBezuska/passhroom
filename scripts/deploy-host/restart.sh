#!/usr/bin/env bash
set -euo pipefail

# Restarts the Passhroom service on the deploy host.
#
# Usage:
#   npm run server:restart
#
# Optional overrides:
#   SERVER=user@host REMOTE_DIR=/path/to/passhroom SERVICE=passhroom-api npm run server:restart
#   SERVICE=  # restarts all services in the compose project

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
SSH_OPTS="${SSH_OPTS:--o ConnectTimeout=10}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
SERVICE="${SERVICE:-passhroom-api}"

if [[ -z "$SERVER" ]]; then
  echo "ERROR: SERVER is required (set in .deploy.env as SERVER=user@host)" >&2
  exit 2
fi

if [[ -z "$REMOTE_DIR" ]]; then
  echo "ERROR: REMOTE_DIR is required (set in .deploy.env)" >&2
  exit 2
fi

if [[ -n "$SERVICE" ]]; then
  echo "Restarting $SERVICE on $SERVER ..."
  ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker compose --env-file \"$ENV_FILE\" -f \"$COMPOSE_FILE\" restart \"$SERVICE\""
else
  echo "Restarting all compose services on $SERVER ..."
  ssh $SSH_OPTS "$SERVER" "cd \"$REMOTE_DIR\" && docker compose --env-file \"$ENV_FILE\" -f \"$COMPOSE_FILE\" restart"
fi

echo "OK: restart complete"
