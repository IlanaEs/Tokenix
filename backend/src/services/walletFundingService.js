import { ethers } from "ethers";
import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";

const blockchainClient = new BlockchainClient();

export const FUNDING_PHASE_STATUSES = Object.freeze({
  NOT_STARTED: "not_started",
  PREPARING: "preparing",
  SIGNED: "signed",
  BROADCAST: "broadcast",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  BLOCKED: "blocked",
  NEEDS_MANUAL_REVIEW: "needs_manual_review",
});

export const LIFECYCLE_STATES = Object.freeze({
  WALLET_MISSING: "wallet_missing",
  FUNDING_PENDING: "funding_pending",
  READY: "ready",
  FUNDING_FAILED: "funding_failed",
  LEGACY_UNVERIFIED: "legacy_unverified",
  TEMPORARILY_UNAVAILABLE: "temporarily_unavailable",
  NEEDS_MANUAL_REVIEW: "needs_manual_review",
  BLOCKED: "blocked",
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BLOCKCHAIN_UNAVAILABLE: "Live wallet balances are temporarily unavailable.",
  FAUCET_NOT_CONFIGURED: "Wallet funding is temporarily unavailable.",
  FAUCET_SIGNER_UNAVAILABLE: "Wallet funding is temporarily unavailable.",
  OUTBOX_KEY_UNAVAILABLE: "Wallet funding is temporarily unavailable.",
  OUTBOX_KEY_INVALID: "Wallet funding is temporarily unavailable.",
  FUNDING_RETRY_NOT_ALLOWED: "Funding retry is not available for this wallet state.",
});

function publicError(code) {
  return {
    code,
    message: PUBLIC_ERROR_MESSAGES[code] || "Wallet funding is temporarily unavailable.",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function formatLiveBalance(balance) {
  if (!balance) return null;
  return {
    raw: String(balance.raw),
    decimals: balance.decimals,
    display: balance.display,
    fetchedAt: nowIso(),
  };
}

function getLifecycleFromJob(job) {
  if (!job) return LIFECYCLE_STATES.LEGACY_UNVERIFIED;
  if (job.fundingReady) return LIFECYCLE_STATES.READY;
  if (
    job.lifecycleState === LIFECYCLE_STATES.NEEDS_MANUAL_REVIEW ||
    job.gasStatus === FUNDING_PHASE_STATUSES.NEEDS_MANUAL_REVIEW ||
    job.tokenStatus === FUNDING_PHASE_STATUSES.NEEDS_MANUAL_REVIEW
  ) {
    return LIFECYCLE_STATES.NEEDS_MANUAL_REVIEW;
  }
  if (
    job.lifecycleState === LIFECYCLE_STATES.BLOCKED ||
    job.gasStatus === FUNDING_PHASE_STATUSES.BLOCKED ||
    job.tokenStatus === FUNDING_PHASE_STATUSES.BLOCKED
  ) {
    return LIFECYCLE_STATES.BLOCKED;
  }
  if (
    job.lifecycleState === LIFECYCLE_STATES.FUNDING_FAILED ||
    job.gasStatus === FUNDING_PHASE_STATUSES.FAILED ||
    job.tokenStatus === FUNDING_PHASE_STATUSES.FAILED
  ) {
    return LIFECYCLE_STATES.FUNDING_FAILED;
  }
  return LIFECYCLE_STATES.FUNDING_PENDING;
}

function toFundingShape(job) {
  if (!job) return null;
  return {
    confirmationTarget: job.confirmationTarget,
    chainId: job.chainId == null ? null : Number(job.chainId),
    chainEpochId: job.chainEpochId || null,
    gas: {
      status: job.gasStatus,
      txHash: job.gasTxHash || null,
      confirmationsPersisted: Number(job.gasConfirmations || 0),
      confirmedAt: job.gasConfirmedAt || null,
      errorCode: job.gasStatus === FUNDING_PHASE_STATUSES.CONFIRMED ? null : job.gasErrorCode || null,
    },
    token: {
      status: job.tokenStatus,
      txHash: job.tokenTxHash || null,
      confirmationsPersisted: Number(job.tokenConfirmations || 0),
      confirmedAt: job.tokenConfirmedAt || null,
      transferEventValidated: Boolean(job.tokenTransferEventValidated),
      requestId: job.tokenRequestId,
      errorCode: job.tokenStatus === FUNDING_PHASE_STATUSES.CONFIRMED ? null : job.tokenErrorCode || null,
    },
  };
}

async function getWalletAndFundingRows(clientOrPool, userId) {
  const { rows } = await clientOrPool.query(
    `
    SELECT
      w.user_id AS "userId",
      w.wallet_address AS "walletAddress",
      w.public_key AS "publicKey",
      f.funding_job_id AS "fundingJobId",
      f.lifecycle_state AS "lifecycleState",
      f.funding_ready AS "fundingReady",
      f.confirmation_target AS "confirmationTarget",
      f.token_request_id AS "tokenRequestId",
      f.chain_id AS "chainId",
      f.chain_epoch_id AS "chainEpochId",
      f.gas_status AS "gasStatus",
      f.gas_tx_hash AS "gasTxHash",
      f.gas_confirmations AS "gasConfirmations",
      f.gas_confirmed_at AS "gasConfirmedAt",
      f.gas_error_code AS "gasErrorCode",
      f.token_status AS "tokenStatus",
      f.token_tx_hash AS "tokenTxHash",
      f.token_confirmations AS "tokenConfirmations",
      f.token_confirmed_at AS "tokenConfirmedAt",
      f.token_transfer_event_validated AS "tokenTransferEventValidated",
      f.token_error_code AS "tokenErrorCode"
    FROM wallets w
    LEFT JOIN wallet_funding_jobs f ON f.user_id = w.user_id
    WHERE w.user_id = $1
    LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

function computeRequestId({ chainId, faucetAddress, tokenAddress, walletAddress }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "address", "address"],
    [
      "TOKENIX_INITIAL_FAUCET",
      BigInt(chainId),
      ethers.getAddress(faucetAddress),
      ethers.getAddress(tokenAddress),
      ethers.getAddress(walletAddress),
    ]
  );
  return ethers.keccak256(encoded);
}

export async function prepareFundingJobSeed({ userId, walletAddress }) {
  let chainId = null;
  let chainEpochId = blockchainClient.getChainEpochId();
  let tokenRequestId;

  try {
    chainId = await blockchainClient.getChainId();
    if (!blockchainClient.faucetAddress || !blockchainClient.contractAddress) {
      throw new Error("Faucet not configured");
    }
    tokenRequestId = computeRequestId({
      chainId,
      faucetAddress: blockchainClient.faucetAddress,
      tokenAddress: blockchainClient.contractAddress,
      walletAddress,
    });
  } catch {
    tokenRequestId = ethers.id(`TOKENIX_UNCONFIGURED_FAUCET:${userId}:${walletAddress}`);
  }

  return {
    lifecycleState: LIFECYCLE_STATES.FUNDING_PENDING,
    confirmationTarget: blockchainClient.getConfirmationTarget(),
    tokenRequestId,
    chainId,
    chainEpochId,
  };
}

export async function createFundingJobInTransaction(client, { userId, walletAddress, seed }) {
  await client.query(
    `
    INSERT INTO wallet_funding_jobs (
      user_id,
      wallet_address,
      lifecycle_state,
      confirmation_target,
      token_request_id,
      chain_id,
      chain_epoch_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [
      userId,
      walletAddress,
      seed.lifecycleState,
      seed.confirmationTarget,
      seed.tokenRequestId,
      seed.chainId,
      seed.chainEpochId,
    ]
  );
}

export async function getWalletStatus(userId) {
  const row = await getWalletAndFundingRows(pool, userId);

  if (!row) {
    return {
      lifecycleState: LIFECYCLE_STATES.WALLET_MISSING,
      fundingReady: false,
      blockchainAvailable: true,
      wallet: null,
      currentTokenBalance: null,
      currentNativeBalance: null,
      funding: null,
      observations: null,
      errors: [],
    };
  }

  const lifecycleState = getLifecycleFromJob(row);
  let blockchainAvailable = true;
  let currentTokenBalance = null;
  let currentNativeBalance = null;
  const errors = [];

  try {
    const [tokenBalance, nativeBalance] = await Promise.all([
      blockchainClient.getTokenBalanceRaw(row.walletAddress),
      blockchainClient.getNativeBalanceRaw(row.walletAddress),
    ]);
    currentTokenBalance = formatLiveBalance(tokenBalance);
    currentNativeBalance = formatLiveBalance(nativeBalance);
  } catch {
    blockchainAvailable = false;
    errors.push(publicError("BLOCKCHAIN_UNAVAILABLE"));
  }

  return {
    lifecycleState,
    fundingReady: Boolean(row.fundingReady),
    blockchainAvailable,
    wallet: {
      walletAddress: row.walletAddress,
    },
    currentTokenBalance,
    currentNativeBalance,
    funding: toFundingShape(row),
    observations: null,
    errors,
  };
}

export async function enqueueFundingRetry(userId) {
  const { rows } = await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET
      next_retry_at = NOW(),
      gas_status = CASE
        WHEN funding_ready = TRUE OR gas_status = 'confirmed' THEN gas_status
        ELSE 'not_started'
      END,
      token_status = CASE
        WHEN funding_ready = TRUE OR token_status = 'confirmed' THEN token_status
        WHEN gas_status = 'confirmed' THEN 'not_started'
        ELSE token_status
      END,
      lifecycle_state = CASE
        WHEN funding_ready = TRUE THEN lifecycle_state
        ELSE 'funding_pending'
      END,
      updated_at = NOW()
    WHERE user_id = $1
      AND funding_ready = FALSE
      AND lifecycle_state IN ('funding_failed', 'funding_pending', 'blocked')
    RETURNING funding_job_id
    `,
    [userId]
  );

  if (!rows[0]) {
    const error = new Error("Funding retry is not available for this wallet state");
    error.status = 409;
    error.publicCode = "FUNDING_RETRY_NOT_ALLOWED";
    throw error;
  }

  return getWalletStatus(userId);
}

export { publicError };
