# Tokenix – Secure Digital Wallet for Blockchain Tokens

Tokenix is a FinTech & Cyber project that demonstrates the design and implementation of a secure digital wallet for creating, storing, and transferring blockchain tokens.
The project is built as a full-stack system combining a backend API, a client-side web interface, and blockchain smart contracts, with a strong emphasis on security, clean architecture, and test-driven development.

The system uses a single ERC-20 smart contract written in Solidity (OpenZeppelin) to mint and manage tokens. Users generate cryptographic key pairs locally, while the backend is responsible for authentication, transaction management, and interaction with the blockchain. All communication is secured using HTTPS/TLS, and sensitive data is encrypted at rest.

---

## Main Functional Requirements

* Create a new user account and generate a cryptographic key pair for signing and encryption.
* Display wallet token balances, including token identifiers.
* Transfer tokens between users with clear transaction states (Pending, Confirmed, Failed).
* Record all transactions in an auditable transaction log.
* Provide users with access to their transaction history.

---

## Non-Functional Requirements

* Enforce HTTPS/TLS for all communication.
* Securely store passwords and sensitive data in a cloud database.
* Use containerization (Docker) to ensure environment parity and portability.
* Support horizontal scalability of services.
* Apply Test-Driven Development (TDD) with unit and integration tests for all components.

---

## Technology Mapping

| Layer          | Technologies                                                    |
| -------------- | --------------------------------------------------------------- |
| Frontend       | React (Vite), client-side key management                        |
| Backend        | Node.js / Express (API, authentication, blockchain interaction) |
| Smart Contract | Solidity (OpenZeppelin ERC-20), Hardhat, Ignition               |
| Database       | PostgreSQL or MongoDB                                           |
| DevOps         | Docker, Docker Compose, GitHub Actions (CI/CD)                  |

---

## Security and Threat Modeling

The project includes a STRIDE threat analysis covering:

* Spoofing
* Tampering
* Repudiation
* Information Disclosure
* Denial of Service
* Elevation of Privilege

Mitigations include strong authentication, digital signatures, encrypted communication, encrypted storage, audit logging, and traffic monitoring.

---

## Repository Structure

```
├── backend         # Node.js / Express API server
│   ├── Dockerfile
│   ├── package.json
│   └── src
│       └── index.js
├── frontend        # React application (Vite)
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src
│       ├── App.jsx
│       └── main.jsx
├── blockchain        # Hardhat project for smart contracts
│   ├── contracts
│   │   └── Token.sol
│   ├── ignition
│   │   └── modules
│   │       └── Token.js
│   ├── test
│   │   └── Token.js
│   ├── hardhat.config.js
│   └── package.json
├── docker-compose.yml  # Service orchestration
└── NOT-README.md
```

---

## Getting Started

### Prerequisites

* Docker and Docker Compose installed
* Node.js (for running services without Docker)

---

## Running the Full Stack (Recommended)

From the repository root:

```bash
docker compose up --build
```

Once running:

* Backend API: [http://localhost:3000](http://localhost:3000)

  * Health check: [http://localhost:3000/health](http://localhost:3000/health)
* Frontend: [http://localhost:5173](http://localhost:5173)

---

## Running Services Locally (Without Docker)

### Backend

```bash
cd backend
npm install
npm start
```

The backend listens on port 3000 and expects a `DATABASE_URL` environment variable. When using Docker Compose, this is set automatically.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend development server runs on [http://localhost:5173](http://localhost:5173).

### Smart Contracts

```bash
cd blockchain
npm install
npm run full-deploy
```

This will compile contracts, deploy them to the local Hardhat network, and sync ABIs to backend/frontend.
Note: Ensure `npx hardhat node` is running in a separate terminal.

---

## Design and Testing

The system design follows UML principles, including:

* Use Case Diagrams
* Sequence Diagrams
* Class Diagrams
* ERD (Entity-Relationship Diagrams)

All components are developed using Test-Driven Development (TDD), with tests written before implementation using appropriate frameworks (e.g., Jest).

---

## Team Responsibilities

* **Student A — Backend · DB · Security · Tests**
Responsible for the backend API, database design & integration, security controls (auth, encryption, logging), and unit/integration testing.

* **Student B — Blockchain · Wallet · Frontend · Integration**
Responsible for the smart contracts, wallet/key management, frontend application, and end-to-end integration between frontend, backend, and blockchain.
---

## Work Plan / MVP

The Minimum Viable Product includes:

* A backend API with health-check and database connectivity.
* A React frontend confirming successful operation.
* A Solidity ERC-20 smart contract with deployment scripts.
* A Docker Compose setup for running all components together.

This foundation provides a secure and extensible base for future feature expansion.
