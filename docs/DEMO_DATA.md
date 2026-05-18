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

The script stores temporary demo wallet private keys outside the repository by default:

```text
/tmp/tokenix-demo-wallets.json
```

This file is local runtime material only. It must not be committed.

To choose a different local-only path:

```bash
DEMO_WALLET_FILE="/tmp/tokenix-demo-wallets.json"
```

## Prepared State

The script prepares:

- One `ADMIN` user
- Two regular `USER` accounts
- One wallet per demo user
- Blockchain-funded wallets
- At least two `CONFIRMED` user transfer transactions
- One `PENDING` demo transaction for monitoring visibility
- Populated transaction history and admin monitoring data

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
