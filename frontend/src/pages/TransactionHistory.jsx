import { useState } from "react";
import { fetchTransactions } from "../lib/api";
import { shortHash } from "../lib/format";

function getStatusBadgeStyle(status) {
  const baseStyle = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid transparent",
  };

  if (status === "CONFIRMED") {
    return {
      ...baseStyle,
      background: "#d1e7dd",
      color: "#0f5132",
      borderColor: "#badbcc",
    };
  }

  if (status === "FAILED") {
    return {
      ...baseStyle,
      background: "#f8d7da",
      color: "#842029",
      borderColor: "#f5c2c7",
    };
  }

  return {
    ...baseStyle,
    background: "#fff3cd",
    color: "#664d03",
    borderColor: "#ffecb5",
  };
}

export default function TransactionHistory({ onBack }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const result = await fetchTransactions();
      setTransactions(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err?.message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>Transaction History</h2>

      <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
        <button type="button" onClick={handleRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>

        <button type="button" onClick={onBack} disabled={loading}>
          Back
        </button>
      </div>

      {loading && <p style={{ marginTop: 20 }}>Loading transactions...</p>}

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

      <div
        style={{
          marginTop: 20,
          border: "1px solid #ddd",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {transactions.length > 0 ? (
          <div>
            {transactions.map((tx, index) => (
              <div
                key={`${tx.txHash || tx.createdAt || index}-${index}`}
                style={{
                  padding: 12,
                  borderTop: index === 0 ? "none" : "1px solid #eee",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <strong>{shortHash(tx.to)}</strong>
                  <span style={getStatusBadgeStyle(tx.status)}>{tx.status}</span>
                </div>

                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  <strong>Amount:</strong> {tx.amount}
                </p>
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  <strong>Created:</strong> {tx.createdAt}
                </p>

                {tx.txHash && (
                  <p style={{ marginTop: 8, marginBottom: 0 }}>
                    <strong>txHash:</strong>{" "}
                    <code title={tx.txHash}>{shortHash(tx.txHash)}</code>
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, padding: 12 }}>No transactions yet.</p>
        )}
      </div>
    </div>
  );
}
