#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HOME="${HOME:-$(cd && pwd)}"
PATH="$HOME/Library/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
NODE=""
if [ -f "$ROOT/node.path" ]; then
  NODE=$(sed -n '1p' "$ROOT/node.path")
fi
if [ ! -x "$NODE" ]; then
  NODE=$(command -v node || true)
fi
if [ ! -x "$NODE" ]; then
  for candidate in \
    "$HOME/Library/pnpm/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    if [ -x "$candidate" ]; then
      NODE=$candidate
      break
    fi
  done
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
