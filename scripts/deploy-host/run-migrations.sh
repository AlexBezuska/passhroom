#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

REMOTE_DIR="${REMOTE_DIR:-}"

if [[ -z "$REMOTE_DIR" ]]; then
	echo "ERROR: REMOTE_DIR is required (set in .deploy.env)" >&2
	exit 2
fi

cd "$REMOTE_DIR"

docker exec -it passhroom-api sh -lc "cd /app && npx node-pg-migrate -f node-pg-migrate.config.cjs up"
