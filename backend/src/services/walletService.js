import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";

const blockchainClient = new BlockchainClient();

// Background funding/logging helper — non-blocking from API flow
async function _fundAndLogWallet(userId, walletAddress) {
  try {
    // create a pending transaction record for the funding action
    const insertQ = `
      INSERT INTO transactions (user_id, from_address, to_address, amount, tx_hash, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING tx_id
    `;

    // attempt to fund via blockchain client
    const txHash = await blockchainClient.fundAccount(walletAddress);

    // update transaction as confirmed after wait
    const receipt = await blockchainClient.waitForTransaction(txHash);

    const updateQ = `
      UPDATE transactions SET tx_hash = $1, status = $2, confirmed_at = NOW() WHERE tx_id = $3
    `;

    // insert a record of the funding (mark confirmed)
    const { rows } = await pool.query(insertQ, [userId, null, walletAddress, null, txHash, 'PENDING']);
    const txId = rows[0].tx_id;
    await pool.query(updateQ, [txHash, 'CONFIRMED', txId]);

    console.log(`Funding successful for wallet ${walletAddress}: ${txHash}`);
  } catch (err) {
    try {
      // log failed funding attempt
      await pool.query(
        `INSERT INTO transactions (user_id, from_address, to_address, amount, tx_hash, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, null, walletAddress, null, err?.txHash || null, 'FAILED']
      );
    } catch (dbErr) {
      console.error('Failed to log failed funding attempt:', dbErr);
    }
    console.error(`Funding failed for wallet ${walletAddress}:`, err);
  }
}

export async function createWallet({ userId, walletAddress, publicKey }) {
  const q = `
    INSERT INTO wallets (user_id, wallet_address, public_key)
    VALUES ($1, $2, $3)
    RETURNING user_id AS "userId",
              wallet_address AS "walletAddress",
              public_key AS "publicKey"
  `;
  const values = [userId, walletAddress, publicKey];

  try {
    const { rows } = await pool.query(q, values);
    const created = rows[0];

    // Kick off funding as a background task; don't block the API response
    _fundAndLogWallet(created.userId, created.walletAddress).catch(err => {
      console.error('Background funding task error:', err);
    });

    return created;
  } catch (e) {
    if (e.code === "23505") {
      const error = new Error("Wallet already exists");
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
    throw e;
  }
}

export async function getWalletByUserId(userId) {
  const q = `
    SELECT user_id AS "userId",
           wallet_address AS "walletAddress",
           public_key AS "publicKey"
    FROM wallets
    WHERE user_id = $1
  `;
  const { rows } = await pool.query(q, [userId]);
  return rows[0] || null;
}

export async function getUserWalletAddress(userId) {
  const wallet = await getWalletByUserId(userId);
  if (!wallet?.walletAddress) {
    const error = new Error("Wallet not found");
    error.status = 404;
    throw error;
  }
  return wallet.walletAddress;
}

export async function getBalance(userId) {
  const wallet = await getWalletByUserId(userId);
  if (!wallet) {
    const error = new Error("Wallet not found");
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  try {
    const balance = await blockchainClient.getBalance(wallet.walletAddress);

    return {
      walletAddress: wallet.walletAddress,
      balance,
      source: "blockchain",
    };
  } catch (error) {
    console.error(`walletService.getBalance failed for ${wallet.walletAddress}:`, error);

    const normalizedError = new Error("Blockchain service unavailable");
    normalizedError.status = 502;
    normalizedError.statusCode = 502;
    normalizedError.cause = error;
    throw normalizedError;
  }
}
