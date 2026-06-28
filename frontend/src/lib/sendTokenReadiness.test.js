import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseSendTokens,
  getSendTokensUnavailableReason,
} from "./sendTokenReadiness.js";

const READY = {
  walletLoading: false,
  isBusy: false,
  walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  fundingReady: true,
  blockchainAvailable: true,
  hasLocalPrivateKey: true,
};

test("allows Send Tokens only after a matching local key exists", () => {
  assert.equal(canUseSendTokens(READY), true);
  assert.equal(
    canUseSendTokens({
      ...READY,
      hasLocalPrivateKey: false,
    }),
    false
  );
});

test("keeps Send Tokens disabled when backend wallet exists but local key is missing", () => {
  const state = {
    ...READY,
    hasLocalPrivateKey: false,
  };

  assert.equal(canUseSendTokens(state), false);
  assert.match(getSendTokensUnavailableReason(state), /matching private key/i);
});

test("keeps Send Tokens disabled until funding readiness and live blockchain data are available", () => {
  assert.equal(canUseSendTokens({ ...READY, fundingReady: false }), false);
  assert.equal(canUseSendTokens({ ...READY, blockchainAvailable: false }), false);
  assert.equal(canUseSendTokens({ ...READY, walletLoading: true }), false);
  assert.equal(canUseSendTokens({ ...READY, isBusy: true }), false);
});
