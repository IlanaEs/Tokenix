import assert from "node:assert/strict";
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
const originalBroadcastSignedTransaction = BlockchainClient.prototype.broadcastSignedTransaction;
const originalBuildSignedGasFundingTransaction = BlockchainClient.prototype.buildSignedGasFundingTransaction;
const originalBuildSignedTokenFundingTransaction = BlockchainClient.prototype.buildSignedTokenFundingTransaction;
const originalGetConfirmations = BlockchainClient.prototype.getConfirmations;

function restore(t) {
  t.after(() => {
    pool.query = originalQuery;
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
  assert.match(acquireSql, /UPDATE wallet_funding_jobs/);
  assert.match(acquireSql, /RETURNING \*/);
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
