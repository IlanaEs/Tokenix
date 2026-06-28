export function canUseSendTokens({
  walletLoading = false,
  isBusy = false,
  walletAddress = "",
  fundingReady = false,
  blockchainAvailable = false,
  hasLocalPrivateKey = false,
}) {
  return Boolean(
    !walletLoading &&
      !isBusy &&
      walletAddress &&
      fundingReady &&
      blockchainAvailable &&
      hasLocalPrivateKey
  );
}

export function getSendTokensUnavailableReason({
  walletLoading = false,
  isBusy = false,
  walletAddress = "",
  fundingReady = false,
  blockchainAvailable = false,
  hasLocalPrivateKey = false,
}) {
  if (walletLoading) return "Loading wallet...";
  if (isBusy) return "Transfer request is already in progress.";
  if (!walletAddress) return "Wallet address is not available yet.";
  if (!fundingReady) return "Wallet funding is not ready yet.";
  if (!blockchainAvailable) return "Live blockchain balances are temporarily unavailable.";
  if (!hasLocalPrivateKey) {
    return "This browser does not have the matching private key. Import it from the Wallet screen to enable transfers.";
  }

  return "";
}
