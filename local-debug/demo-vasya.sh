#!/bin/sh
# DEMO_TOKEN_LOGIN — demo server for «Вася Пупкин» on an isolated EMPTY data dir (never the owner's data).
# Token: env DEMO_LOGIN_TOKEN (set it yourself, or a random one is generated into $DATA/demo-token, mode 600).
# The token is never printed; log in with POST /auth/demo (the token field on the login page).
set -e
cd "$(dirname "$0")/.."
DATA="${DEMO_DATA:-/tmp/vasya-demo}"
mkdir -p "$DATA"
chmod 700 "$DATA"
if [ -z "$DEMO_LOGIN_TOKEN" ]; then
  if [ ! -s "$DATA/demo-token" ]; then
    (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > "$DATA/demo-token")
  fi
  DEMO_LOGIN_TOKEN="$(cat "$DATA/demo-token")"
fi
unset RAILWAY_ENVIRONMENT RAILWAY_TOKEN RAILWAY_API_TOKEN RAILWAY_PERSONAL_TOKEN TELEGRAM_BOT_TOKEN DEV_NO_AUTH MODEL_CHAIN MISTRAL_API_KEY GEMINI_API_KEY
export HH_STORE="$DATA/hh.json" WEB_SECRETS="$DATA/web-secrets.json" HH_DATA_DIR="$DATA" ACCESS_DB="$DATA/access.sqlite" ADMIN_GITHUB_LOGINS=thisVioletHydra DEMO_TOKEN_LOGIN=1 DEMO_LOGIN_TOKEN
cd apps/web
exec ./node_modules/.bin/vite dev --port "${PORT:-5181}" --strictPort
