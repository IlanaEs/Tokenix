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
import {
  createTokenixPrivateKeyBackup,
  getWalletPrivateKey,
  hasMatchingLocalPrivateKey,
  importWalletPrivateKey,
  storeWalletPrivateKey,
  WalletKeyError,
} from "../lib/walletKey";

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
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const [keyError, setKeyError] = useState("");
  // Run the auto-bootstrap once per mount. Guards against StrictMode firing two
  // concurrent /wallet/create calls on a single mount; it is reset on unmount so
  // the dev remount re-runs the bootstrap after the first load is aborted.
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
    setHasLocalPrivateKey(Boolean(walletAddress && hasMatchingLocalPrivateKey(walletAddress)));
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
          setShowBackupPrompt(true);
          setKeyMessage("Wallet created. Back up your private key now; Tokenix cannot recover it later.");
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
      // A superseded or aborted request (e.g. React StrictMode's dev
      // mount/remount, or a newer reload) must not clobber the UI with a
      // fatal error. Genuine failures keep the same requestSeq and fall through.
      if (requestSeq !== requestSeqRef.current) return;

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

  // On unmount, invalidate any in-flight request and stop polling. Resetting
  // didInitRef lets React StrictMode's dev remount re-run the bootstrap, so the
  // aborted first load is retried instead of leaving the wallet stuck on a
  // spurious "Unable to reach the API server" error. The first load is aborted
  // mid status-fetch (before /wallet/create), so this does not double-create.
  useEffect(
    () => () => {
      requestSeqRef.current += 1;
      abortControllerRef.current?.abort();
      clearPollTimer();
      didInitRef.current = false;
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
    setHasLocalPrivateKey(hasMatchingLocalPrivateKey(walletAddress));
  }

  function handleHidePrivateKey() {
    setExportedPrivateKey("");
  }

  async function handleCopyPrivateKey() {
    const privateKey = exportedPrivateKey || getWalletPrivateKey(walletAddress);
    if (!privateKey) {
      setKeyError("No private key is available to copy from this browser.");
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setKeyError("Clipboard access is unavailable. Use the revealed key or download a backup instead.");
      return;
    }

    try {
      await navigator.clipboard.writeText(privateKey);
      setKeyError("");
      setKeyMessage("Private key copied. Clear your clipboard after saving it securely.");
    } catch {
      setKeyError("Could not copy the private key. Use the revealed key or download a backup instead.");
    }
  }

  function handleDownloadPrivateKey() {
    const privateKey = exportedPrivateKey || getWalletPrivateKey(walletAddress);
    if (!privateKey) {
      setKeyError("No private key is available to export from this browser.");
      return;
    }

    const backup = createTokenixPrivateKeyBackup({
      walletAddress,
      privateKey,
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tokenix-wallet-${walletAddress.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setKeyError("");
    setKeyMessage("Tokenix backup JSON downloaded. Store it somewhere secure.");
  }

  function handleImportPrivateKey(event) {
    event.preventDefault();
    setKeyMessage("");
    setKeyError("");

    if (!walletAddress) {
      setKeyError("Wallet address is not available yet. Reload the wallet before importing a private key.");
      return;
    }

    try {
      const result = importWalletPrivateKey({
        walletAddress,
        input: importPrivateKey,
      });
      setHasLocalPrivateKey(true);
      setExportedPrivateKey("");
      setImportPrivateKey("");
      setShowBackupPrompt(false);
      setKeyMessage(
        result.source === "tokenix_backup_json"
          ? "Tokenix backup imported for this wallet. Transfers are enabled in this browser."
          : "Private key imported for this wallet. Transfers are enabled in this browser."
      );
    } catch (importError) {
      setKeyError(
        importError instanceof WalletKeyError
          ? importError.message
          : "Enter a valid private key or Tokenix backup JSON."
      );
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
              <p>Paste the matching raw private key or Tokenix backup JSON below to restore signing on this device.</p>
            </div>
          ) : null}

          {showBackupPrompt && hasLocalPrivateKey ? (
            <div className="notice warning">
              <strong>Back up your private key</strong>
              <p>
                This browser is the only place Tokenix can access your new signing key. The backend stores only your public wallet address and cannot recover the private key if this browser data is lost.
              </p>
              <div className="actionsRow walletKeyActions">
                <button type="button" className="btn" onClick={handleRevealPrivateKey}>
                  Reveal Private Key
                </button>
                <button type="button" className="btn" onClick={handleDownloadPrivateKey}>
                  Download Backup
                </button>
                <button type="button" className="btn" onClick={() => setShowBackupPrompt(false)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          <section className="detailPanel">
            <div className="detailLabel">Backup Private Key</div>
            <p className="helperText">
              Use this only in a private place. Anyone with this key or backup file can control this wallet, and Tokenix cannot recover it for you.
            </p>

            <div className="actionsRow walletKeyActions">
              <button
                type="button"
                className="btn"
                onClick={handleRevealPrivateKey}
                disabled={!walletAddress}
              >
                Reveal Private Key
              </button>
              {exportedPrivateKey ? (
                <>
                  <button type="button" className="btn" onClick={handleHidePrivateKey}>
                    Hide Private Key
                  </button>
                  <button type="button" className="btn" onClick={() => void handleCopyPrivateKey()}>
                    Copy Private Key
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
              Paste a raw private key or Tokenix backup JSON. The address is derived locally and must match your backend wallet before anything is saved.
            </p>

            <form className="formStack walletKeyForm" onSubmit={handleImportPrivateKey}>
              <label className="fieldLabel">
                Private key or Tokenix backup JSON
                <textarea
                  className="input mono privateKeyInput"
                  value={importPrivateKey}
                  onChange={(event) => {
                    setImportPrivateKey(event.target.value);
                    setKeyMessage("");
                    setKeyError("");
                  }}
                  placeholder={'0x... or { "type": "tokenix.privateKeyBackup", ... }'}
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
