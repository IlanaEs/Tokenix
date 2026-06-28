import express from 'express';
import { authRoutes } from './routes/authRoutes.js';
import { walletRoutes } from './routes/walletRoutes.js';
import { transactionRoutes } from './routes/transactionRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import BlockchainClient from './services/BlockchainClient.js';
import { pool } from './db.js';
import { runDatabaseBootstrap } from './bootstrap/runDatabaseBootstrap.js';
import { startWalletFundingWorker, stopWalletFundingWorker } from './services/walletFundingWorker.js';

const app = express();
app.use(express.json());
const blockchainClient = new BlockchainClient();

const port = process.env.PORT || 3000;

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'DB not ready' });
  }
});

app.get('/health/contract', async (req, res) => {
  try {
    const { contractAddress, contractName } = await blockchainClient.getContractInfo();
    return res.status(200).json({
      status: 'ok',
      contractAddress,
      contractName,
    });
  } catch (err) {
    console.error(err);
    const status = err.status || err.statusCode || 500;
    const responseStatus = status === 500 ? 500 : 502;

    return res.status(responseStatus).json({
      status: 'error',
      message: err.message,
    });
  }
});

app.get('/balance/:walletAddress', async (req, res, next) => {
  try {
    const { walletAddress } = req.params;
    const balance = await blockchainClient.getBalance(walletAddress);
    return res.json({ walletAddress, balance });
  } catch (e) {
    next(e);
  }
});

app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/transactions', transactionRoutes);
app.use('/admin', adminRoutes);

// Catch-all for unmatched routes — keeps 404s consistent with the JSON error
// envelope instead of Express's default HTML response. Registered after all
// route mounts and before the error handler.
app.use((req, res) => {
  return res.status(404).json({ message: 'Not found' });
});

// Global error handler — must be the last middleware registered. Returns the
// uniform { message } envelope and never leaks stack traces / internal error
// messages on 500 responses.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  return res.status(status).json({ message });
});

// Validate required environment configuration before starting. Required
// secrets fail fast; blockchain vars only warn so the client can degrade
// gracefully (it warns and no-ops when address/ABI are unavailable).
if (!process.env.JWT_SECRET) {
  console.error("Missing required environment variable: JWT_SECRET");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing required environment variable: DATABASE_URL");
  process.exit(1);
}
if (!process.env.RPC_URL) {
  console.warn("RPC_URL is not set; blockchain features may be unavailable.");
}
if (!process.env.CONTRACT_ADDRESS) {
  console.warn("CONTRACT_ADDRESS is not set; blockchain features may be unavailable.");
}

try {
  await runDatabaseBootstrap();

  const server = app.listen(port, () => {
    console.log(`Backend service is running on port ${port}`);
  });
  startWalletFundingWorker();

  const shutdown = () => {
    stopWalletFundingWorker();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error("Failed to bootstrap database schema:", error);
  process.exit(1);
}
