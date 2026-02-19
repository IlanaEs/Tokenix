import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiFetch } from "../lib/api";
import { clearToken } from "../lib/token";

function errorStatus(error) {
  const message = error?.message || "";

  const httpMatch = message.match(/^HTTP\s+(\d{3})\b/i);
  if (httpMatch) {
    return Number(httpMatch[1]);
  }

  const legacyMatch = message.match(/\((\d{3})\)/);
  if (legacyMatch) {
    return Number(legacyMatch[1]);
  }

  return null;
}

async function fetchBalance() {
  return apiFetch("/wallet/balance");
}

export default function Wallet({ onLogout }) {
  const [walletAddress, setWalletAddress] = useState("");
  const [balance, setBalance] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const privateKeyRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function initWallet() {
      setLoading(true);
      setMessage("");

      try {
        try {
          const existing = await fetchBalance();
          if (active) {
            setWalletAddress(existing.walletAddress || "");
            setBalance(existing.balance ?? "");
          }
          return;
        } catch (error) {
          const status = errorStatus(error);
          if (status !== 404) {
            throw error;
          }
        }

        const wallet = ethers.Wallet.createRandom();
        const publicKey = wallet.signingKey.publicKey;
        const walletAddress = ethers.computeAddress(publicKey);
        privateKeyRef.current = wallet.privateKey;

        try {
          await apiFetch("/wallet/create", {
            method: "POST",
            body: JSON.stringify({ walletAddress, publicKey }),
          });
        } catch (error) {
          const status = errorStatus(error);

          if (status !== 409) {
            throw error;
          }
        }

        const created = await fetchBalance();
        if (active) {
          setWalletAddress(created.walletAddress || "");
          setBalance(created.balance ?? "");
        }
      } catch (error) {
        const status = errorStatus(error);

        if ((status === 401 || status === 403) && active) {
          clearToken();
          onLogout?.();
          return;
        }

        if (active) {
          setMessage(error?.message || "Failed to load wallet");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    initWallet();

    return () => {
      active = false;
    };
  }, [onLogout]);

  return (
    <div style={{ padding: 40 }}>
      <h2>Wallet</h2>
      {loading ? (
        <p>Loading wallet...</p>
      ) : (
        <>
          {message && <p>{message}</p>}
          <p>
            <strong>Wallet address:</strong> {walletAddress || "-"}
          </p>
          <p>
            <strong>Balance:</strong> {balance || "0"}
          </p>
        </>
      )}

      <button
        onClick={() => {
          clearToken();
          onLogout?.();
        }}
        style={{ marginTop: 20 }}
      >
        Logout
      </button>
    </div>
  );
}
