const express = require('express');
const { Pool } = require('pg');
const blockchainClient = require('./services/BlockchainClient');

const app = express();

// Determine port and database connection from environment
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tokenixdb';

// Initialize a connection pool to PostgreSQL
const pool = new Pool({ connectionString: databaseUrl });

// Simple health check endpoint
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
        // Responding with agreed "sacred" variable names
        res.json({ walletAddress, balance });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.listen(port, () => {
  console.log(`Backend service is running on port ${port}`);
});