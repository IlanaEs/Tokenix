#!/usr/bin/env bash
#
# Tokenix — deterministic demo bootstrap.
#
# Brings up the full local stack from a clean state, lets the Hardhat container
# auto-deploy the contracts and sync the ABIs, seeds the demo users/wallets, and
# verifies the 100 TNX baseline + funding-readiness rows.
#
# Everything it needs (faucet config, funding worker, demo password, demo-wallet
# volume) is committed in docker-compose.yml, so this works from a clean clone of
# main with no local .env, no host-mounted .demo-data, and no manual deploy step.
#
# Usage:
#   ./scripts/demo-setup.sh           # clean rebuild + seed + verify (default)
#   ./scripts/demo-setup.sh --keep    # reuse existing volumes (no `down -v`)
#
set -euo pipefail

cd "$(dirname "$0")/.."

KEEP_STATE=0
if [ "${1:-}" = "--keep" ]; then
  KEEP_STATE=1
fi

# docker compose (v2) vs docker-compose (v1)
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

if [ "$KEEP_STATE" -eq 0 ]; then
  log "Tearing down any previous stack and volumes (clean state)"
  $DC down -v --remove-orphans || true
fi

log "Building and starting the stack"
$DC up --build -d

# ---------------------------------------------------------------------------
# Wait for Hardhat to deploy+sync (compose marks it healthy only once the ABI
# is synced and the contract has bytecode) and for the backend HTTP to answer.
# ---------------------------------------------------------------------------
log "Waiting for Hardhat to deploy contracts and sync ABIs"
for i in $(seq 1 90); do
  state=$($DC ps hardhat --format '{{.Health}}' 2>/dev/null || echo "")
  if [ "$state" = "healthy" ]; then ok "Hardhat healthy (contracts deployed + ABIs synced)"; break; fi
  if [ "$i" -eq 90 ]; then fail "Hardhat did not become healthy in time"; fi
  sleep 2
done

log "Waiting for backend /health"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then ok "Backend /health is OK"; break; fi
  if [ "$i" -eq 60 ]; then fail "Backend /health never came up"; fi
  sleep 2
done

curl -fsS http://localhost:3000/health/contract >/dev/null 2>&1 \
  && ok "Backend /health/contract is OK" \
  || fail "Backend /health/contract failed (contract not wired up)"

# ---------------------------------------------------------------------------
# Seed. DEMO_PASSWORD + DEMO_WALLET_FILE come from docker-compose.yml, so no
# secrets are passed on the command line and the run is non-interactive.
# ---------------------------------------------------------------------------
log "Seeding demo users, wallets, funding and transactions"
$DC exec -T backend node scripts/prepare-demo-data.js

# ---------------------------------------------------------------------------
# Verify the documented end state directly from Postgres.
# ---------------------------------------------------------------------------
psql() { $DC exec -T db psql -U postgres -d tokenix -tAc "$1"; }

log "Verifying demo state"

users=$(psql "SELECT COUNT(*) FROM users WHERE email IN ('admin@example.com','user1@example.com','user2@example.com');")
[ "$users" = "3" ] && ok "3 demo users present" || fail "expected 3 demo users, found ${users:-0}"

ready=$(psql "SELECT COUNT(*) FROM wallet_funding_jobs WHERE funding_ready = TRUE;")
[ "${ready:-0}" -ge 3 ] && ok "$ready wallet funding-readiness rows present" || fail "expected >=3 funding_ready rows, found ${ready:-0}"

confirmed=$(psql "SELECT COUNT(*) FROM transactions WHERE type='USER_TRANSFER' AND status='CONFIRMED';")
[ "${confirmed:-0}" -ge 1 ] && ok "$confirmed CONFIRMED user-transfer transactions present" || fail "no CONFIRMED user transfers found"

# On-chain 100 TNX baseline for each demo wallet, read through the backend.
log "Verifying on-chain 100 TNX baseline per demo wallet"
addrs=$(psql "SELECT w.wallet_address FROM wallets w JOIN users u ON u.user_id=w.user_id WHERE u.email IN ('admin@example.com','user1@example.com','user2@example.com');")
while IFS= read -r addr; do
  [ -z "$addr" ] && continue
  bal=$(curl -fsS "http://localhost:3000/balance/${addr}" | sed -E 's/.*"balance":"?([0-9.]+)"?.*/\1/')
  if [ "${bal%%.*}" = "100" ]; then ok "$addr = ${bal} TNX"; else fail "$addr balance is ${bal:-?} TNX (expected 100)"; fi
done <<EOF
$addrs
EOF

log "Demo environment ready"
cat <<'EOF'
    Frontend : http://localhost:5173
    Backend  : http://localhost:3000
    Hardhat  : http://localhost:8545

    Demo accounts (password: tokenix-demo-local):
      admin@example.com  (ADMIN)
      user1@example.com  (USER)
      user2@example.com  (USER)
EOF
