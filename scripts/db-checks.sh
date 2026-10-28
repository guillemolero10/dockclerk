#!/usr/bin/env bash
# Every check that needs the database, in order, with a summary at the end.
#
#   bash scripts/db-checks.sh            asks before the steps that write, runs everything
#   bash scripts/db-checks.sh --yes      no questions (writes are announced anyway)
#   bash scripts/db-checks.sh --no-model skips the two steps that call the paid model (about 10 cents in total)
#   bash scripts/db-checks.sh --no-seed  keeps the current data (skips the two seeds)
#
# Run it from the dockclerk folder with the phone's data connected (the UMH wifi blocks Postgres).
# Reads .env only through Node's --env-file; nothing is printed from it.
set -u
cd "$(dirname "$0")/.."

YES=0; MODEL=1; SEED=1
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;; --no-model) MODEL=0 ;; --no-seed) SEED=0 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

ENVRUN=(npx tsx --env-file=.env)
NAMES=(); RESULTS=(); SECS=()
FAILS=0

confirm() {
  [ "$YES" = 1 ] && return 0
  read -r -p "$1 [y/N] " ans
  [[ "$ans" =~ ^[yYsS] ]]
}

step() { # step "name" command...
  local name="$1"; shift
  echo; echo "=== $name"
  local t0=$SECONDS
  "$@"; local code=$?
  NAMES+=("$name"); SECS+=("$((SECONDS - t0))")
  if [ $code -eq 0 ]; then RESULTS+=("PASS"); else RESULTS+=("FAIL($code)"); FAILS=$((FAILS + 1)); fi
}
# clerk-eval now exits 1 on a failing case, but keep reading its score lines ("Rules: 17/17 correct", "Muse Spark Open: 17/17 correct") instead.
eval_scores() {
  local out; out=$(mktemp)
  "$@" 2>&1 | tee "$out"
  local bad=0 a b line
  while read -r line; do
    a=$(echo "$line" | sed -E 's/.*: +([0-9]+)\/([0-9]+) correct.*/\1/'); b=$(echo "$line" | sed -E 's/.*: +([0-9]+)\/([0-9]+) correct.*/\2/')
    [ "$a" = "$b" ] || bad=1
  done < <(grep -E '^(Rules|Muse Spark Open): +[0-9]+/[0-9]+ correct' "$out")
  grep -qE '^(Rules|Muse Spark Open): ' "$out" || bad=1
  rm -f "$out"
  return $bad
}

skip() { echo; echo "=== $1  (skipped)"; NAMES+=("$1"); RESULTS+=("skipped"); SECS+=(0); }

summary() {
  echo; echo "================ SUMMARY ================"
  for i in "${!NAMES[@]}"; do printf "%-12s %4ss  %s\n" "${RESULTS[$i]}" "${SECS[$i]}" "${NAMES[$i]}"; done
  echo "failed steps: $FAILS"
  [ $FAILS -eq 0 ]
}

# 0. database must answer, or stop here
echo "=== 0. database connection"
if ! "${ENVRUN[@]}" scripts/db-ping.ts; then
  echo "Stopping: connect with the phone's data (not the UMH wifi) and try again."
  exit 3
fi

# 1. pure checks (no database, but they must be green before anything else)
step "pallets-check"       npx tsx scripts/pallets-check.ts
step "billing-check"       npx tsx scripts/billing-check.ts
step "agent-tools-check"   npx tsx scripts/agent-tools-check.ts
step "billing-view-check"  npx tsx scripts/billing-view-check.ts

# 2. seed twice (WRITES: deletes and recreates the fake data; keeps User, Session and AiSpend)
if [ $SEED = 1 ] && confirm "WRITES: 'npm run db:seed' twice (wipes and recreates the demo data, keeps users and sessions). Go on?"; then
  step "db:seed (1st)" npm run db:seed
  step "db:seed (2nd)" npm run db:seed
else
  skip "db:seed x2"
fi

# 3. read-only
step "billing-seed-check (read-only)" "${ENVRUN[@]}" scripts/billing-seed-check.ts

# 4. writes and cleans up after itself
if confirm "WRITES: billing-actions-check creates pre-invoices of last month and a temporary session, and deletes them at the end. Go on?"; then
  step "billing-actions-check (writes, cleans up)" "${ENVRUN[@]}" scripts/billing-actions-check.ts
else
  skip "billing-actions-check"
fi

# 5. the clerk without the model (rules engine), then with it
step "clerk-edge, rules (BASETEN_MODEL=nope)" env BASETEN_MODEL=nope "${ENVRUN[@]}" scripts/clerk-edge.ts
step "clerk-eval rules"                      eval_scores "${ENVRUN[@]}" scripts/clerk-eval.ts rules
if [ $MODEL = 1 ]; then
  if confirm "SPENDS about 10 cents of Baseten credit (clerk-edge and clerk-eval with the model). Go on?"; then
    step "clerk-edge, Muse Spark"  "${ENVRUN[@]}" scripts/clerk-edge.ts
    step "clerk-eval, Muse Spark"  eval_scores "${ENVRUN[@]}" scripts/clerk-eval.ts
  else
    skip "clerk-edge/eval with the model"
  fi
else
  skip "clerk-edge/eval with the model"
fi

# 6. the app itself
step "tsc"   npx tsc --noEmit
step "lint"  npm run lint
step "build" npm run build

summary
