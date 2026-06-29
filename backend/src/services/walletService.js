import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import {
  createFundingJobInTransaction,
  getWalletStatus,
  prepareFundingJobSeed,
} from "./walletFundingService.js";

const blockchainClient = new BlockchainClient();

export async function createWallet({ userId, walletAddress, publicKey }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `
      INSERT INTO wallets (user_id, wallet_address, public_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id AS "userId",
                wallet_address AS "walletAddress",
                public_key AS "publicKey"
      `,
      [userId, walletAddress, publicKey]
    );

    let created = inserted.rows[0] || null;

    if (!created) {
      const existing = await client.query(
        `
        SELECT user_id AS "userId",
               wallet_address AS "walletAddress",
               public_key AS "publicKey"
        FROM wallets
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );
      created = existing.rows[0];
    }

    const fundingSeed = await prepareFundingJobSeed({
      userId: created.userId,
      walletAddress: created.walletAddress,
    });

    await createFundingJobInTransaction(client, {
      userId: created.userId,
      walletAddress: created.walletAddress,
      seed: fundingSeed,
    });

    await client.query("COMMIT");

    return {
      created: Boolean(inserted.rows[0]),
      status: await getWalletStatus(userId),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
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
