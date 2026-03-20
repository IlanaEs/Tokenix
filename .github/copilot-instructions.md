---
name: copilot-instructions
description: "Workspace instructions for Tokenix: quick start, dev commands, architecture notes, ABI sync, and where to find key files. Use when: developing, running, or debugging the stack locally."
---

**Quick Start**
- **Prereqs:** Docker, Node.js (16+), npm
- **Bring up full stack (dev):** `docker compose up --build`

**Run Locally (without Docker)**
- **Backend:** `cd backend && npm install && npm start`
- **Frontend:** `cd frontend && npm install && npm run dev`
- **Hardhat (blockchain):** `cd blockchain && npm install && npx hardhat node`
- **Sync ABIs (after build/deploy):** `node blockchain/scripts/sync-abi.js`

**Build & Test**
- Hardhat tests: `cd blockchain && npm test`
- Frontend build: `cd frontend && npm run build`

**Architecture & Key Locations**
- Backend API and services: `backend/src/` (`index.js`, `services/`, `routes/`, `middleware/`)
- Frontend React app: `frontend/src/` (`pages/`, `TokenDemo.jsx`, `lib/`)
- Smart contracts and ignition modules: `blockchain/contracts/`, `blockchain/ignition/modules/`
- DB init & migrations: `backend/db/init.sql`, `backend/db/migrations/`
- Docker Compose orchestration: `docker-compose.yml`

**Conventions & Notes**
- The project expects ABI files to be synced to `frontend/src/abi` and `backend/src/abi` via `blockchain/scripts/sync-abi.js`.
- Env vars used in `docker-compose.yml` (e.g., `JWT_SECRET`, `CONTRACT_ADDRESS`) are development defaults — override them for non-dev deployments.
- Backend uses ESM; some JSON loading uses `createRequire()` — keep runtime environment consistent.

**When to edit these instructions**
- Update this file when adding new services, changing compose wiring, or changing ABI deployment/sync steps.

**Useful files to reference**
- README: [README.md](README.md)
- Backend entry: [backend/src/index.js](backend/src/index.js)
- ABI sync script: [blockchain/scripts/sync-abi.js](blockchain/scripts/sync-abi.js)
- Contracts: [blockchain/contracts/Token.sol](blockchain/contracts/Token.sol)
- Compose: [docker-compose.yml](docker-compose.yml)

**Example agent prompts**
- "How do I run the full dev stack for Tokenix?"
- "Where is the ABI and how do I sync it after contract deployment?"
- "Explain the backend transaction flow and where to update it."
