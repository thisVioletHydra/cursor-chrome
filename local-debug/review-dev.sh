#!/bin/sh
# Local dev for the «Разбор» tab on local fixture data. Never points at the Railway volume.
set -e
cd "$(dirname "$0")/.."
DATA="$PWD/local-debug/data/review"
[ -f "$DATA/queue.json" ] || node local-debug/review-seed.mjs
unset RAILWAY_ENVIRONMENT RAILWAY_TOKEN RAILWAY_API_TOKEN RAILWAY_PERSONAL_TOKEN SESSION_SECRET TELEGRAM_BOT_TOKEN
export HH_STORE="$DATA/hh.json" WEB_SECRETS="$DATA/web-secrets.json" ADMIN_GITHUB_LOGINS=thisVioletHydra DEV_NO_AUTH=1
cd apps/web
exec ./node_modules/.bin/vite dev --port "${PORT:-5180}" --strictPort
