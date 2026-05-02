import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import {
  buildSignedTransferMessage,
  normalizeSignedTransferInput,
  verifySignature,
} from "./transactionService.js";

function makePayload(overrides = {}) {
  const fromWallet = overrides.fromWallet || ethers.Wallet.createRandom();
  const toWallet = overrides.toWallet || ethers.Wallet.createRandom();
  const message = {
    fromAddress: fromWallet.address,
    toAddress: toWallet.address,
    amount: "10",
    timestamp: new Date("2026-04-26T12:00:00.000Z").toISOString(),
    ...overrides.message,
  };

  return {
    fromWallet,
    toWallet,
    payload: {
      toAddress: message.toAddress,
      amount: message.amount,
      message,
      signature: overrides.signature || "0x",
      ...overrides.payload,
    },
  };
}

async function signedPayload(overrides = {}) {
  const data = makePayload(overrides);
  const signature = await data.fromWallet.signMessage(buildSignedTransferMessage(data.payload.message));
  return {
    ...data,
    payload: {
      ...data.payload,
      signature,
    },
  };
}

test("verifySignature accepts a valid signed transfer message", async () => {
  const { fromWallet, payload } = await signedPayload();

  const recovered = verifySignature({
    message: payload.message,
    signature: payload.signature,
    userWalletAddress: fromWallet.address,
  });

  assert.equal(recovered, ethers.getAddress(fromWallet.address));
});

test("verifySignature rejects an invalid signature", () => {
  const { fromWallet, payload } = makePayload({ signature: "0x1234" });

  assert.throws(
    () =>
      verifySignature({
        message: payload.message,
        signature: payload.signature,
        userWalletAddress: fromWallet.address,
      }),
    /Invalid signature/
  );
});

test("verifySignature rejects a signer mismatch", async () => {
  const signer = ethers.Wallet.createRandom();
  const owner = ethers.Wallet.createRandom();
  const { payload } = makePayload({ fromWallet: owner });
  const signature = await signer.signMessage(buildSignedTransferMessage(payload.message));

  assert.throws(
    () =>
      verifySignature({
        message: payload.message,
        signature,
        userWalletAddress: owner.address,
      }),
    /Invalid signature/
  );
});

test("verifySignature rejects a fromAddress not owned by the user", async () => {
  const actualSigner = ethers.Wallet.createRandom();
  const claimedOwner = ethers.Wallet.createRandom();
  const { payload } = await signedPayload({
    fromWallet: actualSigner,
    message: { fromAddress: claimedOwner.address },
  });

  assert.throws(
    () =>
      verifySignature({
        message: payload.message,
        signature: payload.signature,
        userWalletAddress: actualSigner.address,
      }),
    /Transfer source wallet does not belong to authenticated user/
  );
});

test("verifySignature rejects when the authenticated user has no wallet", async () => {
  const { payload } = await signedPayload();

  assert.throws(
    () =>
      verifySignature({
        message: payload.message,
        signature: payload.signature,
        userWalletAddress: null,
      }),
    /Wallet not found/
  );
});

test("normalizeSignedTransferInput rejects an invalid timestamp", () => {
  const { payload } = makePayload({
    message: { timestamp: "2026-04-26T11:00:00.000Z" },
  });

  assert.throws(
    () =>
      normalizeSignedTransferInput({
        ...payload,
        now: new Date("2026-04-26T12:00:00.000Z"),
      }),
    /Transfer timestamp expired/
  );
});

test("normalizeSignedTransferInput rejects an invalid amount", () => {
  const { payload } = makePayload({
    payload: { amount: "0" },
    message: { amount: "0" },
  });

  assert.throws(
    () =>
      normalizeSignedTransferInput({
        ...payload,
        now: new Date("2026-04-26T12:00:00.000Z"),
      }),
    /Amount must be greater than 0/
  );
});

test("normalizeSignedTransferInput rejects an invalid toAddress", () => {
  const { payload } = makePayload({
    payload: { toAddress: "not-an-address" },
    message: { toAddress: "not-an-address" },
  });

  assert.throws(
    () =>
      normalizeSignedTransferInput({
        ...payload,
        now: new Date("2026-04-26T12:00:00.000Z"),
      }),
    /Invalid toAddress/
  );
});
