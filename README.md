# Tokenix

Tokenix is a full-stack secure digital wallet MVP for authenticated users, locally generated wallets, ERC-20 token balances, frontend-signed transfers, transaction lifecycle tracking, and administrative monitoring.

The system is built with a React frontend, an Express backend, PostgreSQL, Docker Compose, and a local Hardhat blockchain runtime.

![Tokenix architecture overview](docs/assets/tokenix_dark_clean.svg)

## Architecture Overview

Tokenix separates wallet custody, application policy, persistence, and blockchain integration into distinct layers.

| Layer | Responsibility |
| --- | --- |
| Frontend | Authentication UI, wallet creation, local signing, transfer submission, balance and transaction views |
| Backend | JWT-protected API, authorization, transaction verification, database persistence, lifecycle management, admin APIs |
| BlockchainClient | Technical integration layer for contract reads, funding, transaction wait/receipt handling, and local Hardhat support |
| Database | PostgreSQL persistence for users, wallets, roles, frozen state, transactions, statuses, and timestamps |
| Blockchain | Local Hardhat ERC-20 contract runtime for development and MVP verification |

The production-oriented transaction model is frontend-signed:

1. The frontend owns the signing step.
2. User private keys are never sent to, stored by, or used by the backend.
3. The backend verifies submitted transaction data and user ownership.
4. The backend persists transaction records and manages lifecycle state.
5. The blockchain integration layer confirms on-chain execution and receipt status.

`BlockchainClient` is intentionally a technical adapter. It is not the business owner of transaction policy and it must not become a backend custody layer. Local Hardhat-only impersonation or funding helpers may exist for development and testing infrastructure, but they do not replace the frontend-signed user transaction flow.

## Current Feature Coverage

The MVP currently supports:

- Email/password authentication
- JWT-protected backend APIs
- Wallet creation using `walletAddress` and public key data
- Blockchain-backed wallet balance lookup
- Frontend-signed transfers
- Transaction persistence and history retrieval
- Transaction lifecycle statuses: `PENDING`, `CONFIRMED`, `FAILED`
- Admin dashboard backend APIs
- `USER` / `ADMIN` role management
- User freeze/unfreeze administration
- Health checks for the API and configured contract

## Repository Structure

```text
├── backend              # Express API, auth, wallet, transactions, admin, DB access
├── frontend             # React/Vite client application
├── blockchain           # Hardhat ERC-20 contract, deployment, ABI sync
├── docs/assets          # README diagrams and documentation assets
└── docker-compose.yml   # Local runtime orchestration
```

## Running the Full Stack

From the repository root:

```bash
docker compose up --build
```

Default local URLs:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:3000](http://localhost:3000)
- Hardhat RPC: [http://localhost:8545](http://localhost:8545)

Health endpoints:

- `GET /health`
- `GET /health/contract`

The backend service depends on the Hardhat container health state. This prevents the backend from starting before the local blockchain RPC is ready.

## Blockchain Deployment and ABI Sync

For a fresh local blockchain startup, deploy and sync the contract metadata:

```bash
cd blockchain
npm run full-deploy
```

`npm run full-deploy` performs the local contract lifecycle:

1. Compile the Solidity contract.
2. Deploy the ERC-20 contract to the local Hardhat network.
3. Sync the ABI and deployed contract address into the application.

The synced contract metadata is written to:

- `backend/src/abi/MyToken.json`
- `frontend/src/abi/MyToken.json`

The backend reads the configured contract ABI/address through `BlockchainClient`. The frontend uses the synced ABI/address to construct and sign token transfer transactions locally. After a fresh Hardhat chain restart, run `full-deploy` again so the app uses the new local contract address.

## API Surface

### Auth

Authentication uses JWT bearer tokens.

- `POST /auth/register`
- `POST /auth/login`

Passwords are hashed with bcrypt before persistence. Authenticated routes require an `Authorization: Bearer <token>` header.

The system supports email + password registration and login. Email ownership is not verified: full email verification is **not implemented** in this MVP because the project does not include an email delivery service (no SMTP, SendGrid, or similar provider). Login is not blocked on email verification. Email verification is tracked as a known limitation and future improvement (see [Known Limitations](#known-limitations--future-improvements)).

### Wallet

Wallet APIs persist public wallet data and expose blockchain-backed balance reads.

- `POST /wallet/create`
- `GET /wallet/balance`

Wallet records use `walletAddress` in API responses. The backend stores wallet public data only; private keys remain outside the server.

### Transactions

Transaction APIs support signed transfer submission and transaction history.

- `GET /transactions`
- `POST /transactions/transfer`

Transaction records use camelCase API fields:

- `txId`
- `txHash`
- `fromAddress`
- `toAddress`
- `amount`
- `status`
- `createdAt`
- `confirmedAt`

Valid transaction statuses are:

- `PENDING`
- `CONFIRMED`
- `FAILED`

The backend validates transaction ownership and lifecycle state without taking custody of user private keys.

### Admin API

Admin endpoints are protected by admin authorization. A valid authenticated user must have role `ADMIN`; authenticated non-admin users receive `403`, and missing/invalid tokens receive `401`.

- `GET /admin/summary`
- `GET /admin/users`
- `PATCH /admin/users/:userId/freeze`
- `PATCH /admin/users/:userId/role`
- `GET /admin/transactions`

Admin user records expose:

- `userId`
- `email`
- `role`
- `isFrozen`
- `walletAddress`
- `createdAt`

Supported roles are `USER` and `ADMIN`. Admin users cannot freeze themselves in a way that would block their own current admin access.

### Health

- `GET /health` verifies backend and database readiness.
- `GET /health/contract` verifies the configured contract connection and returns the contract address/name when available.

## Transaction Flow

The transfer flow is designed around frontend signing and backend verification:

1. The authenticated user creates or loads a local wallet.
2. The frontend signs and broadcasts the token transfer using local wallet material.
3. The frontend submits the resulting `txHash`, `fromAddress`, `toAddress`, and `amount` to the backend.
4. The backend verifies the submitted transaction against the configured token contract.
5. The backend creates a transaction row with status `PENDING`.
6. Background confirmation logic waits for the blockchain receipt.
7. The transaction becomes `CONFIRMED` or `FAILED`.
8. Transaction history returns the persisted lifecycle state to the frontend.

This flow keeps the backend responsible for verification, persistence, authorization, and lifecycle management while keeping signing authority on the client side.

## Security Model

Tokenix applies the following security boundaries in the MVP:

- JWT authentication protects user, wallet, transaction, and admin routes.
- bcrypt is used for password hashing.
- API responses use camelCase while the database remains snake_case.
- Private keys are not stored by the backend.
- Private keys are not sent to backend APIs.
- Backend authorization enforces user ownership and `USER` / `ADMIN` boundaries.
- Admin APIs require explicit `ADMIN` role authorization.
- Transaction lifecycle data is persisted for audit-oriented monitoring.
- HTTPS/TLS is expected at the deployment edge for non-local environments.

The local Hardhat runtime is a development environment. Production deployment would require managed secrets, HTTPS/TLS termination, persistent infrastructure, hardened CORS/origin policy, and a production blockchain/provider strategy.

## Known Limitations / Future Improvements

The following are recognized gaps in the current MVP and are documented as future improvements rather than active functionality:

- **Email verification is not implemented.** Registration and login work with email + password, but the supplied email address is not verified for ownership. The MVP does not include an email delivery service, so a verification flow (sending and confirming a verification link or code) is out of scope at this stage. Login is intentionally not blocked on email verification. Adding this would require integrating an email provider and an associated verification flow.

## Deployment and Runtime Notes

Docker Compose orchestrates the local MVP services:

- PostgreSQL database
- Express backend
- React frontend
- Hardhat local blockchain node

Important runtime notes:

- The Hardhat chain is local and ephemeral.
- Run `npm run full-deploy` after a fresh blockchain startup or when contract metadata needs to be refreshed.
- ABI/address sync keeps backend and frontend contract metadata aligned.
- `BlockchainClient` depends on the synced ABI/address and the configured RPC URL.
- Contract health is exposed through `/health/contract`.
- The backend should start only after the Hardhat RPC is healthy in the Docker Compose flow.

## Local Development Without Docker

Backend:

```bash
cd backend
npm install
npm start
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Blockchain:

```bash
cd blockchain
npm install
npx hardhat node
```

In another terminal:

```bash
cd blockchain
npm run full-deploy
```

Required backend environment variables include:

- `DATABASE_URL`
- `JWT_SECRET`
- `RPC_URL`

## Testing

Backend tests:

```bash
cd backend
npm test
```

Frontend build:

```bash
cd frontend
npm run build
```

Blockchain deployment and smoke verification require the local Hardhat runtime and synced ABI/address metadata.

## Team Responsibilities

### Ilana Estrin — Backend, System Architecture, Security

Leads backend architecture, authentication and authorization, database schema and data integrity, API contract governance, transaction lifecycle management, and system-wide security boundaries.

### Shely Zino — Frontend, Client Layer, Wallet Experience

Leads the React frontend, wallet experience, local signing workflow, API integration, status handling, and user-facing transaction flows.

### Lior Zvieli — Blockchain, Smart Contract, On-Chain Integration

Leads ERC-20 smart contract design, local blockchain deployment, ABI/address synchronization, Ethers.js integration support, and blockchain reliability testing.
