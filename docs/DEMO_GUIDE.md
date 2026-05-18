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

Start the full local stack from the repository root:

```bash
docker compose up --build
```

For a fresh local blockchain startup, deploy the contract and sync metadata:

```bash
cd blockchain
npm run full-deploy
```

Runtime notes:

- Hardhat runs the local blockchain used for the demo.
- `full-deploy` compiles and deploys the token contract, then syncs the ABI/address into the backend and frontend.
- The backend uses the synced ABI/address through `BlockchainClient`.
- Health endpoints are available to confirm the backend and contract are ready:
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
5. Observe:
   - `txHash`
   - `PENDING` → `CONFIRMED`
6. Open transaction history.

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
- Run `npm run full-deploy` after any fresh Hardhat blockchain startup.
- Prepare a funded wallet before the live demo.
- Keep an Admin account ready.
- Keep a regular `USER` account ready for freeze/unfreeze and role-management examples.
- Avoid resetting the Hardhat chain during the demo unless you are ready to run `full-deploy` again.
