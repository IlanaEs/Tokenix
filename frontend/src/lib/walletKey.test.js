import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import {
  createTokenixPrivateKeyBackup,
  getWalletPrivateKey,
  getWalletPrivateKeyStorageKey,
  hasMatchingLocalPrivateKey,
  importWalletPrivateKey,
  storeWalletPrivateKey,
  WalletKeyError,
} from "./walletKey.js";

const FIRST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f094538f9d90e4b79e8ea4c6809be532377f3b8e";
const SECOND_PRIVATE_KEY = "0x8b3a350cf5c34c9194ca3a9d8b811c39cc719c35c8b6958f56fa9c4a52a3c7b8";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function addressFor(privateKey) {
  return ethers.getAddress(new ethers.Wallet(privateKey).address);
}

test("stores wallet private keys per normalized wallet address", () => {
  const storage = new MemoryStorage();
  const walletAddress = addressFor(FIRST_PRIVATE_KEY);

  storeWalletPrivateKey(walletAddress.toLowerCase(), FIRST_PRIVATE_KEY, storage);

  assert.equal(getWalletPrivateKey(walletAddress, storage), FIRST_PRIVATE_KEY);
  assert.equal(getWalletPrivateKeyStorageKey(walletAddress), getWalletPrivateKeyStorageKey(walletAddress.toLowerCase()));
});

test("imports a raw private key only when it matches the backend wallet address", () => {
  const storage = new MemoryStorage();
  const walletAddress = addressFor(FIRST_PRIVATE_KEY);

  const result = importWalletPrivateKey({
    walletAddress,
    input: `  ${FIRST_PRIVATE_KEY}  `,
    storage,
  });

  assert.equal(result.source, "raw_private_key");
  assert.equal(result.walletAddress, walletAddress);
  assert.equal(getWalletPrivateKey(walletAddress, storage), FIRST_PRIVATE_KEY);
  assert.equal(hasMatchingLocalPrivateKey(walletAddress, storage), true);
});

test("imports Tokenix backup JSON after validating the derived wallet address", () => {
  const storage = new MemoryStorage();
  const walletAddress = addressFor(FIRST_PRIVATE_KEY);
  const backup = createTokenixPrivateKeyBackup({
    walletAddress,
    privateKey: FIRST_PRIVATE_KEY,
    exportedAt: "2026-06-28T00:00:00.000Z",
  });

  const result = importWalletPrivateKey({
    walletAddress,
    input: JSON.stringify(backup),
    storage,
  });

  assert.equal(result.source, "tokenix_backup_json");
  assert.equal(getWalletPrivateKey(walletAddress, storage), FIRST_PRIVATE_KEY);
});

test("rejects mismatched private keys without storing anything", () => {
  const storage = new MemoryStorage();
  const walletAddress = addressFor(FIRST_PRIVATE_KEY);

  assert.throws(
    () =>
      importWalletPrivateKey({
        walletAddress,
        input: SECOND_PRIVATE_KEY,
        storage,
      }),
    (error) => error instanceof WalletKeyError && error.code === "PRIVATE_KEY_MISMATCH"
  );

  assert.equal(getWalletPrivateKey(walletAddress, storage), null);
});

test("private key import stays local and never calls fetch", () => {
  const storage = new MemoryStorage();
  const walletAddress = addressFor(FIRST_PRIVATE_KEY);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  try {
    importWalletPrivateKey({
      walletAddress,
      input: FIRST_PRIVATE_KEY,
      storage,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
});

test("multiple wallet keys do not overwrite each other", () => {
  const storage = new MemoryStorage();
  const firstAddress = addressFor(FIRST_PRIVATE_KEY);
  const secondAddress = addressFor(SECOND_PRIVATE_KEY);

  storeWalletPrivateKey(firstAddress, FIRST_PRIVATE_KEY, storage);
  storeWalletPrivateKey(secondAddress, SECOND_PRIVATE_KEY, storage);

  assert.equal(getWalletPrivateKey(firstAddress, storage), FIRST_PRIVATE_KEY);
  assert.equal(getWalletPrivateKey(secondAddress, storage), SECOND_PRIVATE_KEY);
});
