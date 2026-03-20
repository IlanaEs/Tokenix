import { ethers } from "ethers";
import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import { getUserWalletAddress } from "./walletService.js";

const blockchainClient = new BlockchainClient();

export const TRANSACTION_TYPES = Object.freeze({
  SYSTEM_FUNDING: "SYSTEM_FUNDING",
  USER_TRANSFER: "USER_TRANSFER",
});

const ALLOWED_TRANSACTION_TYPES = new Set(Object.values(TRANSACTION_TYPES));

function normalizeTransactionType(type) {
  if (!type) return null;

  const normalized = String(type).trim().toUpperCase();
  if (!ALLOWED_TRANSACTION_TYPES.has(normalized)) {
    const error = new Error("Invalid transaction type");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function normalizeTransferInput({ toAddress, amount }) {
  if (!toAddress || amount === undefined || amount === null) {
    const error = new Error("toAddress and amount are required");
    error.status = 400;
    throw error;
  }

  const normalizedAddress = String(toAddress).trim();
  if (!ethers.isAddress(normalizedAddress)) {
    const error = new Error("Invalid toAddress");
    error.status = 400;
    throw error;
  }

  const normalizedAmount = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(normalizedAmount)) {
    const error = new Error("Invalid amount");
    error.status = 400;
    throw error;
  }

  const parsedAmount = ethers.parseUnits(normalizedAmount, 18);
  if (parsedAmount <= 0n) {
    const error = new Error("Amount must be greater than 0");
    error.status = 400;
    throw error;
  }

  return {
    toAddress: normalizedAddress,
    amount: normalizedAmount,
  };
}

async function markTransactionConfirmed(txId) {
  await pool.query(
    `
    UPDATE transactions
    SET status = 'CONFIRMED',
        confirmed_at = NOW()
    WHERE tx_id = $1
    `,
    [txId]
  );
}

async function markTransactionFailed(txId) {
  await pool.query(
    `
    UPDATE transactions
    SET status = 'FAILED'
    WHERE tx_id = $1
    `,
    [txId]
  );
}

function finalizeTransactionInBackground(txId, txHash) {
  void (async () => {
    try {
      const receipt = await blockchainClient.waitForTransaction(txHash);

      if (receipt.status === 1n || receipt.status === 1) {
        await markTransactionConfirmed(txId);
        return;
      }

      await markTransactionFailed(txId);
    } catch (error) {
      console.error(`Failed to finalize transaction ${txId} (${txHash}):`, error);
      await markTransactionFailed(txId);
    }
  })();
}

export async function getTransactionsByUserId(userId, type = null) {
  const normalizedType = normalizeTransactionType(type);

  const values = [userId];
  let whereClause = `WHERE user_id = $1`;

  if (normalizedType) {
    // Keep the query shape simple while supporting a strict type filter.
    values.push(normalizedType);
    whereClause += ` AND type = $2`;
  }

  const q = `
    SELECT tx_id AS "txId",
           type AS "type",
           from_address AS "fromAddress",
           to_address AS "toAddress",
           amount AS "amount",
           tx_hash AS "txHash",
           status AS "status",
           created_at AS "createdAt",
           confirmed_at AS "confirmedAt"
    FROM transactions
    ${whereClause}
    ORDER BY created_at DESC
  `;

  const { rows } = await pool.query(q, values);
  return rows;
}

export async function createPendingTransaction({
  userId,
  type = TRANSACTION_TYPES.USER_TRANSFER,
  fromAddress,
  toAddress,
  amount,
}) {
  const q = `
    INSERT INTO transactions
      (user_id, type, from_address, to_address, amount, status)
    VALUES
      ($1, $2, $3, $4, $5, 'PENDING')
    RETURNING tx_id AS "txId",
              type AS "type",
              from_address AS "fromAddress",
              to_address AS "toAddress",
              amount AS "amount",
              tx_hash AS "txHash",
              status AS "status",
              created_at AS "createdAt",
              confirmed_at AS "confirmedAt"
  `;

  const { rows } = await pool.query(q, [userId, type, fromAddress, toAddress, amount]);
  return rows[0];
}

export async function processTransferE2E({ userId, toAddress, amount }) {
  blockchainClient.ensureConfigured();

  const normalized = normalizeTransferInput({ toAddress, amount });
  const fromAddress = await getUserWalletAddress(userId);

  const tx = await createPendingTransaction({
    userId,
    type: TRANSACTION_TYPES.USER_TRANSFER,
    fromAddress,
    toAddress: normalized.toAddress,
    amount: normalized.amount,
  });

  let txHash;

  try {
    txHash = await blockchainClient.transfer({
      fromAddress,
      toAddress: normalized.toAddress,
      amount: normalized.amount,
    });
  } catch (error) {
    await markTransactionFailed(tx.txId);
    throw error;
  }

  await pool.query(
    `
    UPDATE transactions
    SET tx_hash = $1
    WHERE tx_id = $2
    `,
    [txHash, tx.txId]
  );

  finalizeTransactionInBackground(tx.txId, txHash);

  return {
    ...tx,
    txHash,
  };
}
