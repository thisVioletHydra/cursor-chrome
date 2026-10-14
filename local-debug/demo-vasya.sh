#!/bin/sh
# DEMO_TOKEN_LOGIN — demo server for «Вася Пупкин» on an isolated EMPTY data dir (never Roman's data, never Railway).
set -e
cd "$(dirname "$0")/.."
DATA="${DEMO_DATA:-/tmp/vasya-demo}"
mkdir -p "$DATA"
unset RAILWAY_ENVIRONMENT RAILWAY_TOKEN RAILWAY_API_TOKEN RAILWAY_PERSONAL_TOKEN TELEGRAM_BOT_TOKEN DEV_NO_AUTH MODEL_CHAIN MISTRAL_API_KEY
export HH_STORE="$DATA/hh.json" WEB_SECRETS="$DATA/web-secrets.json" HH_DATA_DIR="$DATA" ACCESS_DB="$DATA/access.sqlite" ADMIN_GITHUB_LOGINS=thisVioletHydra DEMO_TOKEN_LOGIN=1
cd apps/web
exec ./node_modules/.bin/vite dev --port "${PORT:-5181}" --strictPort
