import { pool } from "../db.js";

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
      return null; // already has wallet or address already taken
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

export async function getBalance(userId) {
  const wallet = await getWalletByUserId(userId);
  if (!wallet) return null;

  // placeholder until BlockchainClient is wired
  return { walletAddress: wallet.walletAddress, balance: "0" };
}
