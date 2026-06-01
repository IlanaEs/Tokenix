import { ethers } from "ethers";
import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import { getUserWalletAddress } from "./walletService.js";

const blockchainClient = new BlockchainClient();
const MAX_TRANSFER_MESSAGE_AGE_MS = 5 * 60 * 1000;
const MAX_TRANSFER_MESSAGE_FUTURE_SKEW_MS = 60 * 1000;

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

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

function assertSignedMessageShape(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw createHttpError("message is required", 400);
  }

  const requiredFields = ["fromAddress", "toAddress", "amount", "timestamp"];
  for (const field of requiredFields) {
    if (message[field] === undefined || message[field] === null || message[field] === "") {
      throw createHttpError(`message.${field} is required`, 400);
    }
  }
}

function normalizeSignedMessage(message) {
  assertSignedMessageShape(message);

  const fromAddress = String(message.fromAddress).trim();
  const normalizedTransfer = normalizeTransferInput({
    toAddress: message.toAddress,
    amount: message.amount,
  });

  if (!ethers.isAddress(fromAddress)) {
    throw createHttpError("Invalid fromAddress", 400);
  }

  return {
    fromAddress: ethers.getAddress(fromAddress),
    toAddress: ethers.getAddress(normalizedTransfer.toAddress),
    amount: normalizedTransfer.amount,
    timestamp: String(message.timestamp).trim(),
  };
}

function validateTransferTimestamp(timestamp, now = new Date()) {
  const transferTime = new Date(timestamp);
  const transferMs = transferTime.getTime();

  if (!Number.isFinite(transferMs)) {
    throw createHttpError("Invalid timestamp", 400);
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw createHttpError("Invalid server timestamp", 500);
  }

  if (nowMs - transferMs > MAX_TRANSFER_MESSAGE_AGE_MS) {
    throw createHttpError("Transfer timestamp expired", 400);
  }

  if (transferMs - nowMs > MAX_TRANSFER_MESSAGE_FUTURE_SKEW_MS) {
    throw createHttpError("Transfer timestamp is in the future", 400);
  }
}

export function buildSignedTransferMessage(message) {
  const normalized = normalizeSignedMessage(message);

  return JSON.stringify({
    fromAddress: normalized.fromAddress,
    toAddress: normalized.toAddress,
    amount: normalized.amount,
    timestamp: normalized.timestamp,
  });
}

export function normalizeSignedTransferInput({
  toAddress,
  amount,
  message,
  signature,
  now = new Date(),
}) {
  if (!signature || typeof signature !== "string") {
    throw createHttpError("signature is required", 400);
  }

  const normalizedTransfer = normalizeTransferInput({ toAddress, amount });
  const normalizedMessage = normalizeSignedMessage(message);
  const normalizedTopLevelToAddress = ethers.getAddress(normalizedTransfer.toAddress);

  if (normalizedMessage.toAddress !== normalizedTopLevelToAddress) {
    throw createHttpError("message.toAddress must match toAddress", 400);
  }

  if (normalizedMessage.amount !== normalizedTransfer.amount) {
    throw createHttpError("message.amount must match amount", 400);
  }

  if (normalizedMessage.fromAddress === normalizedMessage.toAddress) {
    throw createHttpError("Self-transfer is not allowed", 400);
  }

  validateTransferTimestamp(normalizedMessage.timestamp, now);

  return {
    toAddress: normalizedTopLevelToAddress,
    amount: normalizedTransfer.amount,
    message: normalizedMessage,
    signature,
  };
}

export function verifySignature({ message, signature, userWalletAddress }) {
  if (!userWalletAddress) {
    throw createHttpError("Wallet not found", 404);
  }

  const normalizedMessage = normalizeSignedMessage(message);
  const normalizedUserWalletAddress = ethers.getAddress(String(userWalletAddress).trim());

  if (normalizedMessage.fromAddress !== normalizedUserWalletAddress) {
    throw createHttpError(
      "Transfer source wallet does not belong to authenticated user",
      401
    );
  }

  if (!signature) {
    throw createHttpError("Signature verification data is incomplete", 400);
  }

  let recoveredAddress;

  try {
    recoveredAddress = ethers.verifyMessage(buildSignedTransferMessage(normalizedMessage), signature);
  } catch (error) {
    throw createHttpError("Invalid signature", 401);
  }

  const recoveredChecksum = ethers.getAddress(recoveredAddress);

  if (recoveredChecksum !== normalizedMessage.fromAddress) {
    throw createHttpError("Invalid signature", 401);
  }

  return recoveredChecksum;
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

async function markTransactionFailed(txId, txHash = null) {
  await pool.query(
    `
    UPDATE transactions
    SET status = 'FAILED',
        tx_hash = COALESCE($2, tx_hash)
    WHERE tx_id = $1
    `,
    [txId, txHash]
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
      // Guard the failure write itself: a secondary DB error here must not
      // escape as an unhandled rejection and crash the backend process.
      try {
        await markTransactionFailed(txId);
      } catch (markError) {
        console.error(`Failed to mark transaction ${txId} as FAILED:`, markError);
      }
    }
  })();
}

function normalizeSubmittedTransferInput({ txHash, fromAddress, toAddress, amount }) {
  if (!txHash || !fromAddress || !toAddress || amount === undefined || amount === null) {
    throw createHttpError("txHash, fromAddress, toAddress, and amount are required", 400);
  }

  const normalizedTxHash = String(txHash).trim();
  if (!ethers.isHexString(normalizedTxHash, 32)) {
    throw createHttpError("Invalid txHash", 400);
  }

  if (!ethers.isAddress(fromAddress)) {
    throw createHttpError("Invalid fromAddress", 400);
  }

  const normalizedTransfer = normalizeTransferInput({ toAddress, amount });

  return {
    txHash: normalizedTxHash,
    fromAddress: ethers.getAddress(String(fromAddress).trim()),
    toAddress: ethers.getAddress(normalizedTransfer.toAddress),
    amount: normalizedTransfer.amount,
  };
}

async function ensureUniqueTxHash(txHash) {
  const { rows } = await pool.query(
    `
    SELECT tx_id AS "txId"
    FROM transactions
    WHERE LOWER(tx_hash) = LOWER($1)
    LIMIT 1
    `,
    [txHash]
  );

  if (rows[0]) {
    throw createHttpError("Transaction hash already recorded", 409);
  }
}

function getContractAddress() {
  blockchainClient.ensureConfigured();
  return ethers.getAddress(blockchainClient.contractAddress);
}

function decodeTokenTransferData(data) {
  try {
    const parsed = blockchainClient.contract.interface.parseTransaction({ data });
    if (parsed?.name !== "transfer") {
      throw createHttpError("Transaction is not an ERC-20 transfer", 400);
    }

    return {
      toAddress: ethers.getAddress(parsed.args[0]),
      amount: parsed.args[1],
    };
  } catch (error) {
    if (error?.status || error?.statusCode) {
      throw error;
    }

    throw createHttpError("Transaction data is not a supported token transfer", 400);
  }
}

function validateTransferReceiptLog({ receipt, expected }) {
  if (!receipt) {
    return;
  }

  const contractAddress = getContractAddress();
  const transferTopic = ethers.id("Transfer(address,address,uint256)");

  const matchingLog = receipt.logs.find((log) => {
    if (ethers.getAddress(log.address) !== contractAddress) {
      return false;
    }

    if (log.topics[0] !== transferTopic) {
      return false;
    }

    try {
      const parsed = blockchainClient.contract.interface.parseLog(log);
      return (
        parsed?.name === "Transfer" &&
        ethers.getAddress(parsed.args.from) === expected.fromAddress &&
        ethers.getAddress(parsed.args.to) === expected.toAddress &&
        parsed.args.value === ethers.parseUnits(expected.amount, 18)
      );
    } catch {
      return false;
    }
  });

  if (Number(receipt.status) === 1 && !matchingLog) {
    throw createHttpError("Transaction receipt does not contain the expected token transfer", 400);
  }
}

export async function validateSubmittedTransfer({ txHash, fromAddress, toAddress, amount }) {
  const expected = normalizeSubmittedTransferInput({ txHash, fromAddress, toAddress, amount });
  const contractAddress = getContractAddress();
  const transaction = await blockchainClient.getTransaction(expected.txHash);

  if (!transaction) {
    throw createHttpError("Transaction hash not found on-chain", 404);
  }

  if (!transaction.to || ethers.getAddress(transaction.to) !== contractAddress) {
    throw createHttpError("Transaction does not target the configured token contract", 400);
  }

  if (!transaction.from || ethers.getAddress(transaction.from) !== expected.fromAddress) {
    throw createHttpError("Transaction sender does not match fromAddress", 400);
  }

  const decodedTransfer = decodeTokenTransferData(transaction.data);
  const expectedAmount = ethers.parseUnits(expected.amount, 18);

  if (decodedTransfer.toAddress !== expected.toAddress) {
    throw createHttpError("Transaction recipient does not match toAddress", 400);
  }

  if (decodedTransfer.amount !== expectedAmount) {
    throw createHttpError("Transaction amount does not match amount", 400);
  }

  const receipt = await blockchainClient.getTransactionReceipt(expected.txHash);
  validateTransferReceiptLog({ receipt, expected });

  return {
    ...expected,
    receiptStatus: receipt ? (Number(receipt.status) === 1 ? "CONFIRMED" : "FAILED") : "PENDING",
  };
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
  txHash = null,
  status = "PENDING",
  confirmedAt = null,
}) {
  const q = `
    INSERT INTO transactions
      (user_id, type, from_address, to_address, amount, tx_hash, status, confirmed_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
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

  const { rows } = await pool.query(q, [
    userId,
    type,
    fromAddress,
    toAddress,
    amount,
    txHash,
    status,
    confirmedAt,
  ]);
  return rows[0];
}

function formatTransferResponse(tx) {
  return {
    txId: tx.txId,
    fromAddress: tx.fromAddress,
    toAddress: tx.toAddress,
    amount: String(tx.amount),
    status: tx.status,
    txHash: tx.txHash || null,
    createdAt: tx.createdAt,
    confirmedAt: tx.confirmedAt || null,
  };
}

export async function recordSubmittedTransfer({ userId, txHash, fromAddress, toAddress, amount }) {
  const normalized = normalizeSubmittedTransferInput({ txHash, fromAddress, toAddress, amount });
  const userWalletAddress = await getUserWalletAddress(userId);

  if (ethers.getAddress(userWalletAddress) !== normalized.fromAddress) {
    throw createHttpError(
      "Transfer source wallet does not belong to authenticated user",
      401
    );
  }

  await ensureUniqueTxHash(normalized.txHash);

  const validated = await validateSubmittedTransfer(normalized);

  const tx = await createPendingTransaction({
    userId,
    type: TRANSACTION_TYPES.USER_TRANSFER,
    fromAddress: validated.fromAddress,
    toAddress: validated.toAddress,
    amount: validated.amount,
    txHash: validated.txHash,
  });

  finalizeTransactionInBackground(tx.txId, validated.txHash);

  return formatTransferResponse(tx);
}
