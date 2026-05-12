import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { apiFetch, getErrorMessage, transferTokens } from "../lib/api";
import { getWalletPrivateKey } from "../lib/walletKey";

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

  const parsedAmount = Number(value);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return "Amount must be greater than 0.";
  }

  return "";
}

async function fetchBalance() {
  return apiFetch("/wallet/balance");
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
      const currentWallet = await fetchBalance();
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

    if (!wallet?.walletAddress) {
      setTransferState("error");
      setError("Wallet address is not available yet. Reload the wallet and try again.");
      return;
    }

    setRecipient(trimmedRecipient);
    setAmount(trimmedAmount);
    setSubmittedTx(null);
    setTransferState("signing");
    setError("");

    try {
      const fromAddress = ethers.getAddress(wallet.walletAddress);
      const toAddress = ethers.getAddress(trimmedRecipient);
      const privateKey = getWalletPrivateKey(fromAddress);

      if (!privateKey) {
        throw new Error(
          "This browser does not have the local private key for this wallet. Transfers cannot be signed from here."
        );
      }

      const signingWallet = new ethers.Wallet(privateKey);
      const signingAddress = ethers.getAddress(signingWallet.address);

      if (signingAddress !== fromAddress) {
        throw new Error(
          "The local private key does not match this wallet address. Transfers cannot be signed from here."
        );
      }

      const timestamp = new Date().toISOString();
      const message = {
        fromAddress,
        toAddress,
        amount: trimmedAmount,
        timestamp,
      };
      const signature = await signingWallet.signMessage(JSON.stringify(message));

      setTransferState("submitting");

      const tx = await transferTokens({
        toAddress,
        amount: trimmedAmount,
        message,
        signature,
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
  const isFormDisabled = walletLoading || isBusy;
  const walletAddress = wallet?.walletAddress || "";
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
        <div className="notice info">
          <strong>Transfer submitted</strong>
          <p>
            Transaction {submittedTx.txId} is {submittedTx.status}. Confirmation happens in the background.
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
