import crypto from "crypto";

const KEYRING_ENV = "TX_OUTBOX_ENCRYPTION_KEYS";
const ACTIVE_KEY_ENV = "TX_OUTBOX_ACTIVE_KEY_ID";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function parseKeyring() {
  const raw = process.env[KEYRING_ENV];
  const activeKeyId = process.env[ACTIVE_KEY_ENV];

  if (!raw || !activeKeyId) {
    const error = new Error("Outbox encryption keyring is not configured");
    error.code = "OUTBOX_KEY_UNAVAILABLE";
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error("Outbox encryption keyring is invalid");
    error.code = "OUTBOX_KEY_INVALID";
    throw error;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Outbox encryption keyring is invalid");
    error.code = "OUTBOX_KEY_INVALID";
    throw error;
  }

  const keys = new Map();
  for (const [keyId, encoded] of Object.entries(parsed)) {
    const key = Buffer.from(String(encoded), "base64");
    if (key.length !== KEY_LENGTH) {
      const error = new Error("Outbox encryption key has invalid length");
      error.code = "OUTBOX_KEY_INVALID";
      throw error;
    }
    keys.set(keyId, key);
  }

  if (!keys.has(activeKeyId)) {
    const error = new Error("Active outbox encryption key is unavailable");
    error.code = "OUTBOX_KEY_UNAVAILABLE";
    throw error;
  }

  return { keys, activeKeyId };
}

export function getPublicEncryptionErrorCode(error) {
  return error?.code === "OUTBOX_KEY_INVALID"
    ? "OUTBOX_KEY_INVALID"
    : "OUTBOX_KEY_UNAVAILABLE";
}

export function encryptRawTransaction(rawTransaction) {
  const { keys, activeKeyId } = parseKeyring();
  const key = keys.get(activeKeyId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(rawTransaction), "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
    keyId: activeKeyId,
  };
}

export function decryptRawTransaction({ ciphertext, iv, tag, keyId }) {
  const { keys } = parseKeyring();
  const key = keys.get(keyId);

  if (!key) {
    const error = new Error("Outbox encryption key is unavailable");
    error.code = "OUTBOX_KEY_UNAVAILABLE";
    throw error;
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
