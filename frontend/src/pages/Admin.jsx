import { useEffect, useState } from "react";
import {
  ApiError,
  changeAdminUserRole,
  fetchAdminSummary,
  fetchAdminTransactions,
  fetchAdminUsers,
  freezeAdminUser,
} from "../lib/api";
import { shortHash } from "../lib/format";
import { clearToken } from "../lib/token";

const SUMMARY_ITEMS = [
  ["totalUsers", "Total users"],
  ["activeUsers", "Active users"],
  ["frozenUsers", "Frozen users"],
  ["adminUsers", "Admin users"],
  ["totalTransactions", "Total transactions"],
  ["pendingTransactions", "Pending"],
  ["confirmedTransactions", "Confirmed"],
  ["failedTransactions", "Failed"],
];

const ROLE_OPTIONS = ["USER", "ADMIN"];
const TRANSACTION_STATUS_OPTIONS = ["ALL", "PENDING", "CONFIRMED", "FAILED"];

function getDisplayValue(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
}

function getAdminErrorMessage(error) {
  if (error instanceof ApiError) {
    if (error.status === 500) {
      return "Unable to load Admin data. Please try again later.";
    }

    if (error.status === 0) {
      return "Unable to reach the API server.";
    }
  }

  return "Unable to load Admin data. Please try again later.";
}

function getStatusBadgeClass(status) {
  if (status === "CONFIRMED") {
    return "adminBadge success";
  }

  if (status === "FAILED") {
    return "adminBadge danger";
  }

  return "adminBadge warning";
}

function mergeUserUpdate(user, updatedUser) {
  if (!updatedUser || typeof updatedUser !== "object") {
    return user;
  }

  return {
    ...user,
    ...updatedUser,
  };
}

export default function Admin({ onBack, onUnauthenticated }) {
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [transactionStatusFilter, setTransactionStatusFilter] = useState("ALL");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [viewState, setViewState] = useState("loading");
  const [error, setError] = useState("");
  const [actionUserId, setActionUserId] = useState(null);
  const [actionError, setActionError] = useState("");

  async function loadAdminData() {
    setViewState("loading");
    setError("");
    setActionError("");
    setCopyFeedback("");

    try {
      const [nextSummary, nextUsers, nextTransactions] = await Promise.all([
        fetchAdminSummary(),
        fetchAdminUsers(),
        fetchAdminTransactions(),
      ]);

      setSummary(nextSummary);
      setUsers(Array.isArray(nextUsers) ? nextUsers : []);
      setTransactions(Array.isArray(nextTransactions) ? nextTransactions : []);
      setViewState("loaded");
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        clearToken();
        onUnauthenticated?.();
        return;
      }

      if (requestError instanceof ApiError && requestError.status === 403) {
        setSummary(null);
        setUsers([]);
        setTransactions([]);
        setViewState("forbidden");
        return;
      }

      setSummary(null);
      setUsers([]);
      setTransactions([]);
      setError(getAdminErrorMessage(requestError));
      setViewState("error");
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function handleFreezeToggle(user) {
    setActionUserId(user.userId);
    setActionError("");

    try {
      const updatedUser = await freezeAdminUser(user.userId, !user.isFrozen);
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          currentUser.userId === user.userId
            ? mergeUserUpdate(currentUser, updatedUser)
            : currentUser
        )
      );
      void loadAdminData();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        clearToken();
        onUnauthenticated?.();
        return;
      }

      if (requestError instanceof ApiError && requestError.status === 403) {
        setViewState("forbidden");
        return;
      }

      setActionError(
        requestError instanceof ApiError && requestError.status === 0
          ? "Unable to reach the API server."
          : "Unable to update this user. Please try again."
      );
    } finally {
      setActionUserId(null);
    }
  }

  async function handleRoleChange(user, role) {
    if (role === user.role) {
      return;
    }

    setActionUserId(user.userId);
    setActionError("");

    try {
      const updatedUser = await changeAdminUserRole(user.userId, role);
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          currentUser.userId === user.userId
            ? mergeUserUpdate(currentUser, updatedUser)
            : currentUser
        )
      );
      void loadAdminData();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        clearToken();
        onUnauthenticated?.();
        return;
      }

      if (requestError instanceof ApiError && requestError.status === 403) {
        setViewState("forbidden");
        return;
      }

      setActionError(
        requestError instanceof ApiError && requestError.status === 0
          ? "Unable to reach the API server."
          : "Unable to update this user role. Please try again."
      );
    } finally {
      setActionUserId(null);
    }
  }

  async function handleCopyTxHash(txHash) {
    if (!txHash) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setCopyFeedback("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(txHash);
      setCopyFeedback("Copied txHash.");
    } catch {
      setCopyFeedback("Unable to copy txHash.");
    }
  }

  const isLoading = viewState === "loading";
  const isLoaded = viewState === "loaded";
  const isForbidden = viewState === "forbidden";
  const isError = viewState === "error";
  const normalizedTransactionSearch = transactionSearch.trim().toLowerCase();
  const filteredTransactions = transactions.filter((transaction) => {
    if (
      transactionStatusFilter !== "ALL" &&
      transaction.status !== transactionStatusFilter
    ) {
      return false;
    }

    if (!normalizedTransactionSearch) {
      return true;
    }

    return [transaction.fromAddress, transaction.toAddress, transaction.txHash]
      .filter(Boolean)
      .some((value) =>
        String(value).toLowerCase().includes(normalizedTransactionSearch)
      );
  });

  return (
    <div className="adminScreen screen">
      <div className="adminHeader">
        <div>
          <h2>Admin</h2>
          <p className="helperText">
            Review users, permissions, freeze state, and transaction activity.
          </p>
        </div>

        <div className="actionsRow adminHeaderActions">
          <button
            type="button"
            className="btn"
            onClick={() => void loadAdminData()}
            disabled={isLoading || isForbidden}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="notice info">
          <strong>Loading Admin data...</strong>
          <p>Fetching summary, users, and transactions from the Admin API.</p>
        </div>
      ) : null}

      {isForbidden ? (
        <div className="notice warning">
          <strong>No Admin permission</strong>
          <p>Your account is authenticated, but it does not have Admin access.</p>
        </div>
      ) : null}

      {isError ? (
        <div className="notice error">
          <strong>Unable to load Admin</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {actionError ? (
        <div className="notice error">
          <strong>Admin action failed</strong>
          <p>{actionError}</p>
        </div>
      ) : null}

      {isLoaded ? (
        <>
          <section className="card adminSection">
            <div className="cardTitle">Summary</div>
            <div className="adminSummaryGrid">
              {SUMMARY_ITEMS.map(([key, label]) => (
                <div className="adminSummaryTile" key={key}>
                  <div className="detailLabel">{label}</div>
                  <div className="big">{getDisplayValue(summary?.[key], "0")}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card adminSection">
            <div className="adminSectionHeader">
              <div className="cardTitle">Users</div>
              <span className="helperText">{users.length} total</span>
            </div>

            {users.length ? (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Frozen</th>
                      <th>Wallet</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const isActionLoading = actionUserId === user.userId;

                      return (
                        <tr key={user.userId}>
                          <td className="mono">{getDisplayValue(user.userId)}</td>
                          <td>{getDisplayValue(user.email)}</td>
                          <td>
                            <select
                              className="adminSelect"
                              value={user.role}
                              onChange={(event) =>
                                void handleRoleChange(user, event.target.value)
                              }
                              disabled={isActionLoading}
                            >
                              {ROLE_OPTIONS.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span
                              className={
                                user.isFrozen
                                  ? "adminBadge danger"
                                  : "adminBadge success"
                              }
                            >
                              {user.isFrozen ? "Frozen" : "Active"}
                            </span>
                          </td>
                          <td className="mono breakText">
                            {user.walletAddress ? (
                              <span title={user.walletAddress}>
                                {shortHash(user.walletAddress)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{getDisplayValue(user.createdAt)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn adminTableButton"
                              onClick={() => void handleFreezeToggle(user)}
                              disabled={isActionLoading}
                            >
                              {isActionLoading
                                ? "Updating..."
                                : user.isFrozen
                                  ? "Unfreeze"
                                  : "Freeze"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="emptyState">No users were returned by the Admin API.</div>
            )}
          </section>

          <section className="card adminSection">
            <div className="adminSectionHeader">
              <div className="cardTitle">Transactions</div>
              <span className="helperText">
                {filteredTransactions.length} shown of {transactions.length} total
              </span>
            </div>

            {transactions.length ? (
              <>
                <div className="adminFilters">
                  <label className="fieldLabel">
                    Status
                    <select
                      className="adminSelect"
                      value={transactionStatusFilter}
                      onChange={(event) =>
                        setTransactionStatusFilter(event.target.value)
                      }
                    >
                      {TRANSACTION_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status === "ALL" ? "All" : status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fieldLabel adminSearchField">
                    Search address or txHash
                    <input
                      className="input mono"
                      type="search"
                      value={transactionSearch}
                      onChange={(event) => setTransactionSearch(event.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                </div>

                {copyFeedback ? (
                  <p className="helperText adminCopyFeedback">{copyFeedback}</p>
                ) : null}

                {filteredTransactions.length ? (
                  <div className="adminTableWrap">
                    <table className="adminTable">
                      <thead>
                        <tr>
                          <th>Tx ID</th>
                          <th>Hash</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Confirmed</th>
                          <th>Copy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((transaction, index) => (
                          <tr key={transaction.txId || transaction.txHash || index}>
                            <td className="mono">{getDisplayValue(transaction.txId)}</td>
                            <td className="mono">
                              {transaction.txHash ? (
                                <span title={transaction.txHash}>
                                  {shortHash(transaction.txHash)}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="mono">
                              <span title={transaction.fromAddress}>
                                {shortHash(transaction.fromAddress) || "-"}
                              </span>
                            </td>
                            <td className="mono">
                              <span title={transaction.toAddress}>
                                {shortHash(transaction.toAddress) || "-"}
                              </span>
                            </td>
                            <td>{getDisplayValue(transaction.amount)}</td>
                            <td>
                              <span className={getStatusBadgeClass(transaction.status)}>
                                {getDisplayValue(transaction.status)}
                              </span>
                            </td>
                            <td>{getDisplayValue(transaction.createdAt)}</td>
                            <td>{getDisplayValue(transaction.confirmedAt)}</td>
                            <td>
                              {transaction.txHash ? (
                                <button
                                  type="button"
                                  className="btn adminTableButton"
                                  onClick={() => void handleCopyTxHash(transaction.txHash)}
                                >
                                  Copy
                                </button>
                              ) : (
                                <span className="helperText">No hash</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="emptyState">
                    No transactions match the current filters.
                  </div>
                )}
              </>
            ) : (
              <div className="emptyState">
                No transactions were returned by the Admin API.
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
