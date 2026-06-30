# Tokenix Demo Data Preparation

This guide prepares a stable local demo state for the final Tokenix MVP presentation.

The seed process creates demo users, wallets, balances, and transaction history for the local Docker/Hardhat environment. It does not commit passwords, tokens, or private keys.

## Demo Users

The script prepares these accounts:

```text
admin@example.com
user1@example.com
user2@example.com
```

Roles:

- `admin@example.com` — `ADMIN`
- `user1@example.com` — `USER`
- `user2@example.com` — `USER`

The seeded accounts use a **local-only** demo password, `tokenix-demo-local`,
which is committed in `docker-compose.yml` (`DEMO_PASSWORD`) purely so the demo
can be reproduced with a single command. It is throwaway local credential
material for disposable local accounts — never reuse it anywhere real, and do
not add real passwords or secrets to the compose file.

## Quick Start (recommended)

From the repository root, on a clean checkout of `main`:

```bash
./scripts/demo-setup.sh
```

This performs the entire deterministic flow with no manual steps and no local
configuration:

1. `docker compose down -v` then `docker compose up --build -d` (clean state).
2. Waits for the Hardhat container to **auto-deploy the contracts and sync the
   ABIs** (its entrypoint runs `npm run full-deploy` on every start; the backend
   only starts once Hardhat reports healthy).
3. Seeds demo users/wallets via `docker compose exec backend node
   scripts/prepare-demo-data.js` (the demo password and wallet-file path come
   from `docker-compose.yml`, so nothing is passed by hand).
4. Verifies the end state: 3 demo users, funding-readiness rows, CONFIRMED
   transfers, and a `100` TNX on-chain balance for each demo wallet.

To re-seed without wiping volumes (keeps the persisted demo wallets stable):

```bash
./scripts/demo-setup.sh --keep
```

### What the flow does not require

The deterministic flow runs from a clean clone of `main` with nothing prepared
in advance. It explicitly does **not** require:

- a manual `cd blockchain && npm run full-deploy` — the Hardhat container runs
  it automatically on every startup;
- a host-side `.demo-data` folder — demo wallet keys live in the
  `tokenix_demo_data` Docker volume, created automatically;
- any pre-existing Docker volumes or prior Hardhat chain / database state —
  `./scripts/demo-setup.sh` starts clean with `docker compose down -v`;
- a local `.env` or any other local configuration — the demo config (faucet,
  funding worker, demo password, wallet-file path) is committed in
  `docker-compose.yml`, and the contract ABIs are tracked in the repo and
  regenerated on each deploy.

## Manual Setup (equivalent steps)

If you prefer to run the steps yourself:

```bash
# 1. Start the stack (Hardhat auto-deploys + syncs ABIs; backend waits for it)
docker compose up --build -d

# 2. Seed (DEMO_PASSWORD / DEMO_WALLET_FILE are provided by docker-compose.yml)
docker compose exec backend node scripts/prepare-demo-data.js
```

> The legacy `cd blockchain && npm run full-deploy` step is **no longer
> required** for the Docker flow — the Hardhat container runs it automatically
> on startup. Run it manually only for the non-Docker local-development path.

### Demo wallet persistence

Generated demo wallet private keys are written to `DEMO_WALLET_FILE`
(`/app/.demo-data/tokenix-demo-wallets.json`), which is backed by the
**named Docker volume** `tokenix_demo_data` declared in `docker-compose.yml`.
This keeps demo wallet addresses/keys stable across container restarts and
re-seeds without depending on any host-side directory. Because the keys persist
and the faucet allows a single claim per wallet, re-running the seed is
idempotent: already-funded wallets are skipped and only their readiness and
transaction records are refreshed.

A clean run (`./scripts/demo-setup.sh`, or `docker compose down -v`) wipes that
volume so wallets are regenerated from scratch and re-funded to the same `100`
TNX baseline. The keys never touch the repository or the host filesystem.

## Prepared State

The script prepares:

- One `ADMIN` user
- Two regular `USER` accounts
- One wallet per demo user
- Blockchain-funded wallets, each at a `100` TNX baseline
- Three `CONFIRMED` user transfer transactions forming a balanced cycle
  (each wallet sends and receives the same amount, so balances stay at `100`)
- Populated transaction history and admin monitoring data

The seed is idempotent: funding is skipped for wallets that already claimed
from the faucet, and the demo transfers are skipped when transfer history
already exists. Re-running the seed therefore does not move tokens again, so
demo balances stay at the predictable `100` TNX baseline instead of drifting.

> **Out of scope — transaction status auto-refresh:** Live transfers made during
> the demo are recorded as `PENDING` and appear in history immediately. The
> automatic in-UI `PENDING → CONFIRMED` refresh is handled separately by
> `feat/tx-status-autopoll` and is **not** part of this deterministic
> demo-setup change.

The resulting state supports:

- Login with each demo user
- Wallet balance display
- Transaction history views
- Admin summary data
- Admin users table
- Admin transactions table
- Safe freeze/unfreeze demonstration
- Safe `USER` / `ADMIN` role update demonstration

## Backup Checks

Verify backend and contract health:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/contract
```

Verify transaction rows exist:

```bash
docker compose exec db psql -U postgres -d tokenix -c "SELECT tx_id, type, status, tx_hash FROM transactions ORDER BY created_at DESC LIMIT 10;"
```

Verify demo users exist:

```bash
docker compose exec db psql -U postgres -d tokenix -c "SELECT user_id, email, role, is_frozen FROM users ORDER BY user_id;"
```

## Notes For Demo Operators

- Keep Docker running before the presentation starts.
- The Hardhat container runs `full-deploy` automatically on startup; you do not
  need to run it by hand for the Docker flow.
- Prefer `./scripts/demo-setup.sh`, which waits for the backend, database, and
  Hardhat RPC to be ready before seeding.
- Keep the demo password local to the presentation environment.
- Do not commit generated wallet files, passwords, JWTs, or private keys.
