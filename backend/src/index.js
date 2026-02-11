import express from 'express';
import { authRoutes } from './routes/authRoutes.js';
import { walletRoutes } from './routes/walletRoutes.js';
import blockchainClient from './services/BlockchainClient.js';
import { pool } from './db.js';

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const tokenInfo = await blockchainClient.getTokenDetails();
    res.status(200).json({ status: 'ok', db: 'connected', token: tokenInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/balance/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const balance = await blockchainClient.getBalance(walletAddress);
    res.json({ walletAddress, balance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);

app.listen(port, () => {
  console.log(`Backend service is running on port ${port}`);
});
