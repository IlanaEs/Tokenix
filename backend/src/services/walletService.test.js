import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { pool } from "../db.js";
import BlockchainClient from "./BlockchainClient.js";

const originalInitialize = BlockchainClient.prototype._initialize;
const originalGetChainId = BlockchainClient.prototype.getChainId;
const originalGetConfirmationTarget = BlockchainClient.prototype.getConfirmationTarget;
const originalGetTokenBalanceRaw = BlockchainClient.prototype.getTokenBalanceRaw;
const originalGetNativeBalanceRaw = BlockchainClient.prototype.getNativeBalanceRaw;
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);

const tokenAddress = "0x1000000000000000000000000000000000000001";
const faucetAddress = "0x2000000000000000000000000000000000000002";
const persistedWalletAddress = "0x3000000000000000000000000000000000000003";
const submittedDifferentAddress = "0x4000000000000000000000000000000000000004";

function expectedRequestId(walletAddress) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "address", "address"],
    [
      "TOKENIX_INITIAL_FAUCET",
      31337n,
      ethers.getAddress(faucetAddress),
      ethers.getAddress(tokenAddress),
      ethers.getAddress(walletAddress),
    ]
  );
  return ethers.keccak256(encoded);
}

async function withMockedWalletService(testContext) {
  BlockchainClient.prototype._initialize = function initializeForTest() {
    this.contractAddress = tokenAddress;
    this.faucetAddress = faucetAddress;
    this.contract = {};
    this.faucetContract = {};
  };
  BlockchainClient.prototype.getChainId = async () => 31337;
  BlockchainClient.prototype.getConfirmationTarget = () => 1;
  BlockchainClient.prototype.getTokenBalanceRaw = async () => ({
    raw: "0",
    decimals: 18,
    display: "0.0",
  });
  BlockchainClient.prototype.getNativeBalanceRaw = async () => ({
    raw: "0",
    decimals: 18,
    display: "0.0",
  });

  testContext.after(() => {
    BlockchainClient.prototype._initialize = originalInitialize;
    BlockchainClient.prototype.getChainId = originalGetChainId;
    BlockchainClient.prototype.getConfirmationTarget = originalGetConfirmationTarget;
    BlockchainClient.prototype.getTokenBalanceRaw = originalGetTokenBalanceRaw;
    BlockchainClient.prototype.getNativeBalanceRaw = originalGetNativeBalanceRaw;
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  return import("./walletService.js");
}

function installCreateWalletDbMock({ submittedInsertSucceeds }) {
  const clientQueries = [];
  const fundingJobParams = [];
  let walletInsertCount = 0;
  let fundingInsertCount = 0;

  const client = {
    query: async (sql, params = []) => {
      const query = String(sql);
      clientQueries.push({ sql: query, params });

      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [] };
      }

      if (query.includes("INSERT INTO wallets")) {
        walletInsertCount += 1;
        return {
          rows: submittedInsertSucceeds
            ? [
              {
                userId: params[0],
                walletAddress: params[1],
                publicKey: params[2],
              },
            ]
            : [],
        };
      }

      if (query.includes("FROM wallets")) {
        return {
          rows: [
            {
              userId: params[0],
              walletAddress: persistedWalletAddress,
              publicKey: "0xpersisted-public-key",
            },
          ],
        };
      }

      if (query.includes("INSERT INTO wallet_funding_jobs")) {
        fundingInsertCount += 1;
        fundingJobParams.push(params);
        return { rows: [] };
      }

      throw new Error(`Unexpected client query: ${query}`);
    },
    release() {},
  };

  pool.connect = async () => client;
  pool.query = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes("FROM wallets w")) {
      return {
        rows: [
          {
            userId: params[0],
            walletAddress: persistedWalletAddress,
            publicKey: "0xpersisted-public-key",
            fundingJobId: 9,
            lifecycleState: "funding_pending",
            fundingReady: false,
            confirmationTarget: 1,
            tokenRequestId: expectedRequestId(persistedWalletAddress),
            chainId: 31337,
            chainEpochId: "local-dev-default",
            gasStatus: "not_started",
            gasTxHash: null,
            gasConfirmations: 0,
            gasConfirmedAt: null,
            gasErrorCode: null,
            tokenStatus: "not_started",
            tokenTxHash: null,
            tokenConfirmations: 0,
            tokenConfirmedAt: null,
            tokenTransferEventValidated: false,
            tokenErrorCode: null,
          },
        ],
      };
    }
    throw new Error(`Unexpected pool query: ${query}`);
  };

  return {
    clientQueries,
    fundingJobParams,
    get walletInsertCount() {
      return walletInsertCount;
    },
    get fundingInsertCount() {
      return fundingInsertCount;
    },
  };
}

test("createWallet creates a new wallet and funding job from the submitted address", async (t) => {
  const { createWallet } = await withMockedWalletService(t);
  const db = installCreateWalletDbMock({ submittedInsertSucceeds: true });

  const result = await createWallet({
    userId: 101,
    walletAddress: persistedWalletAddress,
    publicKey: "0xnew-public-key",
  });

  assert.equal(result.created, true);
  assert.equal(db.walletInsertCount, 1);
  assert.equal(db.fundingInsertCount, 1);
  assert.equal(db.fundingJobParams[0][1], persistedWalletAddress);
  assert.equal(db.fundingJobParams[0][4], expectedRequestId(persistedWalletAddress));
});

test("createWallet uses the persisted wallet address when an existing wallet submits a different address", async (t) => {
  const { createWallet } = await withMockedWalletService(t);
  const db = installCreateWalletDbMock({ submittedInsertSucceeds: false });

  const result = await createWallet({
    userId: 102,
    walletAddress: submittedDifferentAddress,
    publicKey: "0xdifferent-public-key",
  });

  assert.equal(result.created, false);
  assert.equal(result.status.wallet.walletAddress, persistedWalletAddress);
  assert.equal(db.walletInsertCount, 1);
  assert.equal(db.fundingInsertCount, 1);
  assert.equal(db.fundingJobParams[0][1], persistedWalletAddress);
  assert.equal(db.fundingJobParams[0][4], expectedRequestId(persistedWalletAddress));
  assert.notEqual(db.fundingJobParams[0][4], expectedRequestId(submittedDifferentAddress));
  assert.ok(
    db.clientQueries.some(({ sql }) => sql.includes("ON CONFLICT (user_id) DO NOTHING")),
    "wallet insert remains idempotent"
  );
  assert.ok(
    db.clientQueries.some(({ sql }) => sql.includes("INSERT INTO wallet_funding_jobs")),
    "missing funding job is created through the idempotent funding insert"
  );
});

test("createWallet remains idempotent when an existing wallet submits the same address", async (t) => {
  const { createWallet } = await withMockedWalletService(t);
  const db = installCreateWalletDbMock({ submittedInsertSucceeds: false });

  const result = await createWallet({
    userId: 103,
    walletAddress: persistedWalletAddress,
    publicKey: "0xpersisted-public-key",
  });

  assert.equal(result.created, false);
  assert.equal(result.status.wallet.walletAddress, persistedWalletAddress);
  assert.equal(db.walletInsertCount, 1);
  assert.equal(db.fundingInsertCount, 1);
  assert.equal(db.fundingJobParams[0][1], persistedWalletAddress);
  assert.equal(db.fundingJobParams[0][4], expectedRequestId(persistedWalletAddress));
});
