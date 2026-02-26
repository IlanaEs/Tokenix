import { useState } from "react";
import { transferTokens } from "../lib/api";
import { shortHash } from "../lib/format";

export default function SendTokens({ onBack }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  function clearFeedbackOnEdit() {
    if (error) {
      setError("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedRecipient = recipient.trim();
    const parsedAmount = Number(amount);

    if (!trimmedRecipient.startsWith("0x")) {
      setError('Recipient address must start with "0x"');
      setShowSuccess(false);
      setTxHash("");
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Amount must be greater than 0");
      setShowSuccess(false);
      setTxHash("");
      return;
    }

    setLoading(true);
    setError("");
    setShowSuccess(false);
    setTxHash("");

    try {
      const result = await transferTokens(trimmedRecipient, parsedAmount);
      setShowSuccess(true);
      setTxHash(result?.txHash || "");
    } catch (err) {
      setError(err?.message || "Failed to send tokens");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>Send Tokens</h2>

      <form onSubmit={handleSubmit}>
        <div>
          <input
            type="text"
            placeholder="Recipient address (0x...)"
            value={recipient}
            onChange={(e) => {
              clearFeedbackOnEdit();
              setRecipient(e.target.value);
            }}
            disabled={loading}
            required
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <input
            type="number"
            placeholder="Amount"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => {
              clearFeedbackOnEdit();
              setAmount(e.target.value);
            }}
            disabled={loading}
            required
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button type="submit" disabled={loading}>
            {loading ? "Sending..." : "Send"}
          </button>

          <button type="button" onClick={onBack} disabled={loading}>
            Back
          </button>
        </div>
      </form>

      {error && (
        <p
          style={{
            marginTop: 20,
            padding: 10,
            border: "1px solid #f5c2c7",
            borderRadius: 6,
            background: "#f8d7da",
            color: "#842029",
          }}
        >
          {error}
        </p>
      )}

      {showSuccess ? (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
          }}
        >
          <strong>Transaction Status</strong>
          <p style={{ marginTop: 10 }}>Transaction Pending...</p>
          {txHash && (
            <p style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>txHash:</strong>{" "}
              <code title={txHash}>{shortHash(txHash)}</code>
            </p>
          )}
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#f8f9fa",
            color: "#495057",
          }}
        >
          <strong>Transaction Status</strong>: Transaction status will appear
          here after transfer is implemented.
        </div>
      )}
    </div>
  );
}
