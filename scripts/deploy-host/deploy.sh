#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET="$REPO_ROOT/servertron-docs/apps/passhroom/scripts/deploy.sh"

if [[ ! -f "$TARGET" ]]; then
  echo "ERROR: private deploy script not found: $TARGET" >&2
  echo "Initialize submodule: git submodule update --init -- servertron-docs" >&2
  exit 1
fi

export PASSHROOM_REPO_ROOT="$REPO_ROOT"
exec bash "$TARGET" "$@"
