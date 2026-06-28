import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  ApiError,
  createWallet as createWalletRecord,
  fetchWalletStatus,
  getErrorMessage,
  retryWalletFunding,
} from "../lib/api";
import { clearToken } from "../lib/token";
import { getWalletPrivateKey, storeWalletPrivateKey } from "../lib/walletKey";

const LIVE_BALANCE_NOTICE =
  "Readiness comes from the wallet status endpoint. Token and native balances are live blockchain observations and may be temporarily unavailable.";

const MISSING_KEY_MESSAGE =
  "Your wallet exists, but this browser does not have the local signing key. For security reasons, transfers can only be signed from the browser where the wallet key is stored.";

export default function Wallet({ onLogout, onShowSendTokens, onShowHistory, onShowAdmin }) {
  const [walletStatus, setWalletStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading wallet...");
  const [error, setError] = useState("");
  const [hasLocalPrivateKey, setHasLocalPrivateKey] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState("");
  const [importPrivateKey, setImportPrivateKey] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [keyError, setKeyError] = useState("");
  // Run the auto-bootstrap exactly once (StrictMode double-invokes effects in
  // dev, which would otherwise fire two /wallet/create calls → a spurious 409).
  const didInitRef = useRef(false);
  const requestSeqRef = useRef(0);
  const pollTimerRef = useRef(null);
  const abortControllerRef = useRef(null);

  function clearPollTimer() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function replaceAbortController() {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }

  function shouldPollStatus(status) {
    return ["funding_pending", "blocked", "temporarily_unavailable"].includes(status?.lifecycleState);
  }

  function getPollDelayMs(status, pollCount) {
    if (!shouldPollStatus(status)) return null;
    if (pollCount < 10) return 1000;
    if (pollCount < 30) return 3000;
    return 10000;
  }

  function applyStatus(status) {
    setWalletStatus(status);
    const walletAddress = status?.wallet?.walletAddress || "";
    setHasLocalPrivateKey(Boolean(walletAddress && getWalletPrivateKey(walletAddress)));
  }

  const loadWallet = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    clearPollTimer();
    const controller = replaceAbortController();

    setLoading(true);
    setLoadingMessage("Loading wallet...");
    setError("");
    setKeyMessage("");
    setKeyError("");
    setExportedPrivateKey("");

    try {
      let status = await fetchWalletStatus({ signal: controller.signal });
      if (requestSeq !== requestSeqRef.current) return;

      if (status.lifecycleState === "wallet_missing") {
        setLoadingMessage("Creating wallet...");
        const generatedWallet = ethers.Wallet.createRandom();
        const publicKey = generatedWallet.signingKey.publicKey;
        const walletAddress = ethers.computeAddress(publicKey);

        status = await createWalletRecord({ walletAddress, publicKey });
        if (requestSeq !== requestSeqRef.current) return;
        if (
          status.wallet?.walletAddress &&
          ethers.getAddress(status.wallet.walletAddress) === ethers.getAddress(walletAddress)
        ) {
          storeWalletPrivateKey(walletAddress, generatedWallet.privateKey);
        }
      }

      applyStatus(status);

      let pollCount = 0;
      const schedulePoll = (latestStatus) => {
        const delay = getPollDelayMs(latestStatus, pollCount);
        if (delay == null) return;

        pollTimerRef.current = setTimeout(async () => {
          pollCount += 1;
          try {
            const pollController = replaceAbortController();
            const refreshed = await fetchWalletStatus({ signal: pollController.signal });
            if (requestSeq !== requestSeqRef.current) return;
            applyStatus(refreshed);
            schedulePoll(refreshed);
          } catch {
            if (requestSeq !== requestSeqRef.current) return;
            schedulePoll(latestStatus);
          }
        }, delay);
      };

      schedulePoll(status);
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.status === 401 || requestError.status === 403)
      ) {
        clearToken();
        onLogout?.();
        return;
      }

      setWalletStatus(null);
      setHasLocalPrivateKey(false);
      setError(getErrorMessage(requestError, "Failed to load wallet."));
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [onLogout]);

  async function handleRetryFunding() {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    clearPollTimer();
    const controller = replaceAbortController();
    setLoading(true);
    setLoadingMessage("Retrying funding...");
    setError("");

    try {
      const status = await retryWalletFunding();
      if (requestSeq !== requestSeqRef.current) return;
      applyStatus(status);
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.status === 401 || requestError.status === 403)
      ) {
        clearToken();
        onLogout?.();
        return;
      }

      setError(getErrorMessage(requestError, "Funding retry could not be started."));
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
        void loadWallet();
      }
    }
  }

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void loadWallet();
  }, [loadWallet]);

  // Stop any in-flight funding poll when the component unmounts.
  useEffect(
    () => () => {
      requestSeqRef.current += 1;
      abortControllerRef.current?.abort();
      clearPollTimer();
    },
    []
  );

  const walletAddress = walletStatus?.wallet?.walletAddress || "";
  const tokenBalance = walletStatus?.currentTokenBalance;
  const nativeBalance = walletStatus?.currentNativeBalance;
  const lifecycleState = walletStatus?.lifecycleState || "";
  const fundingReady = Boolean(walletStatus?.fundingReady);
  const blockchainAvailable = Boolean(walletStatus?.blockchainAvailable);
  const showFinalBalance = fundingReady && blockchainAvailable && tokenBalance;
  const isMissingLocalKey = Boolean(walletAddress) && !hasLocalPrivateKey;

  function handleRevealPrivateKey() {
    setKeyMessage("");
    setKeyError("");

    const privateKey = getWalletPrivateKey(walletAddress);
    if (!privateKey) {
      setExportedPrivateKey("");
      setHasLocalPrivateKey(false);
      setKeyError("No private key is stored in this browser for this wallet. Import the matching private key to enable transfers.");
      return;
    }

    setExportedPrivateKey(privateKey);
    setHasLocalPrivateKey(true);
  }

  function handleHidePrivateKey() {
    setExportedPrivateKey("");
  }

  function handleDownloadPrivateKey() {
    const privateKey = exportedPrivateKey || getWalletPrivateKey(walletAddress);
    if (!privateKey) {
      setKeyError("No private key is available to export from this browser.");
      return;
    }

    const backup = {
      walletAddress,
      privateKey,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tokenix-wallet-${walletAddress.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleImportPrivateKey(event) {
    event.preventDefault();
    setKeyMessage("");
    setKeyError("");

    if (!walletAddress) {
      setKeyError("Wallet address is not available yet. Reload the wallet before importing a private key.");
      return;
    }

    const trimmedPrivateKey = importPrivateKey.trim();
    if (!trimmedPrivateKey) {
      setKeyError("Paste the private key for this wallet.");
      return;
    }

    try {
      const importedWallet = new ethers.Wallet(trimmedPrivateKey);
      const importedAddress = ethers.getAddress(importedWallet.address);
      const currentAddress = ethers.getAddress(walletAddress);

      if (importedAddress !== currentAddress) {
        setKeyError("This private key belongs to a different wallet address. The key was not saved.");
        return;
      }

      storeWalletPrivateKey(currentAddress, importedWallet.privateKey);
      setHasLocalPrivateKey(true);
      setExportedPrivateKey("");
      setImportPrivateKey("");
      setKeyMessage("Private key imported for this wallet. Transfers are enabled in this browser.");
    } catch {
      setKeyError("Enter a valid Ethereum private key.");
    }
  }

  return (
    <div className="card screen">
      <div>
        <h2>Wallet</h2>
        <p className="helperText">
          Wallet setup is connected, and readiness is tracked separately from live blockchain balances.
        </p>
      </div>

      {loading ? (
        <div className="notice info">
          <strong>{loadingMessage}</strong>
          <p>Checking your saved wallet address and current blockchain-backed balance response.</p>
        </div>
      ) : null}

      {error ? (
        <div className="notice error">
          <strong>Unable to load wallet</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && walletStatus?.wallet ? (
        <>
          <div className="detailPanel">
            <div className="detailLabel">Wallet address</div>
            <div className="mono breakText">{walletAddress || "-"}</div>
          </div>

          <div className="detailPanel">
            <div className="detailLabel">Token balance</div>
            <div>
              <span className="big">
                {showFinalBalance ? tokenBalance.display || tokenBalance.raw : "Pending"}
              </span>
            </div>
          </div>

          {nativeBalance ? (
            <div className="detailPanel">
              <div className="detailLabel">Native gas balance</div>
              <div>{nativeBalance.display || nativeBalance.raw}</div>
            </div>
          ) : null}

          {lifecycleState === "funding_pending" || lifecycleState === "blocked" ? (
            <div className="notice info">
              <strong>Funding in progress</strong>
              <p>Your wallet is being initialized. Transfers stay disabled until gas funding and token funding are finalized.</p>
            </div>
          ) : null}

          {lifecycleState === "ready" && blockchainAvailable ? (
            <div className="notice info">
              <strong>Funding complete</strong>
              <p>Your wallet is initialized and live balances are available.</p>
            </div>
          ) : null}

          {lifecycleState === "ready" && !blockchainAvailable ? (
            <div className="notice warning">
              <strong>Live balances unavailable</strong>
              <p>Your wallet remains initialized, but live balances are temporarily unavailable.</p>
            </div>
          ) : null}

          {lifecycleState === "funding_failed" ? (
            <div className="notice error">
              <strong>Funding failed</strong>
              <p>The initial funding transaction did not complete.</p>
              <button type="button" className="btn" onClick={() => void handleRetryFunding()} disabled={loading}>
                Retry Funding
              </button>
            </div>
          ) : null}

          {lifecycleState === "legacy_unverified" ? (
            <div className="notice warning">
              <strong>Funding status needs verification</strong>
              <p>This wallet predates the funding readiness records, so transfers stay disabled until funding is verified.</p>
            </div>
          ) : null}

          {lifecycleState === "needs_manual_review" ? (
            <div className="notice warning">
              <strong>Funding needs review</strong>
              <p>The funding worker found an ambiguous chain state and stopped before taking unsafe action.</p>
            </div>
          ) : null}

          <div className="notice info">
            <strong>Balances sourced from blockchain</strong>
            <p>{LIVE_BALANCE_NOTICE}</p>
          </div>

          {isMissingLocalKey ? (
            <div className="notice warning">
              <strong>Private key needed for transfers</strong>
              <p>{MISSING_KEY_MESSAGE}</p>
              <p>Please import your private key to enable transfers from this browser.</p>
            </div>
          ) : null}

          <section className="detailPanel">
            <div className="detailLabel">Export Private Key</div>
            <p className="helperText">
              Anyone with this private key can control this wallet. Store it somewhere secure and never share it.
            </p>

            <div className="actionsRow walletKeyActions">
              <button
                type="button"
                className="btn"
                onClick={handleRevealPrivateKey}
                disabled={!walletAddress}
              >
                Export Private Key
              </button>
              {exportedPrivateKey ? (
                <>
                  <button type="button" className="btn" onClick={handleHidePrivateKey}>
                    Hide Private Key
                  </button>
                  <button type="button" className="btn" onClick={handleDownloadPrivateKey}>
                    Download Backup
                  </button>
                </>
              ) : null}
            </div>

            {exportedPrivateKey ? (
              <div className="privateKeyBox mono breakText">{exportedPrivateKey}</div>
            ) : null}
          </section>

          <section className="detailPanel">
            <div className="detailLabel">Import Existing Wallet</div>
            <p className="helperText">
              Paste the private key for this wallet. It will be saved only in this browser after the derived address matches your wallet address.
            </p>

            <form className="formStack walletKeyForm" onSubmit={handleImportPrivateKey}>
              <label className="fieldLabel">
                Private key
                <textarea
                  className="input mono privateKeyInput"
                  value={importPrivateKey}
                  onChange={(event) => {
                    setImportPrivateKey(event.target.value);
                    setKeyMessage("");
                    setKeyError("");
                  }}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck="false"
                  rows={3}
                />
              </label>
              <button type="submit" className="btn" disabled={!walletAddress}>
                Import Existing Wallet
              </button>
            </form>
          </section>

          {keyMessage ? (
            <div className="notice info">
              <strong>Wallet key updated</strong>
              <p>{keyMessage}</p>
            </div>
          ) : null}

          {keyError ? (
            <div className="notice error">
              <strong>Wallet key not updated</strong>
              <p>{keyError}</p>
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !walletStatus?.wallet && !error ? (
        <div className="emptyState">
          Wallet information is not available yet. Try reloading to bootstrap the wallet again.
        </div>
      ) : null}

      <div className="actionsRow">
        <button
          type="button"
          className="btn"
          onClick={() => void loadWallet()}
          disabled={loading}
        >
          {loading ? "Loading..." : "Reload Wallet"}
        </button>

        <button
          type="button"
          className="btn"
          onClick={onShowHistory}
          disabled={loading || !walletStatus?.wallet}
        >
          History
        </button>

        <button
          type="button"
          className="btn"
          onClick={onShowAdmin}
          disabled={loading || !walletStatus?.wallet}
        >
          Admin
        </button>

        <button
          type="button"
          className="btn"
          onClick={onShowSendTokens}
          disabled={loading || !walletStatus?.wallet || !fundingReady || !blockchainAvailable || !hasLocalPrivateKey}
        >
          Send Tokens
        </button>

        <button
          type="button"
          className="btn"
          onClick={() => {
            clearToken();
            onLogout?.();
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
