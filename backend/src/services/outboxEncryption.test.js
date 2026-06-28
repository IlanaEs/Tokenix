import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRawTransaction,
  encryptRawTransaction,
  getPublicEncryptionErrorCode,
} from "./outboxEncryption.js";

const ORIGINAL_KEYS = process.env.TX_OUTBOX_ENCRYPTION_KEYS;
const ORIGINAL_ACTIVE_KEY = process.env.TX_OUTBOX_ACTIVE_KEY_ID;

function withEnv(testContext, env) {
  process.env.TX_OUTBOX_ENCRYPTION_KEYS = env.keys;
  process.env.TX_OUTBOX_ACTIVE_KEY_ID = env.activeKeyId;

  testContext.after(() => {
    if (ORIGINAL_KEYS === undefined) {
      delete process.env.TX_OUTBOX_ENCRYPTION_KEYS;
    } else {
      process.env.TX_OUTBOX_ENCRYPTION_KEYS = ORIGINAL_KEYS;
    }

    if (ORIGINAL_ACTIVE_KEY === undefined) {
      delete process.env.TX_OUTBOX_ACTIVE_KEY_ID;
    } else {
      process.env.TX_OUTBOX_ACTIVE_KEY_ID = ORIGINAL_ACTIVE_KEY;
    }
  });
}

test("encryptRawTransaction encrypts and decrypts with the configured key", (t) => {
  withEnv(t, {
    activeKeyId: "test-key",
    keys: JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    }),
  });

  const raw = "0xabc123";
  const encrypted = encryptRawTransaction(raw);

  assert.notEqual(encrypted.ciphertext.toString("utf8"), raw);
  assert.equal(encrypted.keyId, "test-key");
  assert.equal(
    decryptRawTransaction({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      keyId: encrypted.keyId,
    }),
    raw
  );
});

test("encryptRawTransaction rejects invalid key lengths with a safe code", (t) => {
  withEnv(t, {
    activeKeyId: "bad-key",
    keys: JSON.stringify({
      "bad-key": Buffer.alloc(8, 1).toString("base64"),
    }),
  });

  assert.throws(
    () => encryptRawTransaction("0xabc123"),
    (error) => getPublicEncryptionErrorCode(error) === "OUTBOX_KEY_INVALID"
  );
});
