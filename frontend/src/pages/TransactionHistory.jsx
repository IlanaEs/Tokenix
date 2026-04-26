import { useEffect, useState } from "react";
import {
  fetchTransactions,
  getErrorMessage,
} from "../lib/api";
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

function getTransactionTypeBadgeStyle(type) {
  const baseStyle = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid transparent",
  };

  if (type === "SYSTEM_FUNDING") {
    return {
      ...baseStyle,
      background: "#dbeafe",
      color: "#1d4ed8",
      borderColor: "#bfdbfe",
    };
  }

  return {
    ...baseStyle,
    background: "#ede9fe",
    color: "#6d28d9",
    borderColor: "#ddd6fe",
  };
}

function getTransactionKey(transaction, index) {
  return (
    transaction.txId ||
    transaction.txHash ||
    `${transaction.createdAt || transaction.confirmedAt || "tx"}-${index}`
  );
}

function getTransactionTypeLabel(type) {
  if (type === "SYSTEM_FUNDING") {
    return "System funding";
  }

  if (type === "USER_TRANSFER") {
    return "User transfer";
  }

  return "Unknown type";
}

function getTransactionAddressLabel(transaction) {
  if (transaction.type === "SYSTEM_FUNDING") {
    return "Wallet";
  }

  return transaction.toAddress ? "To" : "Address";
}

function getTransactionTarget(transaction) {
  return transaction.toAddress || transaction.fromAddress || "Address unavailable";
}

function getPrimaryTimestampLabel(transaction) {
  if (transaction.status === "CONFIRMED" && transaction.confirmedAt) {
    return "Confirmed";
  }

  return "Created";
}

function getPrimaryTimestampValue(transaction) {
  return transaction.confirmedAt || transaction.createdAt || "Timestamp unavailable";
}

function getTransactionAmount(transaction) {
  if (transaction.amount != null) {
    return transaction.amount;
  }

  if (transaction.type === "SYSTEM_FUNDING") {
    return "Not recorded";
  }

  return "-";
}

export default function TransactionHistory({ onBack }) {
  const [transactions, setTransactions] = useState([]);
  const [viewState, setViewState] = useState("loading");
  const [error, setError] = useState("");

  async function loadTransactions() {
    setViewState("loading");
    setError("");

    try {
      const result = await fetchTransactions();

      if (!Array.isArray(result)) {
        throw new Error("Unexpected transactions response.");
      }

      setTransactions(result);
      setViewState(result.length > 0 ? "loaded" : "empty");
    } catch (requestError) {
      setTransactions([]);
      setError(getErrorMessage(requestError, "Failed to load transactions."));
      setViewState("error");
    }
  }

  useEffect(() => {
    void loadTransactions();
  }, []);

  const isLoading = viewState === "loading";
  const isEmpty = viewState === "empty";
  const isError = viewState === "error";
  const isLoaded = viewState === "loaded";

  return (
    <div className="card screen">
      <div>
        <h2>Transaction History</h2>
        <p className="helperText">
          Showing the live transaction rows returned by the backend, including system funding and user transfer records.
        </p>
      </div>

      <div className="actionsRow">
        <button
          type="button"
          className="btn"
          onClick={() => void loadTransactions()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>

        <button type="button" className="btn" onClick={onBack} disabled={isLoading}>
          Back
        </button>
      </div>

      {isLoading ? (
        <div className="notice info">
          <strong>Loading transactions...</strong>
          <p>Fetching the latest transaction list from the backend.</p>
        </div>
      ) : null}

      {isError ? (
        <div className="notice error">
          <strong>Unable to load transaction history</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="emptyState">
          No transactions were returned by the backend yet.
        </div>
      ) : null}

      {isLoaded ? (
        <div className="listPanel">
          {transactions.map((transaction, index) => (
            <div className="listItem" key={getTransactionKey(transaction, index)}>
              <div className="listItemHeader">
                <strong className="mono">{shortHash(getTransactionTarget(transaction))}</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span style={getTransactionTypeBadgeStyle(transaction.type)}>
                    {getTransactionTypeLabel(transaction.type)}
                  </span>
                  <span style={getStatusBadgeStyle(transaction.status)}>
                    {transaction.status}
                  </span>
                </div>
              </div>

              <p className="listItemMeta">
                <strong>{getTransactionAddressLabel(transaction)}:</strong>{" "}
                <span className="mono" title={getTransactionTarget(transaction)}>
                  {getTransactionTarget(transaction)}
                </span>
              </p>

              <p className="listItemMeta">
                <strong>Amount:</strong> {getTransactionAmount(transaction)}
              </p>

              <p className="listItemMeta">
                <strong>{getPrimaryTimestampLabel(transaction)}:</strong>{" "}
                {getPrimaryTimestampValue(transaction)}
              </p>

              {transaction.confirmedAt ? (
                <p className="listItemMeta">
                  <strong>confirmedAt:</strong> {transaction.confirmedAt}
                </p>
              ) : null}

              {transaction.txHash ? (
                <p className="listItemMeta">
                  <strong>txHash:</strong>{" "}
                  <code className="mono" title={transaction.txHash}>
                    {shortHash(transaction.txHash)}
                  </code>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
