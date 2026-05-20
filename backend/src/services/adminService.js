import { pool } from "../db.js";

const ADMIN_ROLES = new Set(["USER", "ADMIN"]);

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

function toNumber(value) {
  return Number(value || 0);
}

function normalizeUserId(userId) {
  const normalized = Number(userId);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw createHttpError("Invalid userId", 400);
  }
  return normalized;
}

export async function getAdminSummary() {
  const [usersResult, transactionsResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS "totalUsers",
        COUNT(*) FILTER (WHERE is_frozen = FALSE) AS "activeUsers",
        COUNT(*) FILTER (WHERE is_frozen = TRUE) AS "frozenUsers",
        COUNT(*) FILTER (WHERE role = 'ADMIN') AS "adminUsers"
      FROM users
    `),
    pool.query(`
      SELECT
        COUNT(*) AS "totalTransactions",
        COUNT(*) FILTER (WHERE status = 'PENDING') AS "pendingTransactions",
        COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS "confirmedTransactions",
        COUNT(*) FILTER (WHERE status = 'FAILED') AS "failedTransactions"
      FROM transactions
    `),
  ]);

  const users = usersResult.rows[0] || {};
  const transactions = transactionsResult.rows[0] || {};

  return {
    totalUsers: toNumber(users.totalUsers),
    activeUsers: toNumber(users.activeUsers),
    frozenUsers: toNumber(users.frozenUsers),
    adminUsers: toNumber(users.adminUsers),
    totalTransactions: toNumber(transactions.totalTransactions),
    pendingTransactions: toNumber(transactions.pendingTransactions),
    confirmedTransactions: toNumber(transactions.confirmedTransactions),
    failedTransactions: toNumber(transactions.failedTransactions),
  };
}

export async function getAdminUsers() {
  const { rows } = await pool.query(`
    SELECT
      u.user_id AS "userId",
      u.email AS "email",
      u.role AS "role",
      u.is_frozen AS "isFrozen",
      w.wallet_address AS "walletAddress",
      u.created_at AS "createdAt"
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.user_id
    ORDER BY u.created_at DESC, u.user_id DESC
  `);

  return rows;
}

export async function setUserFrozen({ currentUserId, userId, isFrozen }) {
  const targetUserId = normalizeUserId(userId);
  const adminUserId = normalizeUserId(currentUserId);
  const nextFrozenState = Boolean(isFrozen);

  if (targetUserId === adminUserId && nextFrozenState) {
    throw createHttpError("Admin cannot freeze themselves", 400);
  }

  const { rows } = await pool.query(
    `
    UPDATE users
    SET is_frozen = $2
    WHERE user_id = $1
    RETURNING user_id AS "userId",
              is_frozen AS "isFrozen"
    `,
    [targetUserId, nextFrozenState]
  );

  if (!rows[0]) {
    throw createHttpError("User not found", 404);
  }

  return rows[0];
}

export async function setUserRole({ userId, role }) {
  const targetUserId = normalizeUserId(userId);
  const normalizedRole = String(role || "").trim().toUpperCase();

  if (!ADMIN_ROLES.has(normalizedRole)) {
    throw createHttpError("Invalid role", 400);
  }

  const { rows } = await pool.query(
    `
    UPDATE users
    SET role = $2
    WHERE user_id = $1
    RETURNING user_id AS "userId",
              role AS "role"
    `,
    [targetUserId, normalizedRole]
  );

  if (!rows[0]) {
    throw createHttpError("User not found", 404);
  }

  return rows[0];
}

export async function getAdminTransactions() {
  const { rows } = await pool.query(`
    SELECT
      tx_id AS "txId",
      tx_hash AS "txHash",
      COALESCE(from_address, '') AS "fromAddress",
      COALESCE(to_address, '') AS "toAddress",
      COALESCE(amount::TEXT, '') AS "amount",
      status AS "status",
      created_at AS "createdAt",
      confirmed_at AS "confirmedAt"
    FROM transactions
    ORDER BY created_at DESC, tx_id DESC
  `);

  return rows;
}
