import assert from "node:assert/strict";
import test from "node:test";
import BlockchainClient from "./BlockchainClient.js";
import { getWalletStatus } from "./walletFundingService.js";
import { pool } from "../db.js";

const originalQuery = pool.query.bind(pool);
const originalGetTokenBalanceRaw = BlockchainClient.prototype.getTokenBalanceRaw;
const originalGetNativeBalanceRaw = BlockchainClient.prototype.getNativeBalanceRaw;

function restore(testContext) {
  testContext.after(() => {
    pool.query = originalQuery;
    BlockchainClient.prototype.getTokenBalanceRaw = originalGetTokenBalanceRaw;
    BlockchainClient.prototype.getNativeBalanceRaw = originalGetNativeBalanceRaw;
  });
}

test("getWalletStatus is read-only and preserves fundingReady during balance outages", async (t) => {
  restore(t);
  const queries = [];

  pool.query = async (sql, params = []) => {
    queries.push(String(sql));
    assert.deepEqual(params, [42]);
    return {
      rows: [
        {
          userId: 42,
          walletAddress: "0x1111111111111111111111111111111111111111",
          publicKey: "0xpub",
          fundingJobId: 7,
          lifecycleState: "ready",
          fundingReady: true,
          confirmationTarget: 1,
          tokenRequestId: "0xabc",
          chainId: 31337,
          chainEpochId: "epoch-1",
          gasStatus: "confirmed",
          gasTxHash: "0xgas",
          gasConfirmations: 1,
          gasConfirmedAt: "2026-06-25T10:00:00.000Z",
          gasErrorCode: null,
          tokenStatus: "confirmed",
          tokenTxHash: "0xtoken",
          tokenConfirmations: 1,
          tokenConfirmedAt: "2026-06-25T10:00:01.000Z",
          tokenTransferEventValidated: true,
          tokenErrorCode: null,
        },
      ],
    };
  };

  BlockchainClient.prototype.getTokenBalanceRaw = async () => {
    const error = new Error("provider unavailable");
    error.code = "BLOCKCHAIN_UNAVAILABLE";
    throw error;
  };
  BlockchainClient.prototype.getNativeBalanceRaw = async () => {
    const error = new Error("provider unavailable");
    error.code = "BLOCKCHAIN_UNAVAILABLE";
    throw error;
  };

  const status = await getWalletStatus(42);

  assert.equal(status.lifecycleState, "ready");
  assert.equal(status.fundingReady, true);
  assert.equal(status.blockchainAvailable, false);
  assert.equal(status.currentTokenBalance, null);
  assert.equal(status.currentNativeBalance, null);
  assert.equal(status.errors[0].code, "BLOCKCHAIN_UNAVAILABLE");
  assert.ok(
    queries.every((query) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(query)),
    "status lookup must not mutate database rows"
  );
});

test("getWalletStatus hides stale phase error codes after confirmed funding", async (t) => {
  restore(t);

  pool.query = async (sql, params = []) => {
    assert.deepEqual(params, [43]);
    return {
      rows: [
        {
          userId: 43,
          walletAddress: "0x2222222222222222222222222222222222222222",
          publicKey: "0xpub",
          fundingJobId: 8,
          lifecycleState: "ready",
          fundingReady: true,
          confirmationTarget: 1,
          tokenRequestId: "0xdef",
          chainId: 31337,
          chainEpochId: "epoch-1",
          gasStatus: "confirmed",
          gasTxHash: "0xgas",
          gasConfirmations: 1,
          gasConfirmedAt: "2026-06-25T10:00:00.000Z",
          gasErrorCode: "BLOCKCHAIN_UNAVAILABLE",
          tokenStatus: "confirmed",
          tokenTxHash: "0xtoken",
          tokenConfirmations: 1,
          tokenConfirmedAt: "2026-06-25T10:00:01.000Z",
          tokenTransferEventValidated: true,
          tokenErrorCode: "BLOCKCHAIN_UNAVAILABLE",
        },
      ],
    };
  };

  BlockchainClient.prototype.getTokenBalanceRaw = async () => ({
    raw: "100000000000000000000",
    decimals: 18,
    display: "100.0",
  });
  BlockchainClient.prototype.getNativeBalanceRaw = async () => ({
    raw: "5000000000000000",
    decimals: 18,
    display: "0.005",
  });

  const status = await getWalletStatus(43);

  assert.equal(status.lifecycleState, "ready");
  assert.equal(status.fundingReady, true);
  assert.equal(status.funding.gas.errorCode, null);
  assert.equal(status.funding.token.errorCode, null);
});
