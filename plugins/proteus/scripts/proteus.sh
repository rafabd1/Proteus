#!/usr/bin/env sh
set -eu

PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$PLUGIN_DIR/../.." && pwd)"
CLI="$REPO_ROOT/dist/cli.js"

if [ ! -f "$CLI" ]; then
  cd "$REPO_ROOT"
  npm install
  npm run build
fi

node "$CLI" "$@"

