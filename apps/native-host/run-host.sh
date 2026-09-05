#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE=""
if [ -f "$ROOT/node.path" ]; then
  NODE=$(sed -n '1p' "$ROOT/node.path")
fi
if [ ! -x "$NODE" ]; then
  NODE=$(command -v node || true)
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "cursor-chrome native host: node not found" >&2
  exit 1
fi
if [ ! -f "$ROOT/dist/index.js" ]; then
  echo "cursor-chrome native host: dist missing, run pnpm build" >&2
  exit 1
fi
exec "$NODE" "$ROOT/dist/index.js"
