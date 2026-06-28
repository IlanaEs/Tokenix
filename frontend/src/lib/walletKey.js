import { ethers } from "ethers";

const WALLET_PRIVATE_KEY_PREFIX = "tokenix_wallet_private_key";

export const TOKENIX_BACKUP_TYPE = "tokenix.privateKeyBackup";
export const TOKENIX_BACKUP_VERSION = 1;

export class WalletKeyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletKeyError";
    this.code = code;
  }
}

function requireStorage(storage = globalThis.localStorage) {
  if (!storage) {
    throw new WalletKeyError("STORAGE_UNAVAILABLE", "Local browser storage is unavailable.");
  }

  return storage;
}

export function normalizeWalletAddress(walletAddress) {
  if (!walletAddress) {
    throw new WalletKeyError("WALLET_ADDRESS_MISSING", "Wallet address is not available yet.");
  }

  try {
    return ethers.getAddress(walletAddress);
  } catch {
    throw new WalletKeyError("INVALID_WALLET_ADDRESS", "Wallet address is not valid.");
  }
}

export function getWalletPrivateKeyStorageKey(walletAddress) {
  return `${WALLET_PRIVATE_KEY_PREFIX}:${normalizeWalletAddress(walletAddress).toLowerCase()}`;
}

export function storeWalletPrivateKey(walletAddress, privateKey, storage = globalThis.localStorage) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  requireStorage(storage).setItem(getWalletPrivateKeyStorageKey(normalizedAddress), normalizedPrivateKey);
}

export function getWalletPrivateKey(walletAddress, storage = globalThis.localStorage) {
  if (!walletAddress) {
    return null;
  }

  return requireStorage(storage).getItem(getWalletPrivateKeyStorageKey(walletAddress));
}

export function normalizePrivateKey(privateKey) {
  const trimmed = String(privateKey || "").trim();

  try {
    return new ethers.Wallet(trimmed).privateKey;
  } catch {
    throw new WalletKeyError("INVALID_PRIVATE_KEY", "Enter a valid Ethereum private key.");
  }
}

export function deriveWalletAddressFromPrivateKey(privateKey) {
  return ethers.getAddress(new ethers.Wallet(normalizePrivateKey(privateKey)).address);
}

export function createTokenixPrivateKeyBackup({ walletAddress, privateKey, exportedAt = new Date().toISOString() }) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const normalizedPrivateKey = normalizePrivateKey(privateKey);

  return {
    type: TOKENIX_BACKUP_TYPE,
    version: TOKENIX_BACKUP_VERSION,
    walletAddress: normalizedAddress,
    privateKey: normalizedPrivateKey,
    exportedAt,
  };
}

export function parsePrivateKeyImport(input) {
  const trimmed = String(input || "").trim();

  if (!trimmed) {
    throw new WalletKeyError("IMPORT_EMPTY", "Paste a private key or Tokenix backup JSON.");
  }

  if (!trimmed.startsWith("{")) {
    return {
      source: "raw_private_key",
      privateKey: normalizePrivateKey(trimmed),
      backupWalletAddress: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new WalletKeyError("INVALID_BACKUP_JSON", "Backup JSON is not valid.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WalletKeyError("INVALID_BACKUP_JSON", "Backup JSON must be an object.");
  }

  if (
    parsed.type &&
    (parsed.type !== TOKENIX_BACKUP_TYPE || Number(parsed.version) !== TOKENIX_BACKUP_VERSION)
  ) {
    throw new WalletKeyError("UNSUPPORTED_BACKUP", "This Tokenix backup format is not supported.");
  }

  const privateKey = normalizePrivateKey(parsed.privateKey);
  const backupWalletAddress = parsed.walletAddress
    ? normalizeWalletAddress(parsed.walletAddress)
    : null;

  return {
    source: "tokenix_backup_json",
    privateKey,
    backupWalletAddress,
  };
}

export function importWalletPrivateKey({ walletAddress, input, storage = globalThis.localStorage }) {
  const currentAddress = normalizeWalletAddress(walletAddress);
  const parsed = parsePrivateKeyImport(input);
  const derivedAddress = deriveWalletAddressFromPrivateKey(parsed.privateKey);

  if (parsed.backupWalletAddress && parsed.backupWalletAddress !== derivedAddress) {
    throw new WalletKeyError(
      "BACKUP_ADDRESS_MISMATCH",
      "This backup file does not match the private key it contains."
    );
  }

  if (derivedAddress !== currentAddress) {
    throw new WalletKeyError(
      "PRIVATE_KEY_MISMATCH",
      "This private key belongs to a different wallet address. The key was not saved."
    );
  }

  storeWalletPrivateKey(currentAddress, parsed.privateKey, storage);

  return {
    walletAddress: currentAddress,
    privateKey: parsed.privateKey,
    source: parsed.source,
  };
}

export function hasMatchingLocalPrivateKey(walletAddress, storage = globalThis.localStorage) {
  const privateKey = getWalletPrivateKey(walletAddress, storage);

  if (!privateKey) {
    return false;
  }

  try {
    return deriveWalletAddressFromPrivateKey(privateKey) === normalizeWalletAddress(walletAddress);
  } catch {
    return false;
  }
}
