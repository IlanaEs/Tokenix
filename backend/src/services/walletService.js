import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";

const blockchainClient = new BlockchainClient();

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
    return rows[0];
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
