import { useState } from "react";
import { ethers } from "ethers";
import { getErrorMessage, transferTokens } from "../lib/api";

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

export default function SendTokens({ onBack }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function clearFeedbackOnEdit() {
    if (error) {
      setError("");
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

    setRecipient(trimmedRecipient);
    setAmount(trimmedAmount);
    setLoading(true);
    setError("");

    try {
      await transferTokens(trimmedRecipient, trimmedAmount);
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          "Transfers are not available yet."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card screen">
      <div>
        <h2>Send Tokens</h2>
        <p className="helperText">
          This form now matches the current backend request shape, but real sending stays blocked until app-created wallets can sign safely and receive tokens reliably.
        </p>
      </div>

      <div className="notice warning">
        <strong>Transfer sending intentionally disabled</strong>
        <p>The backend route exists, but real user transfers are still blocked by the current signer and token provisioning model.</p>
      </div>

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
            disabled={loading}
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
            disabled={loading}
            required
          />
        </label>

        <div className="actionsRow">
          <button type="submit" className="btn" disabled={loading}>
            {loading ? "Checking..." : "Validate Transfer Request"}
          </button>

          <button type="button" className="btn" onClick={onBack} disabled={loading}>
            Back
          </button>
        </div>
      </form>

      {error ? (
        <div className="notice error">
          <strong>Transfer blocked</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
