import express from 'express';
import { authRoutes } from './routes/authRoutes.js';
import { walletRoutes } from './routes/walletRoutes.js';
import { transactionRoutes } from './routes/transactionRoutes.js';
import BlockchainClient from './services/BlockchainClient.js';
import { pool } from './db.js';

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
    const contractName = await blockchainClient.getContractName();
    return res.status(200).json({ status: 'ok', contractName });
  } catch (err) {
    console.error(err);
    return res.status(err.status || err.statusCode || 500).json({
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
    if (e.statusCode) {
      return res.status(e.statusCode).json({ message: e.message });
    }
    next(e);
  }
});

app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/transactions', transactionRoutes);

app.listen(port, () => {
  console.log(`Backend service is running on port ${port}`);
});
