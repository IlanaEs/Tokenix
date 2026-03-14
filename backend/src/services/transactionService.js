import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import { getUserWalletAddress } from "./walletService.js";

const blockchainClient = new BlockchainClient();

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

export async function getTransactionsByUserId(userId) {
  const q = `
    SELECT tx_id AS "txId",
           amount AS "amount",
           to_address AS "toAddress",
           status AS "status",
           created_at AS "createdAt"
    FROM transactions
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;

  const { rows } = await pool.query(q, [userId]);
  return rows;
}

export async function createPendingTransaction({ userId, toAddress, amount }) {
  const q = `
    INSERT INTO transactions
      (user_id, from_address, to_address, amount, status)
    VALUES
      ($1, $2, $3, $4, 'PENDING')
    RETURNING tx_id AS "txId",
              to_address AS "toAddress",
              amount AS "amount",
              status AS "status",
              created_at AS "createdAt"
  `;

  const values = [userId, "TEMP_FROM_ADDRESS", toAddress, amount];
  const { rows } = await pool.query(q, values);
  return rows[0];
}

export async function processTransferE2E({ userId, toAddress, amount }) {
  const fromAddress = await getUserWalletAddress(userId);

  const inserted = await pool.query(
    `
    INSERT INTO transactions (user_id, from_address, to_address, amount, status, created_at)
    VALUES ($1, $2, $3, $4, 'PENDING', NOW())
    RETURNING tx_id AS "txId",
              from_address AS "fromAddress",
              to_address AS "toAddress",
              amount AS "amount",
              status AS "status",
              created_at AS "createdAt"
    `,
    [userId, fromAddress, toAddress, amount]
  );

  const tx = inserted.rows[0];

  blockchainClient.ensureConfigured();

  let txHash;

  try {
    txHash = await blockchainClient.transfer({
      fromAddress,
      toAddress,
      amount,
    });
  } catch (error) {
    await markTransactionFailed(tx.txId);
    throw error;
  }

  await pool.query(
    `UPDATE transactions SET tx_hash = $1 WHERE tx_id = $2`,
    [txHash, tx.txId]
  );

  finalizeTransactionInBackground(tx.txId, txHash);

  return { ...tx, txHash };
}
