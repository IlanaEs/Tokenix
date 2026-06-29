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

Set the demo password at runtime:

```bash
DEMO_PASSWORD="<choose-a-local-demo-password>"
```

Do not commit real passwords or secrets.

## Runtime Setup

Start the local stack:

```bash
docker compose up --build
```

After a fresh Hardhat blockchain startup, deploy and sync the contract:

```bash
cd blockchain
npm run full-deploy
```

## Run The Seed Script

From the backend directory:

```bash
cd backend
DEMO_PASSWORD="<choose-a-local-demo-password>" \
RPC_URL="http://127.0.0.1:8545" \
node scripts/prepare-demo-data.js
```

The script stores generated demo wallet private keys in `DEMO_WALLET_FILE`,
which defaults to a temporary path outside the repository:

```text
/tmp/tokenix-demo-wallets.json
```

This file is local runtime material only. It must not be committed.

### Stable demo wallets across container restarts (recommended)

The default `/tmp` location lives inside the backend container, so recreating
that container (e.g. to change env vars) wipes the file and the next seed
generates **new** wallet addresses and keys. To keep demo wallet addresses and
keys stable across restarts/re-seeds, point `DEMO_WALLET_FILE` at a
host-mounted, gitignored directory.

In `docker-compose.yml`, mount a local directory into the backend service and
set the env var (no secrets in compose — only the path):

```yaml
  backend:
    environment:
      DEMO_WALLET_FILE: /app/.demo-data/tokenix-demo-wallets.json
    volumes:
      - ./backend/.demo-data:/app/.demo-data
```

`backend/.demo-data/` is gitignored because the file holds local-chain private
keys. Because the keys persist, re-running the seed is idempotent for funding:
the faucet allows a single claim per wallet, so already-funded wallets are
skipped and only their readiness/transaction records are refreshed.

For a one-off non-default local path instead:

```bash
DEMO_WALLET_FILE="/tmp/tokenix-demo-wallets.json"
```

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
- Run `full-deploy` after a fresh local blockchain startup.
- Run the seed script after the backend, database, and Hardhat RPC are ready.
- Keep the demo password local to the presentation environment.
- Do not commit generated wallet files, passwords, JWTs, or private keys.
