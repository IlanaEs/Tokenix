import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  ApiError,
  apiFetch,
  getErrorMessage,
} from "../lib/api";
import { clearToken } from "../lib/token";

const LIVE_BALANCE_NOTICE =
  "Balance is now loaded from the blockchain-backed wallet endpoint. If the Hardhat node, ABI sync, or contract runtime is unavailable, this request can still fail.";

async function fetchBalance() {
  return apiFetch("/wallet/balance");
}

export default function Wallet({ onLogout, onShowSendTokens, onShowHistory }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading wallet...");
  const [error, setError] = useState("");

  const loadWallet = useCallback(async () => {
    setLoading(true);
    setLoadingMessage("Loading wallet...");
    setError("");

    try {
      try {
        const existing = await fetchBalance();
        setWallet(existing);
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

      try {
        await apiFetch("/wallet/create", {
          method: "POST",
          body: JSON.stringify({ walletAddress, publicKey }),
        });
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 409) {
          throw requestError;
        }
      }

      setLoadingMessage("Loading wallet...");
      const created = await fetchBalance();
      setWallet(created);
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
          onClick={onShowSendTokens}
          disabled={loading || !wallet}
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
