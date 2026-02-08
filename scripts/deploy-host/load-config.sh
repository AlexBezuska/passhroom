#!/usr/bin/env bash

# Shared config loader for scripts/deploy-host/*.sh
#
# Loads REPO_ROOT/.deploy.env if present.
#
# Notes:
# - This file is meant to be sourced, not executed.
# - It must be safe under: set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEPLOY_CONFIG="${DEPLOY_CONFIG:-$REPO_ROOT/.deploy.env}"

if [[ -f "$DEPLOY_CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_CONFIG"
fi
