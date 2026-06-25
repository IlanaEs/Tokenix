import { ethers } from "ethers";
import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";
import {
  decryptRawTransaction,
  encryptRawTransaction,
  getPublicEncryptionErrorCode,
} from "./outboxEncryption.js";
import {
  FUNDING_PHASE_STATUSES,
  LIFECYCLE_STATES,
} from "./walletFundingService.js";

const blockchainClient = new BlockchainClient();

const WORKER_ENABLED = process.env.WALLET_FUNDING_WORKER_ENABLED === "true";
const WORKER_ID = process.env.WALLET_FUNDING_WORKER_ID || `worker-${process.pid}`;
const POLL_MS = Number(process.env.WALLET_FUNDING_WORKER_POLL_MS || "5000");
const LEASE_SECONDS = Number(process.env.WALLET_FUNDING_LEASE_SECONDS || "30");
const GAS_FUNDING_AMOUNT = process.env.WALLET_GAS_FUNDING_AMOUNT_ETH || "0.005";
const TOKEN_FUNDING_AMOUNT = process.env.WALLET_TOKEN_FUNDING_AMOUNT || "100";

let timer = null;
let stopping = false;

function safeWorkerErrorCode(error, fallback = "BLOCKCHAIN_UNAVAILABLE") {
  if (error?.code === "OUTBOX_KEY_UNAVAILABLE" || error?.code === "OUTBOX_KEY_INVALID") {
    return getPublicEncryptionErrorCode(error);
  }
  if (error?.code === "FAUCET_SIGNER_UNAVAILABLE") {
    return "FAUCET_SIGNER_UNAVAILABLE";
  }
  if (error?.code === "FAUCET_NOT_CONFIGURED") {
    return "FAUCET_NOT_CONFIGURED";
  }
  if (error?.code === "TOKEN_TRANSFER_EVENT_MISSING") {
    return "TOKEN_TRANSFER_EVENT_MISSING";
  }
  if (error?.code === "TOKEN_FUNDING_REVERTED") {
    return "TOKEN_FUNDING_REVERTED";
  }
  return fallback;
}

async function acquireJob() {
  const { rows } = await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET locked_by = $1,
        locked_until = NOW() + ($2 || ' seconds')::INTERVAL,
        version = version + 1,
        updated_at = NOW()
    WHERE funding_job_id = (
      SELECT funding_job_id
      FROM wallet_funding_jobs
      WHERE funding_ready = FALSE
        AND lifecycle_state IN ('funding_pending', 'funding_failed', 'blocked')
        AND next_retry_at <= NOW()
        AND (locked_until IS NULL OR locked_until < NOW())
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING *
    `,
    [WORKER_ID, String(LEASE_SECONDS)]
  );
  return rows[0] || null;
}

async function markJobError(job, phase, status, errorCode) {
  const fields = phase === "gas"
    ? "gas_status = $2, gas_error_code = $3"
    : "token_status = $2, token_error_code = $3";

  await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET ${fields},
        lifecycle_state = CASE
          WHEN $2 = 'failed' THEN 'funding_failed'
          WHEN $2 = 'needs_manual_review' THEN 'needs_manual_review'
          ELSE 'blocked'
        END,
        next_retry_at = NOW() + INTERVAL '30 seconds',
        locked_by = NULL,
        locked_until = NULL,
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND locked_by = $4
      AND version = $5
    `,
    [job.funding_job_id, status, errorCode, WORKER_ID, job.version]
  );
}

async function releaseJob(job, retryDelaySeconds = 5) {
  await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET locked_by = NULL,
        locked_until = NULL,
        next_retry_at = NOW() + ($2 || ' seconds')::INTERVAL,
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND locked_by = $3
      AND version = $4
    `,
    [job.funding_job_id, String(retryDelaySeconds), WORKER_ID, job.version]
  );
}

async function initializeNonceReservation({ signerAddress, chainId, chainEpochId }) {
  const providerNonce = await blockchainClient.provider.getTransactionCount(signerAddress, "pending");
  const { rows } = await pool.query(
    `
    SELECT COALESCE(MAX(nonce) + 1, $3::INTEGER) AS "nextPersistedNonce"
    FROM signed_transaction_outbox
    WHERE signer_address = $1
      AND chain_id = $2
      AND chain_epoch_id = $4
      AND status NOT IN ('confirmed', 'failed')
    `,
    [signerAddress, chainId, providerNonce, chainEpochId]
  );

  const nextNonce = Math.max(providerNonce, Number(rows[0]?.nextPersistedNonce || providerNonce));

  await pool.query(
    `
    INSERT INTO faucet_nonce_reservations (signer_address, chain_id, chain_epoch_id, next_nonce)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (signer_address, chain_id, chain_epoch_id)
    DO UPDATE SET
      next_nonce = GREATEST(faucet_nonce_reservations.next_nonce, EXCLUDED.next_nonce),
      updated_at = NOW()
    `,
    [signerAddress, chainId, chainEpochId, nextNonce]
  );
}

async function reserveNonce({ signerAddress, chainId, chainEpochId }) {
  await initializeNonceReservation({ signerAddress, chainId, chainEpochId });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT next_nonce AS "nextNonce"
      FROM faucet_nonce_reservations
      WHERE signer_address = $1
        AND chain_id = $2
        AND chain_epoch_id = $3
      FOR UPDATE
      `,
      [signerAddress, chainId, chainEpochId]
    );
    const nonce = Number(rows[0].nextNonce);
    await client.query(
      `
      UPDATE faucet_nonce_reservations
      SET next_nonce = next_nonce + 1,
          updated_at = NOW()
      WHERE signer_address = $1
        AND chain_id = $2
        AND chain_epoch_id = $3
      `,
      [signerAddress, chainId, chainEpochId]
    );
    await client.query("COMMIT");
    return nonce;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOutbox(jobId, phase) {
  const { rows } = await pool.query(
    `
    SELECT
      outbox_id AS "outboxId",
      tx_hash AS "txHash",
      signer_address AS "signerAddress",
      nonce,
      chain_id AS "chainId",
      chain_epoch_id AS "chainEpochId",
      encrypted_raw_tx AS "encryptedRawTx",
      encryption_iv AS "encryptionIv",
      encryption_tag AS "encryptionTag",
      encryption_key_id AS "encryptionKeyId",
      status
    FROM signed_transaction_outbox
    WHERE funding_job_id = $1
      AND phase = $2
    ORDER BY outbox_id DESC
    LIMIT 1
    `,
    [jobId, phase]
  );
  return rows[0] || null;
}

async function persistOutbox({ job, phase, signed }) {
  const encrypted = encryptRawTransaction(signed.rawTransaction);
  await pool.query(
    `
    INSERT INTO signed_transaction_outbox (
      funding_job_id,
      phase,
      tx_hash,
      signer_address,
      nonce,
      chain_id,
      chain_epoch_id,
      encrypted_raw_tx,
      encryption_iv,
      encryption_tag,
      encryption_key_id,
      gas_limit,
      max_fee_per_gas,
      max_priority_fee_per_gas,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'signed')
    ON CONFLICT (tx_hash) DO NOTHING
    `,
    [
      job.funding_job_id,
      phase,
      signed.txHash,
      signed.signerAddress,
      signed.nonce,
      signed.chainId,
      job.chain_epoch_id,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.keyId,
      signed.gasLimit,
      signed.maxFeePerGas,
      signed.maxPriorityFeePerGas,
    ]
  );
}

async function setPhaseSigned(job, phase, signed) {
  const fields = phase === "gas"
    ? "gas_status = 'signed', gas_tx_hash = $2, gas_nonce = $3, gas_signer_address = $4"
    : "token_status = 'signed', token_tx_hash = $2, token_nonce = $3, token_signer_address = $4";
  await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET ${fields},
        chain_id = COALESCE(chain_id, $5),
        chain_epoch_id = COALESCE(chain_epoch_id, $6),
        lifecycle_state = 'funding_pending',
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND locked_by = $7
      AND version = $8
    `,
    [job.funding_job_id, signed.txHash, signed.nonce, signed.signerAddress, signed.chainId, job.chain_epoch_id, WORKER_ID, job.version]
  );
}

async function broadcastOutbox(job, phase, outbox) {
  if (outbox.chainEpochId !== job.chain_epoch_id) {
    await markJobError(job, phase, FUNDING_PHASE_STATUSES.NEEDS_MANUAL_REVIEW, "CHAIN_EPOCH_MISMATCH");
    return false;
  }

  const rawTransaction = decryptRawTransaction({
    ciphertext: outbox.encryptedRawTx,
    iv: outbox.encryptionIv,
    tag: outbox.encryptionTag,
    keyId: outbox.encryptionKeyId,
  });

  await blockchainClient.broadcastSignedTransaction(rawTransaction);
  await pool.query(
    `
    UPDATE signed_transaction_outbox
    SET status = 'broadcast',
        updated_at = NOW()
    WHERE outbox_id = $1
    `,
    [outbox.outboxId]
  );

  const statusField = phase === "gas" ? "gas_status" : "token_status";
  await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET ${statusField} = 'broadcast',
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND locked_by = $2
      AND version = $3
    `,
    [job.funding_job_id, WORKER_ID, job.version]
  );

  return true;
}

async function finalizePhaseIfReady(job, phase, txHash) {
  const { receipt, confirmations } = await blockchainClient.getConfirmations(txHash);
  if (!receipt || confirmations < Number(job.confirmation_target || 1)) {
    const statusField = phase === "gas" ? "gas_status" : "token_status";
    const confField = phase === "gas" ? "gas_confirmations" : "token_confirmations";
    await pool.query(
      `
      UPDATE wallet_funding_jobs
      SET ${statusField} = 'pending',
          ${confField} = $2,
          updated_at = NOW()
      WHERE funding_job_id = $1
        AND locked_by = $3
        AND version = $4
      `,
      [job.funding_job_id, confirmations, WORKER_ID, job.version]
    );
    return false;
  }

  if (Number(receipt.status) !== 1) {
    await markJobError(
      job,
      phase,
      FUNDING_PHASE_STATUSES.FAILED,
      phase === "gas" ? "GAS_FUNDING_REVERTED" : "TOKEN_FUNDING_REVERTED"
    );
    return false;
  }

  if (phase === "token") {
    blockchainClient.validateFaucetClaimReceipt({
      receipt,
      walletAddress: job.wallet_address,
      requestId: job.token_request_id,
      amountRaw: ethers.parseUnits(TOKEN_FUNDING_AMOUNT, 18).toString(),
    });
  }

  const fields = phase === "gas"
    ? "gas_status = 'confirmed', gas_confirmations = $2, gas_confirmed_at = NOW(), gas_error_code = NULL"
    : "token_status = 'confirmed', token_confirmations = $2, token_confirmed_at = NOW(), token_transfer_event_validated = TRUE, token_error_code = NULL";

  await pool.query(
    `
    UPDATE wallet_funding_jobs
    SET ${fields},
        lifecycle_state = CASE WHEN $4 = 'token' THEN 'ready' ELSE lifecycle_state END,
        funding_ready = CASE WHEN $4 = 'token' THEN TRUE ELSE funding_ready END,
        completed_at = CASE WHEN $4 = 'token' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND locked_by = $3
      AND version = $5
    `,
    [job.funding_job_id, confirmations, WORKER_ID, phase, job.version]
  );

  await pool.query(
    `
    UPDATE signed_transaction_outbox
    SET status = 'confirmed',
        updated_at = NOW()
    WHERE funding_job_id = $1
      AND phase = $2
    `,
    [job.funding_job_id, phase]
  );

  return true;
}

async function preparePhase(job, phase) {
  const signerAddress = await blockchainClient.getFaucetSignerWallet().getAddress();
  const chainId = await blockchainClient.getChainId();
  const chainEpochId = blockchainClient.getChainEpochId();

  if (job.chain_epoch_id && job.chain_epoch_id !== chainEpochId) {
    await markJobError(job, phase, FUNDING_PHASE_STATUSES.NEEDS_MANUAL_REVIEW, "CHAIN_EPOCH_MISMATCH");
    return null;
  }

  const nonce = await reserveNonce({ signerAddress, chainId, chainEpochId });
  const signed = phase === "gas"
    ? await blockchainClient.buildSignedGasFundingTransaction({
      toAddress: job.wallet_address,
      nonce,
      amountEth: GAS_FUNDING_AMOUNT,
    })
    : await blockchainClient.buildSignedTokenFundingTransaction({
      walletAddress: job.wallet_address,
      requestId: job.token_request_id,
      nonce,
      tokenAmount: TOKEN_FUNDING_AMOUNT,
    });

  signed.nonce = nonce;
  await persistOutbox({ job: { ...job, chain_epoch_id: chainEpochId }, phase, signed });
  await setPhaseSigned({ ...job, chain_epoch_id: chainEpochId }, phase, signed);
  return getOutbox(job.funding_job_id, phase);
}

async function processPhase(job, phase) {
  const status = phase === "gas" ? job.gas_status : job.token_status;
  const txHash = phase === "gas" ? job.gas_tx_hash : job.token_tx_hash;

  let outbox = await getOutbox(job.funding_job_id, phase);
  if (!outbox && status === FUNDING_PHASE_STATUSES.NOT_STARTED) {
    outbox = await preparePhase(job, phase);
  }

  if (!outbox) {
    await markJobError(job, phase, FUNDING_PHASE_STATUSES.BLOCKED, "OUTBOX_MISSING");
    return false;
  }

  if ([FUNDING_PHASE_STATUSES.BROADCAST, FUNDING_PHASE_STATUSES.PENDING].includes(status)) {
    const finalized = await finalizePhaseIfReady(job, phase, txHash || outbox.txHash);
    if (finalized) {
      return true;
    }
  }

  if ([FUNDING_PHASE_STATUSES.SIGNED, FUNDING_PHASE_STATUSES.BROADCAST, FUNDING_PHASE_STATUSES.PENDING, FUNDING_PHASE_STATUSES.NOT_STARTED].includes(status)) {
    await broadcastOutbox(job, phase, outbox);
  }

  return finalizePhaseIfReady(job, phase, txHash || outbox.txHash);
}

async function processJob(job) {
  try {
    if (job.gas_status !== FUNDING_PHASE_STATUSES.CONFIRMED) {
      await processPhase(job, "gas");
      await releaseJob(job);
      return;
    }

    if (job.token_status !== FUNDING_PHASE_STATUSES.CONFIRMED) {
      await processPhase(job, "token");
      await releaseJob(job);
      return;
    }

    await pool.query(
      `
      UPDATE wallet_funding_jobs
      SET lifecycle_state = 'ready',
          funding_ready = TRUE,
          locked_by = NULL,
          locked_until = NULL,
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE funding_job_id = $1
        AND locked_by = $2
        AND version = $3
      `,
      [job.funding_job_id, WORKER_ID, job.version]
    );
  } catch (error) {
    const phase = job.gas_status !== FUNDING_PHASE_STATUSES.CONFIRMED ? "gas" : "token";
    await markJobError(job, phase, FUNDING_PHASE_STATUSES.BLOCKED, safeWorkerErrorCode(error));
  }
}

async function tick() {
  if (stopping) return;
  try {
    const job = await acquireJob();
    if (job) {
      await processJob(job);
    }
  } catch (error) {
    console.error("Wallet funding worker tick failed:", error?.code || error?.message);
  } finally {
    if (!stopping) {
      timer = setTimeout(tick, POLL_MS);
    }
  }
}

export function startWalletFundingWorker() {
  if (!WORKER_ENABLED) {
    console.log("Wallet funding worker disabled. Set WALLET_FUNDING_WORKER_ENABLED=true to enable it.");
    return;
  }

  if (timer) return;
  stopping = false;
  console.log(`Wallet funding worker starting as ${WORKER_ID}`);
  timer = setTimeout(tick, 0);
}

export function stopWalletFundingWorker() {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
