import test from "node:test";
import assert from "node:assert/strict";
import BlockchainClient from "./BlockchainClient.js";

// These tests cover the dev faucet concurrency fix: admin-signer funding
// operations must run one at a time so concurrent wallet creations no longer
// contend on the shared admin account's (account 0) nonce. They stub the
// network-touching body (_fundAccountUnlocked) so no live chain is required.

test("fundAccount serializes concurrent faucet operations (no overlap)", async () => {
  const client = new BlockchainClient();

  let active = 0;
  let maxConcurrent = 0;
  const order = [];

  client._fundAccountUnlocked = async (toAddress) => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    order.push(`start:${toAddress}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push(`end:${toAddress}`);
    active -= 1;
    return `hash:${toAddress}`;
  };

  const results = await Promise.all([
    client.fundAccount("0xA"),
    client.fundAccount("0xB"),
    client.fundAccount("0xC"),
  ]);

  assert.equal(maxConcurrent, 1, "faucet operations must never overlap");
  assert.deepEqual(order, [
    "start:0xA",
    "end:0xA",
    "start:0xB",
    "end:0xB",
    "start:0xC",
    "end:0xC",
  ]);
  assert.deepEqual(results, ["hash:0xA", "hash:0xB", "hash:0xC"]);
});

test("a failed faucet run does not block subsequent ones", async () => {
  const client = new BlockchainClient();

  const completed = [];
  let calls = 0;

  client._fundAccountUnlocked = async (toAddress) => {
    calls += 1;
    if (calls === 1) {
      throw new Error("boom");
    }
    completed.push(toAddress);
    return `hash:${toAddress}`;
  };

  const first = client.fundAccount("0xA");
  const second = client.fundAccount("0xB");

  await assert.rejects(first, /boom/);
  assert.equal(await second, "hash:0xB");
  assert.deepEqual(completed, ["0xB"]);
});
