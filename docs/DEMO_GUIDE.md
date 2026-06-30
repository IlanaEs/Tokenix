# Tokenix — Demo Guide

## 1. Demo Goal

This demo presents the final Tokenix MVP as a secure token wallet system with:

- Secure wallet creation and authenticated access
- Frontend-signed blockchain transactions
- Backend transaction verification and lifecycle tracking
- Admin monitoring and user management
- Local blockchain integration through Hardhat and an ERC-20 contract

The goal is to show a complete product flow from user wallet actions to backend persistence, blockchain confirmation, and admin oversight.

## 2. Environment Setup

From the repository root, on a clean checkout of `main`, run the deterministic
bootstrap (clean start → auto-deploy → seed → verify):

```bash
./scripts/demo-setup.sh
```

This is the one-command path to the full demo state (3 demo users, funded
wallets at the `100` TNX baseline, transaction history). See
[`DEMO_DATA.md`](./DEMO_DATA.md) for what it does and a manual equivalent.

Runtime notes:

- Hardhat runs the local blockchain used for the demo, and **auto-deploys the
  contracts and syncs the ABI/address on every startup** (its entrypoint runs
  `npm run full-deploy`). No manual deploy step is needed for the Docker flow.
- The backend waits for Hardhat to report healthy, then uses the synced
  ABI/address through `BlockchainClient`.
- The wallet funding worker is enabled in `docker-compose.yml` for local demos,
  so wallets created live in the UI are auto-funded to the `100` TNX baseline.
- The flow is fully self-contained. It requires **no** manual `full-deploy`,
  **no** host-side `.demo-data` folder, **no** pre-existing Docker volumes or
  prior chain/DB state, and **no** local `.env` — `./scripts/demo-setup.sh`
  starts from a clean state (`docker compose down -v`).
- Health endpoints confirm the backend and contract are ready:
  - `GET /health`
  - `GET /health/contract`

## 3. Demo Accounts

Use placeholder demo accounts only. Do not publish real passwords, tokens, or secrets in the guide.

```text
admin@example.com
user1@example.com
user2@example.com
```

Recommended roles:

- `admin@example.com` — `ADMIN`
- `user1@example.com` — `USER`
- `user2@example.com` — `USER`

## 4. Recommended Demo Flow

### User Flow

1. Register or log in.
2. Create a wallet.
3. View blockchain-backed wallet balance.
4. Send tokens.
5. Observe the returned `txHash` and the transaction recorded in history.
6. Open transaction history.

> **Out of scope — transaction status auto-refresh:** A submitted transfer is
> recorded and shown in history as `PENDING`. The automatic in-UI
> `PENDING → CONFIRMED` refresh is **not** part of the deterministic demo setup;
> it is handled separately by the `feat/tx-status-autopoll` work. Until that is
> merged, re-open/refresh the history view (or check `GET /transactions`) to see
> the confirmed state.

### Admin Flow

1. Open Admin Dashboard.
2. View system summary.
3. View users table.
4. Freeze / unfreeze a user.
5. Change `USER` ↔ `ADMIN` role.
6. View transactions monitoring.
7. Open System Health section.

## 5. Important Technical Points To Mention During Demo

- Private keys are never stored on the backend.
- Transaction signing happens in the frontend.
- The backend verifies submitted blockchain transaction data.
- Transaction lifecycle is tracked in PostgreSQL.
- Blockchain balances are read from the actual local ERC-20 contract state.
- Admin APIs are protected by role-based middleware.
- API responses use project contract names such as `txId`, `txHash`, and `walletAddress`.
- User roles are represented as `USER` and `ADMIN`.

## 6. Suggested Backup Checks

Use these checks if the UI appears slow or a service needs quick verification:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/contract
```

Expected result:

- `/health` returns backend/database readiness.
- `/health/contract` confirms the configured contract connection.

## 7. Demo Tips

- Keep Docker running before the presentation starts.
- The Hardhat container redeploys and re-syncs automatically on each startup, so
  no manual `full-deploy` is needed for the Docker flow.
- Prepare a funded wallet before the live demo.
- Keep an Admin account ready.
- Keep a regular `USER` account ready for freeze/unfreeze and role-management examples.
- Avoid resetting the Hardhat chain during the demo unless you are ready to run `full-deploy` again.
