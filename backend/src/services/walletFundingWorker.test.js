import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import BlockchainClient from "./BlockchainClient.js";
import { encryptRawTransaction } from "./outboxEncryption.js";
import { pool } from "../db.js";

process.env.TX_OUTBOX_ACTIVE_KEY_ID = "test-key";
process.env.TX_OUTBOX_ENCRYPTION_KEYS = JSON.stringify({
  "test-key": Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
});

const { __test } = await import("./walletFundingWorker.js");

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const originalBroadcastSignedTransaction = BlockchainClient.prototype.broadcastSignedTransaction;
const originalBuildSignedGasFundingTransaction = BlockchainClient.prototype.buildSignedGasFundingTransaction;
const originalBuildSignedTokenFundingTransaction = BlockchainClient.prototype.buildSignedTokenFundingTransaction;
const originalGetConfirmations = BlockchainClient.prototype.getConfirmations;

function restore(t) {
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    BlockchainClient.prototype.broadcastSignedTransaction = originalBroadcastSignedTransaction;
    BlockchainClient.prototype.buildSignedGasFundingTransaction = originalBuildSignedGasFundingTransaction;
    BlockchainClient.prototype.buildSignedTokenFundingTransaction = originalBuildSignedTokenFundingTransaction;
    BlockchainClient.prototype.getConfirmations = originalGetConfirmations;
  });
}

function encryptedOutbox(overrides = {}) {
  const rawTransaction = "0x02f86c82053980843b9aca00847735940082520894f39fd6e51aad88f6f4ce6ab8827279cfffb92266880de0b6b3a764000080c080a0f13b5d4f4e4a55b6cc66d8c0c9d0d70c9e2f2c84bb1cebd8c0e2f0d6f313f7a01111111111111111111111111111111111111111111111111111111111111111";
  const encrypted = encryptRawTransaction(rawTransaction);
  return {
    outboxId: 11,
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    fundingJobId: 77,
    phase: "gas",
    signerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    nonce: 7,
    chainId: 31337,
    chainEpochId: "epoch-1",
    encryptedRawTx: encrypted.ciphertext,
    encryptionIv: encrypted.iv,
    encryptionTag: encrypted.tag,
    encryptionKeyId: encrypted.keyId,
    status: "signed",
    rawTransaction,
    ...overrides,
  };
}

function gasJob(overrides = {}) {
  return {
    funding_job_id: 77,
    wallet_address: "0x1111111111111111111111111111111111111111",
    chain_epoch_id: "epoch-1",
    confirmation_target: 1,
    gas_status: "signed",
    gas_tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token_status: "not_started",
    token_tx_hash: null,
    locked_by: "worker-test",
    version: 3,
    ...overrides,
  };
}

test("processJob recovers a signed gas transaction by rebroadcasting the same persisted raw transaction", async (t) => {
  restore(t);
  const outbox = encryptedOutbox();
  const queries = [];
  const broadcasts = [];

  pool.query = async (sql, params = []) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (String(sql).includes("FROM signed_transaction_outbox")) {
      return { rows: [outbox] };
    }
    return { rows: [] };
  };
  BlockchainClient.prototype.broadcastSignedTransaction = async (rawTransaction) => {
    broadcasts.push(rawTransaction);
    return null;
  };
  BlockchainClient.prototype.buildSignedGasFundingTransaction = async () => {
    throw new Error("should not create a second gas transaction");
  };
  BlockchainClient.prototype.getConfirmations = async () => ({ receipt: null, confirmations: 0 });

  await __test.processJob(gasJob());

  assert.deepEqual(broadcasts, [outbox.rawTransaction]);
  assert.equal(
    queries.filter(({ sql }) => sql.includes("INSERT INTO signed_transaction_outbox")).length,
    0,
    "recovery must not insert a second outbox row"
  );
  assert.ok(
    queries.some(({ sql }) => sql.includes("SET status = 'broadcast'")),
    "persisted outbox row should advance to broadcast"
  );
});

test("processJob finalizes a broadcast transaction after restart without rebroadcasting", async (t) => {
  restore(t);
  const outbox = encryptedOutbox({ status: "broadcast" });
  let broadcastCount = 0;
  const queries = [];

  pool.query = async (sql, params = []) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (String(sql).includes("FROM signed_transaction_outbox")) {
      return { rows: [outbox] };
    }
    return { rows: [] };
  };
  BlockchainClient.prototype.broadcastSignedTransaction = async () => {
    broadcastCount += 1;
  };
  BlockchainClient.prototype.getConfirmations = async () => ({
    receipt: { status: 1, logs: [] },
    confirmations: 1,
  });

  await __test.processJob(gasJob({ gas_status: "broadcast" }));

  assert.equal(broadcastCount, 0);
  assert.ok(
    queries.some(({ sql }) => sql.includes("gas_status = 'confirmed'")),
    "confirmed receipt should finalize the gas phase"
  );
});

test("processJob blocks rebroadcast when the outbox chain epoch differs", async (t) => {
  restore(t);
  const outbox = encryptedOutbox({ chainEpochId: "old-epoch" });
  let broadcastCount = 0;
  let confirmationCount = 0;
  const queries = [];

  pool.query = async (sql, params = []) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (String(sql).includes("FROM signed_transaction_outbox")) {
      return { rows: [outbox] };
    }
    return { rows: [] };
  };
  BlockchainClient.prototype.broadcastSignedTransaction = async () => {
    broadcastCount += 1;
  };
  BlockchainClient.prototype.getConfirmations = async () => {
    confirmationCount += 1;
    return { receipt: null, confirmations: 0 };
  };

  await __test.processJob(gasJob());

  assert.equal(broadcastCount, 0);
  assert.equal(confirmationCount, 0);
  assert.ok(
    queries.some(({ sql, params }) =>
      sql.includes("needs_manual_review") && params.includes("CHAIN_EPOCH_MISMATCH")
    ),
    "epoch mismatch should enter manual review"
  );
});

test("processJob blocks safely when the persisted raw transaction cannot be decrypted", async (t) => {
  restore(t);
  const outbox = encryptedOutbox({ encryptionKeyId: "missing-key" });
  const queries = [];
  let broadcastCount = 0;

  pool.query = async (sql, params = []) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (String(sql).includes("FROM signed_transaction_outbox")) {
      return { rows: [outbox] };
    }
    return { rows: [] };
  };
  BlockchainClient.prototype.broadcastSignedTransaction = async () => {
    broadcastCount += 1;
  };

  await __test.processJob(gasJob());

  assert.equal(broadcastCount, 0);
  assert.ok(
    queries.some(({ sql, params }) =>
      sql.includes("blocked") && params.includes("OUTBOX_KEY_UNAVAILABLE")
    ),
    "missing encryption key should block the job with a public-safe code"
  );
});

test("acquireJob only locks unlocked or expired jobs that are not already ready", async (t) => {
  restore(t);
  let acquireSql = "";
  pool.query = async (sql) => {
    acquireSql = String(sql);
    return { rows: [] };
  };

  await __test.acquireJob();

  assert.match(acquireSql, /funding_ready = FALSE/);
  assert.match(acquireSql, /locked_until IS NULL OR locked_until < NOW\(\)/);
  assert.match(acquireSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(acquireSql, /UPDATE wallet_funding_jobs/);
  assert.match(acquireSql, /RETURNING job\.\*/);
});

test("signed transaction outbox enforces one row per funding job phase", () => {
  const migration = fs.readFileSync(
    new URL("../../db/migrations/2026-06-25-wallet-funding-readiness.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /signed_transaction_outbox_one_phase_per_job/);
  assert.match(migration, /ON signed_transaction_outbox \(funding_job_id, phase\)/);
});

test("persistOutbox recovers the existing phase row when a concurrent insert wins", async (t) => {
  restore(t);
  const outbox = encryptedOutbox();
  const inserts = [];

  pool.query = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (query.includes("INSERT INTO signed_transaction_outbox")) {
      inserts.push(params);
      return { rows: inserts.length === 1 ? [{ outbox_id: outbox.outboxId }] : [] };
    }
    if (query.includes("FROM signed_transaction_outbox")) {
      return { rows: [outbox] };
    }
    return { rows: [] };
  };

  const signed = {
    rawTransaction: outbox.rawTransaction,
    txHash: outbox.txHash,
    signerAddress: outbox.signerAddress,
    nonce: outbox.nonce,
    chainId: outbox.chainId,
    gasLimit: "21000",
    maxFeePerGas: "1",
    maxPriorityFeePerGas: "1",
  };

  const first = await __test.persistOutbox({ job: gasJob(), phase: "gas", signed });
  const second = await __test.persistOutbox({ job: gasJob(), phase: "gas", signed });

  assert.equal(inserts.length, 2);
  assert.equal(first.txHash, outbox.txHash);
  assert.equal(second.txHash, outbox.txHash);
  assert.equal(inserts[0][0], 77);
  assert.equal(inserts[0][1], "gas");
});

test("processJob does not broadcast when lease is lost after preparing an outbox", async (t) => {
  restore(t);
  const originalGetTransactionCount = __test.blockchainClient.provider.getTransactionCount;
  t.after(() => {
    __test.blockchainClient.provider.getTransactionCount = originalGetTransactionCount;
  });

  const outbox = encryptedOutbox();
  let leaseChecks = 0;
  let insertCount = 0;
  let broadcastCount = 0;
  let buildCount = 0;

  pool.query = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes("FROM wallet_funding_jobs")) {
      leaseChecks += 1;
      return { rows: leaseChecks < 4 ? [{ funding_job_id: 77 }] : [] };
    }
    if (query.includes("MAX(nonce) + 1")) {
      return { rows: [{ nextPersistedNonce: 7 }] };
    }
    if (query.includes("INSERT INTO faucet_nonce_reservations")) {
      return { rows: [] };
    }
    if (query.includes("INSERT INTO signed_transaction_outbox")) {
      insertCount += 1;
      return { rows: [{ outbox_id: outbox.outboxId }] };
    }
    if (query.includes("FROM signed_transaction_outbox")) {
      return { rows: insertCount > 0 ? [outbox] : [] };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    query: async (sql) => {
      const query = String(sql);
      if (query.includes("SELECT next_nonce")) {
        return { rows: [{ nextNonce: 7 }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  BlockchainClient.prototype.getFaucetSignerWallet = () => ({
    getAddress: async () => outbox.signerAddress,
  });
  BlockchainClient.prototype.getChainId = async () => 31337;
  BlockchainClient.prototype.getChainEpochId = () => "epoch-1";
  BlockchainClient.prototype.buildSignedGasFundingTransaction = async () => {
    buildCount += 1;
    return {
      rawTransaction: outbox.rawTransaction,
      txHash: outbox.txHash,
      signerAddress: outbox.signerAddress,
      nonce: outbox.nonce,
      chainId: outbox.chainId,
      gasLimit: "21000",
      maxFeePerGas: "1",
      maxPriorityFeePerGas: "1",
    };
  };
  BlockchainClient.prototype.broadcastSignedTransaction = async () => {
    broadcastCount += 1;
  };
  __test.blockchainClient.provider.getTransactionCount = async () => 7;

  await __test.processJob(gasJob({ gas_status: "not_started", gas_tx_hash: null }));

  assert.equal(buildCount, 1);
  assert.equal(insertCount, 1);
  assert.equal(broadcastCount, 0);
});

test("processJob sends an unexpected signer nonce gap to manual review", async (t) => {
  restore(t);
  const originalGetTransactionCount = __test.blockchainClient.provider.getTransactionCount;
  t.after(() => {
    __test.blockchainClient.provider.getTransactionCount = originalGetTransactionCount;
  });
  const queries = [];
  const signerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  pool.query = async (sql, params = []) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM wallet_funding_jobs")) {
      return { rows: [{ funding_job_id: 77 }] };
    }
    if (String(sql).includes("MAX(nonce) + 1")) {
      return { rows: [{ nextPersistedNonce: 8 }] };
    }
    if (String(sql).includes("FROM signed_transaction_outbox")) {
      return { rows: [] };
    }
    return { rows: [] };
  };
  BlockchainClient.prototype.getFaucetSignerWallet = () => ({
    getAddress: async () => signerAddress,
  });
  BlockchainClient.prototype.getChainId = async () => 31337;
  BlockchainClient.prototype.getChainEpochId = () => "epoch-1";
  __test.blockchainClient.provider.getTransactionCount = async () => 10;

  await __test.processJob(gasJob({ gas_status: "not_started", gas_tx_hash: null }));

  assert.ok(
    queries.some(({ sql, params }) =>
      sql.includes("needs_manual_review") && params.includes("NONCE_GAP_DETECTED")
    ),
    "nonce gaps should enter manual review instead of silently advancing"
  );
});
