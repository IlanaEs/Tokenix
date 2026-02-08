# Tokenix

Tokenix is a minimalist fintech & cyber project skeleton built to support a backend API, a React frontend, and blockchain smart contracts.  This repository provides a clear separation of responsibilities between the different layers and includes Docker Compose configuration for local development.

## Repository Structure

```
├── backend         # Node.js/Express API server
│   ├── Dockerfile  # Container definition for the backend
│   ├── package.json
│   └── src
│       └── index.js
├── frontend        # React application
│   ├── Dockerfile  # Container definition for the frontend
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src
│       ├── App.jsx
│       └── main.jsx
├── contracts       # Hardhat project for smart contracts
│   ├── contracts
│   │   └── MyToken.sol
│   ├── scripts
│   │   └── deploy.js
│   ├── hardhat.config.js
│   └── package.json
├── docker-compose.yml  # Compose file to orchestrate services
└── README.md           # Project overview and instructions (this file)
```

## Getting Started

The project uses Docker Compose to run all services together. Make sure you have Docker and Docker Compose installed.

### Running the full stack

From the repository root run:

```bash
docker compose up --build
```

This command will build the backend and frontend images and start the services along with a PostgreSQL database. Once running:

- The backend API will be available at `http://localhost:3000`. Check `http://localhost:3000/health` for a health status response.
- The frontend React app will be served at `http://localhost:5173` and will display a message confirming it is running.

### Backend

The backend, located in `/backend`, is a simple Express server that connects to a PostgreSQL database. It exposes a single `GET /health` endpoint that verifies the database connection and returns a JSON status.

To run it locally without Docker:

```bash
cd backend
npm install
npm start
```

The server will listen on port `3000` and expects a `DATABASE_URL` environment variable for connecting to the database. When running via Docker Compose this environment variable is automatically set.

### Frontend

The frontend, located in `/frontend`, is a minimal React application powered by Vite. It simply renders a “Tokenix running” message on the page.

To run it locally without Docker:

```bash
cd frontend
npm install
npm run dev
```

The development server will start on `http://localhost:5173`.

### Contracts

The `/contracts` directory contains a Hardhat project with a placeholder ERC‑20 token contract (`MyToken.sol`) and a basic deploy script.

To compile and deploy the contract locally:

```bash
cd contracts
npm install
npx hardhat compile
# Start a local blockchain (e.g. via `npx hardhat node` in another terminal) and then:
npx hardhat run scripts/deploy.js --network localhost
```

### Team Responsibilities

This project distinguishes between two primary roles to help with collaboration:

- **Student A – Backend & DevOps**: Responsible for the Node.js backend, database integration, Docker/Docker Compose configuration, and overall repository structure.
- **Student B – Blockchain, Frontend & Integration**: Responsible for the React frontend, Hardhat contracts, and wiring up integration points between the frontend and backend.

### Minimum Viable Product (MVP)

The MVP for this project includes:

- A backend API server with a health-check endpoint and database connectivity.
- A React frontend that can be served and displays confirmation that it is running.
- A Hardhat project with a simple ERC‑20 token contract and deploy script.
- A Docker Compose setup for running all components together with a PostgreSQL database.

By following this structure you will have a clear foundation to build upon as you expand the features of Tokenix.