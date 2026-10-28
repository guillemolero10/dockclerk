#!/usr/bin/env bash
# Runs scripts/e2e.ts asking for the passwords without showing them and without saving them in the shell history.
#   bash scripts/e2e.sh                 (dev server already running on http://localhost:3000)
# Usernames default to the demo accounts; the passwords are in USUARIOS-DEMO.md (outside the repo).
set -u
cd "$(dirname "$0")/.."
BASE="${E2E_BASE_URL:-http://localhost:3000}"

if ! curl -s -o /dev/null --max-time 8 "$BASE/"; then
  echo "Nothing answers at $BASE. Start the server first in another terminal:  npm run dev"
  exit 2
fi

ask() { # ask VAR "prompt" [secret]
  local var="$1" prompt="$2" secret="${3:-}"
  if [ -n "${!var:-}" ]; then return; fi
  if [ -n "$secret" ]; then read -r -s -p "$prompt: " val; echo; else read -r -p "$prompt: " val; fi
  export "$var=$val"
}

export E2E_OFFICE_USER="${E2E_OFFICE_USER:-oficina}"
export E2E_OPERATOR_USER="${E2E_OPERATOR_USER:-operario}"
export E2E_CLIENT_USER="${E2E_CLIENT_USER:-juguetes-levante}"
ask E2E_OFFICE_PASS   "Password for $E2E_OFFICE_USER" secret
ask E2E_OPERATOR_PASS "Password for $E2E_OPERATOR_USER" secret
ask E2E_CLIENT_PASS   "Password for $E2E_CLIENT_USER (empty to skip the customer checks)" secret
[ -z "$E2E_CLIENT_PASS" ] && unset E2E_CLIENT_USER E2E_CLIENT_PASS

exec npx tsx scripts/e2e.ts
