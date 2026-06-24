import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  ApiError,
  apiFetch,
  getErrorMessage,
} from "../lib/api";
import { clearToken } from "../lib/token";
import { getWalletPrivateKey, storeWalletPrivateKey } from "../lib/walletKey";

const LIVE_BALANCE_NOTICE =
  "Balance is now loaded from the blockchain-backed wallet endpoint. If the Hardhat node, ABI sync, or contract runtime is unavailable, this request can still fail.";

const MISSING_KEY_MESSAGE =
  "Your wallet exists, but this browser does not have the local signing key. For security reasons, transfers can only be signed from the browser where the wallet key is stored.";

async function fetchBalance() {
  return apiFetch("/wallet/balance");
}

export default function Wallet({ onLogout, onShowSendTokens, onShowHistory, onShowAdmin }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading wallet...");
  const [error, setError] = useState("");
  const [hasLocalPrivateKey, setHasLocalPrivateKey] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState("");
  const [importPrivateKey, setImportPrivateKey] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [keyError, setKeyError] = useState("");

  const loadWallet = useCallback(async () => {
    setLoading(true);
    setLoadingMessage("Loading wallet...");
    setError("");
    setKeyMessage("");
    setKeyError("");
    setExportedPrivateKey("");

    try {
      try {
        const existing = await fetchBalance();
        setWallet(existing);
        setHasLocalPrivateKey(Boolean(getWalletPrivateKey(existing.walletAddress)));
        return;
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 404) {
          throw requestError;
        }
      }

      setLoadingMessage("Creating wallet...");
      const generatedWallet = ethers.Wallet.createRandom();
      const publicKey = generatedWallet.signingKey.publicKey;
      const walletAddress = ethers.computeAddress(publicKey);
      let createdNewWallet = false;

      try {
        await apiFetch("/wallet/create", {
          method: "POST",
          body: JSON.stringify({ walletAddress, publicKey }),
        });
        createdNewWallet = true;
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 409) {
          throw requestError;
        }
      }

      if (createdNewWallet) {
        storeWalletPrivateKey(walletAddress, generatedWallet.privateKey);
      }

      setLoadingMessage("Loading wallet...");
      const created = await fetchBalance();
      setWallet(created);
      setHasLocalPrivateKey(Boolean(getWalletPrivateKey(created.walletAddress)));
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.status === 401 || requestError.status === 403)
      ) {
        clearToken();
        onLogout?.();
        return;
      }

      setWallet(null);
      setHasLocalPrivateKey(false);
      setError(getErrorMessage(requestError, "Failed to load wallet."));
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const walletAddress = wallet?.walletAddress || "";
  const balance = wallet?.balance ?? "";
  const balanceSource = wallet?.source || "";
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
          Wallet setup is connected, and the balance shown here comes from the authenticated blockchain read path.
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

      {!loading && wallet ? (
        <>
          <div className="detailPanel">
            <div className="detailLabel">Wallet address</div>
            <div className="mono breakText">{walletAddress || "-"}</div>
          </div>

          <div className="detailPanel">
            <div className="detailLabel">Balance</div>
            <div>
              <span className="big">{balance || "0"}</span>
            </div>
          </div>

          {balanceSource ? (
            <div className="detailPanel">
              <div className="detailLabel">Source</div>
              <div>{balanceSource}</div>
            </div>
          ) : null}

          <div className="notice info">
            <strong>Balance sourced from blockchain</strong>
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

      {!loading && !wallet && !error ? (
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
          disabled={loading || !wallet}
        >
          History
        </button>

        <button
          type="button"
          className="btn"
          onClick={onShowAdmin}
          disabled={loading || !wallet}
        >
          Admin
        </button>

        <button
          type="button"
          className="btn"
          onClick={onShowSendTokens}
          disabled={loading || !wallet || !hasLocalPrivateKey}
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
