import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  fetchTransactions,
  fetchWalletStatus,
  getErrorMessage,
  transferTokens,
} from "../lib/api";
import { getWalletPrivateKey, hasMatchingLocalPrivateKey } from "../lib/walletKey";
import { canUseSendTokens, getSendTokensUnavailableReason } from "../lib/sendTokenReadiness";
import tokenArtifact from "../abi/MyToken.json";

const RPC_URL = import.meta.env.VITE_RPC_URL ?? "http://localhost:8545";
const SUBMITTED_POLL_INTERVAL_MS = 3000;

function validateRecipient(value) {
  if (!value) {
    return "Enter a recipient wallet address.";
  }

  if (!ethers.isAddress(value)) {
    return "Enter a valid wallet address.";
  }

  return "";
}

function validateAmount(value) {
  if (!value) {
    return "Enter an amount.";
  }

  if (!/^\d+(\.\d+)?$/.test(value)) {
    return "Use numbers only, for example 1 or 0.25.";
  }

  try {
    if (ethers.parseUnits(value, 18) <= 0n) {
      return "Amount must be greater than 0.";
    }
  } catch {
    return "Amount must be greater than 0.";
  }

  return "";
}

async function broadcastTokenTransfer({ privateKey, toAddress, amount }) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signingWallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(tokenArtifact.address, tokenArtifact.abi, signingWallet);
  const value = ethers.parseUnits(String(amount), 18);
  const tx = await contract.transfer(toAddress, value);
  return tx.hash;
}

async function estimateTransferNativeCost({ privateKey, toAddress, amount }) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signingWallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(tokenArtifact.address, tokenArtifact.abi, signingWallet);
  const value = ethers.parseUnits(String(amount), 18);
  const gasLimit = await contract.transfer.estimateGas(toAddress, value);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;

  if (!gasPrice) {
    throw new Error("Network fee data is unavailable. Try again in a moment.");
  }

  return (gasLimit * gasPrice * 120n) / 100n;
}

function shortHash(value) {
  if (!value || value.length < 12) {
    return value || "";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function SendTokens({ onBack, onShowHistory }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [transferState, setTransferState] = useState("idle");
  const [submittedTx, setSubmittedTx] = useState(null);
  const [error, setError] = useState("");

  async function loadWallet({ silent = false } = {}) {
    if (!silent) {
      setWalletLoading(true);
    }

    try {
      const currentWallet = await fetchWalletStatus();
      setWallet(currentWallet);
    } catch (requestError) {
      if (!silent) {
        setWallet(null);
        setTransferState("error");
        setError(getErrorMessage(requestError, "Unable to load wallet."));
      }
    } finally {
      if (!silent) {
        setWalletLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadWallet();
  }, []);

  // While a submitted transfer is still PENDING, poll its status so the panel
  // moves to CONFIRMED/FAILED instead of looking stuck. Stops on a terminal
  // status, when the panel leaves the pending state, or on unmount.
  useEffect(() => {
    if (transferState !== "pending") {
      return undefined;
    }

    const txId = submittedTx?.txId;
    if (!txId || submittedTx?.status !== "PENDING") {
      return undefined;
    }

    const intervalId = setInterval(async () => {
      try {
        const list = await fetchTransactions();
        const row = Array.isArray(list)
          ? list.find((transaction) => transaction.txId === txId)
          : null;

        if (row && row.status && row.status !== "PENDING") {
          setSubmittedTx((previous) =>
            previous && previous.txId === txId
              ? { ...previous, status: row.status, confirmedAt: row.confirmedAt ?? previous.confirmedAt }
              : previous
          );
        }
      } catch {
        // Ignore transient poll errors; the History view still reflects status.
      }
    }, SUBMITTED_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [transferState, submittedTx?.txId, submittedTx?.status]);

  function clearFeedbackOnEdit() {
    if (error) {
      setError("");
    }

    if (transferState === "pending") {
      setTransferState("idle");
      setSubmittedTx(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedRecipient = recipient.trim();
    const trimmedAmount = amount.trim();
    const recipientError = validateRecipient(trimmedRecipient);
    const amountError = validateAmount(trimmedAmount);

    if (recipientError) {
      setError(recipientError);
      return;
    }

    if (amountError) {
      setError(amountError);
      return;
    }

    if (!wallet?.wallet?.walletAddress) {
      setTransferState("error");
      setError("Wallet address is not available yet. Reload the wallet and try again.");
      return;
    }

    if (!wallet.fundingReady || !wallet.blockchainAvailable) {
      setTransferState("error");
      setError("Wallet funding is not ready or live balances are unavailable.");
      return;
    }

    setRecipient(trimmedRecipient);
    setAmount(trimmedAmount);
    setSubmittedTx(null);
    setTransferState("signing");
    setError("");

    try {
      const fromAddress = ethers.getAddress(wallet.wallet.walletAddress);
      const toAddress = ethers.getAddress(trimmedRecipient);
      const privateKey = getWalletPrivateKey(fromAddress);

      if (!privateKey) {
        throw new Error(
          "Your wallet was created in a different browser session and the signing key is not available here.\nFor security reasons, transfers can only be signed from the browser where the wallet was originally created.\nPlease import your private key to enable transfers from this browser."
        );
      }

      const signingWallet = new ethers.Wallet(privateKey);
      const signingAddress = ethers.getAddress(signingWallet.address);

      if (signingAddress !== fromAddress) {
        throw new Error(
          "The local private key does not match this wallet address. Transfers cannot be signed from here."
        );
      }

      const tokenBalanceRaw = BigInt(wallet.currentTokenBalance?.raw || "0");
      const requestedAmountRaw = ethers.parseUnits(trimmedAmount, 18);

      if (tokenBalanceRaw < requestedAmountRaw) {
        throw new Error("Insufficient token balance for this transfer.");
      }

      const estimatedNativeCost = await estimateTransferNativeCost({
        privateKey,
        toAddress,
        amount: trimmedAmount,
      });
      const nativeBalanceRaw = BigInt(wallet.currentNativeBalance?.raw || "0");

      if (nativeBalanceRaw < estimatedNativeCost) {
        throw new Error("Insufficient native gas balance for the estimated network cost.");
      }

      const txHash = await broadcastTokenTransfer({
        privateKey,
        toAddress,
        amount: trimmedAmount,
      });

      setTransferState("submitting");

      const tx = await transferTokens({
        txHash,
        fromAddress,
        toAddress,
        amount: trimmedAmount,
      });

      setSubmittedTx(tx);
      setTransferState("pending");
      void loadWallet({ silent: true });
    } catch (requestError) {
      setTransferState("error");
      setError(
        getErrorMessage(
          requestError,
          "Transfer could not be submitted."
        )
      );
    }
  }

  const isBusy = transferState === "signing" || transferState === "submitting";
  const walletAddress = wallet?.wallet?.walletAddress || "";
  const hasLocalPrivateKey = Boolean(walletAddress && hasMatchingLocalPrivateKey(walletAddress));
  const sendReadiness = {
    walletLoading,
    isBusy,
    walletAddress,
    fundingReady: Boolean(wallet?.fundingReady),
    blockchainAvailable: Boolean(wallet?.blockchainAvailable),
    hasLocalPrivateKey,
  };
  const isFormDisabled = !canUseSendTokens(sendReadiness);
  const unavailableReason = getSendTokensUnavailableReason(sendReadiness);
  const submitLabel =
    transferState === "signing"
      ? "Signing..."
      : transferState === "submitting"
        ? "Submitting..."
        : "Submit Transfer";

  return (
    <div className="card screen">
      <div>
        <h2>Send Tokens</h2>
        <p className="helperText">
          Transfers are signed locally in this browser, then submitted to the backend for verification and transaction tracking.
        </p>
      </div>

      {walletLoading ? (
        <div className="notice info">
          <strong>Loading wallet...</strong>
          <p>Fetching the current wallet address before signing.</p>
        </div>
      ) : null}

      {!walletLoading && walletAddress ? (
        <div className="detailPanel">
          <div className="detailLabel">From wallet</div>
          <div className="mono breakText">{walletAddress}</div>
        </div>
      ) : null}

      {!walletLoading && walletAddress && !hasLocalPrivateKey ? (
        <div className="notice warning">
          <strong>Private key missing on this device</strong>
          <p>{unavailableReason}</p>
        </div>
      ) : null}

      <form className="formStack" onSubmit={handleSubmit}>
        <label className="fieldLabel">
          Recipient address
          <input
            className="input mono"
            type="text"
            placeholder="0x..."
            value={recipient}
            onChange={(event) => {
              clearFeedbackOnEdit();
              setRecipient(event.target.value);
            }}
            disabled={isFormDisabled}
            required
          />
        </label>

        <label className="fieldLabel">
          Amount
          <input
            className="input"
            type="text"
            placeholder="1"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              clearFeedbackOnEdit();
              setAmount(event.target.value);
            }}
            disabled={isFormDisabled}
            required
          />
        </label>

        <div className="actionsRow">
          <button type="submit" className="btn" disabled={isFormDisabled || !walletAddress}>
            {submitLabel}
          </button>

          <button type="button" className="btn" onClick={onBack} disabled={isBusy}>
            Back
          </button>
        </div>
      </form>

      {transferState === "pending" && submittedTx ? (
        <div className={`notice ${submittedTx.status === "FAILED" ? "error" : "info"}`}>
          <strong>
            {submittedTx.status === "CONFIRMED"
              ? "Transfer confirmed"
              : submittedTx.status === "FAILED"
                ? "Transfer failed"
                : "Transfer submitted"}
          </strong>
          <p>
            Transaction {submittedTx.txId} is {submittedTx.status}.
            {submittedTx.status === "PENDING"
              ? " Waiting for on-chain confirmation…"
              : ""}
          </p>
          {submittedTx.txHash ? (
            <p className="mono">txHash: {shortHash(submittedTx.txHash)}</p>
          ) : null}
          {onShowHistory ? (
            <button type="button" className="btn" onClick={onShowHistory}>
              View History
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="notice error">
          <strong>Transfer not submitted</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
