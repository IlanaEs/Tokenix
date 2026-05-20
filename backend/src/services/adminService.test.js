import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminSummary,
  getAdminUsers,
  setUserFrozen,
  setUserRole,
  getAdminTransactions,
} from "./adminService.js";
import { pool } from "../db.js";

const originalQuery = pool.query.bind(pool);

function mockQueries(testContext, handlers) {
  const queue = [...handlers];

  pool.query = async (sql, params = []) => {
    const handler = queue.shift();
    assert.ok(handler, `Unexpected query: ${sql}`);
    return handler(String(sql), params);
  };

  testContext.after(() => {
    pool.query = originalQuery;
  });
}

test("getAdminSummary returns dashboard counts", async (t) => {
  mockQueries(t, [
    () => ({
      rows: [
        {
          totalUsers: "3",
          activeUsers: "2",
          frozenUsers: "1",
          adminUsers: "1",
        },
      ],
    }),
    () => ({
      rows: [
        {
          totalTransactions: "4",
          pendingTransactions: "1",
          confirmedTransactions: "2",
          failedTransactions: "1",
        },
      ],
    }),
  ]);

  assert.deepEqual(await getAdminSummary(), {
    totalUsers: 3,
    activeUsers: 2,
    frozenUsers: 1,
    adminUsers: 1,
    totalTransactions: 4,
    pendingTransactions: 1,
    confirmedTransactions: 2,
    failedTransactions: 1,
  });
});

test("getAdminUsers returns users with wallet data in camelCase", async (t) => {
  mockQueries(t, [
    () => ({
      rows: [
        {
          userId: 1,
          email: "admin@tokenix.local",
          role: "ADMIN",
          isFrozen: false,
          walletAddress: "0xabc",
          createdAt: "2026-05-18T10:00:00.000Z",
        },
      ],
    }),
  ]);

  assert.deepEqual(await getAdminUsers(), [
    {
      userId: 1,
      email: "admin@tokenix.local",
      role: "ADMIN",
      isFrozen: false,
      walletAddress: "0xabc",
      createdAt: "2026-05-18T10:00:00.000Z",
    },
  ]);
});

test("setUserFrozen updates freeze state and blocks self-freeze", async (t) => {
  mockQueries(t, [
    (_sql, params) => {
      assert.deepEqual(params, [2, true]);
      return { rows: [{ userId: 2, isFrozen: true }] };
    },
    () => ({ rows: [{ userId: 2, isFrozen: false }] }),
  ]);

  assert.deepEqual(await setUserFrozen({ currentUserId: 1, userId: 2, isFrozen: true }), {
    userId: 2,
    isFrozen: true,
  });
  assert.deepEqual(await setUserFrozen({ currentUserId: 1, userId: 2, isFrozen: false }), {
    userId: 2,
    isFrozen: false,
  });

  await assert.rejects(
    () => setUserFrozen({ currentUserId: 1, userId: 1, isFrozen: true }),
    /Admin cannot freeze themselves/
  );
});

test("setUserFrozen returns 404 when user is missing", async (t) => {
  mockQueries(t, [() => ({ rows: [] })]);

  await assert.rejects(
    () => setUserFrozen({ currentUserId: 1, userId: 99, isFrozen: true }),
    (error) => error.status === 404 && /User not found/.test(error.message)
  );
});

test("setUserRole updates valid role and rejects invalid role", async (t) => {
  mockQueries(t, [
    (_sql, params) => {
      assert.deepEqual(params, [2, "ADMIN"]);
      return { rows: [{ userId: 2, role: "ADMIN" }] };
    },
  ]);

  assert.deepEqual(await setUserRole({ userId: 2, role: "ADMIN" }), {
    userId: 2,
    role: "ADMIN",
  });

  await assert.rejects(
    () => setUserRole({ userId: 2, role: "OWNER" }),
    (error) => error.status === 400 && /Invalid role/.test(error.message)
  );
});

test("setUserRole returns 404 when user is missing", async (t) => {
  mockQueries(t, [() => ({ rows: [] })]);

  await assert.rejects(
    () => setUserRole({ userId: 99, role: "USER" }),
    (error) => error.status === 404 && /User not found/.test(error.message)
  );
});

test("getAdminTransactions returns transactions in API shape", async (t) => {
  mockQueries(t, [
    () => ({
      rows: [
        {
          txId: 10,
          txHash: null,
          fromAddress: "",
          toAddress: "0xabc",
          amount: "",
          status: "PENDING",
          createdAt: "2026-05-18T10:00:00.000Z",
          confirmedAt: null,
        },
      ],
    }),
  ]);

  assert.deepEqual(await getAdminTransactions(), [
    {
      txId: 10,
      txHash: null,
      fromAddress: "",
      toAddress: "0xabc",
      amount: "",
      status: "PENDING",
      createdAt: "2026-05-18T10:00:00.000Z",
      confirmedAt: null,
    },
  ]);
});
