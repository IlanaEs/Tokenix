const WALLET_PRIVATE_KEY_PREFIX = "tokenix_wallet_private_key";

function getWalletPrivateKeyStorageKey(walletAddress: string): string {
  return `${WALLET_PRIVATE_KEY_PREFIX}:${walletAddress.toLowerCase()}`;
}

export function storeWalletPrivateKey(walletAddress: string, privateKey: string): void {
  localStorage.setItem(getWalletPrivateKeyStorageKey(walletAddress), privateKey);
}

export function getWalletPrivateKey(walletAddress: string): string | null {
  if (!walletAddress) {
    return null;
  }

  return localStorage.getItem(getWalletPrivateKeyStorageKey(walletAddress));
}
