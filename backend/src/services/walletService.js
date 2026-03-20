import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import { TRANSACTION_TYPES } from "./transactionService.js";

const blockchainClient = new BlockchainClient();

async function _fundAndLogWallet(userId, walletAddress) {
  let txId = null;
  let txHash = null;

  try {
    // Wallet creation should succeed even if blockchain funding finishes a bit
    // later, so we persist a pending funding row before sending the ETH.
    blockchainClient.ensureConfigured();

    const insertQ = `
      INSERT INTO transactions (user_id, type, from_address, to_address, amount, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING tx_id AS "txId"
    `;

    const inserted = await pool.query(insertQ, [
      userId,
      TRANSACTION_TYPES.SYSTEM_FUNDING,
      null,
      walletAddress,
      null,
      "PENDING",
    ]);

    txId = inserted.rows[0].txId;

    txHash = await blockchainClient.fundAccount(walletAddress);

    await pool.query(
      `
      UPDATE transactions
      SET tx_hash = $1
      WHERE tx_id = $2
      `,
      [txHash, txId]
    );

    const receipt = await blockchainClient.waitForTransaction(txHash);

    if (receipt.status === 1n || receipt.status === 1) {
      await pool.query(
        `
        UPDATE transactions
        SET status = 'CONFIRMED',
            confirmed_at = NOW()
        WHERE tx_id = $1
        `,
        [txId]
      );

      console.log(`Funding successful for wallet ${walletAddress}: ${txHash}`);
      return;
    }

    await pool.query(
      `
      UPDATE transactions
      SET status = 'FAILED'
      WHERE tx_id = $1
      `,
      [txId]
    );
  } catch (err) {
    if (txId) {
      try {
        await pool.query(
          `
          UPDATE transactions
          SET status = 'FAILED',
              tx_hash = COALESCE($1, tx_hash)
          WHERE tx_id = $2
          `,
          [txHash || err?.txHash || null, txId]
        );
      } catch (dbErr) {
        console.error("Failed to update failed funding attempt:", dbErr);
      }
    } else {
      try {
        await pool.query(
          `
          INSERT INTO transactions
            (user_id, type, from_address, to_address, amount, tx_hash, status, created_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, NOW())
          `,
          [
            userId,
            TRANSACTION_TYPES.SYSTEM_FUNDING,
            null,
            walletAddress,
            null,
            txHash || err?.txHash || null,
            "FAILED",
          ]
        );
      } catch (dbErr) {
        console.error("Failed to log failed funding attempt:", dbErr);
      }
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

    _fundAndLogWallet(created.userId, created.walletAddress).catch((err) => {
      console.error("Background funding task error:", err);
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
