import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { requireAdmin } from "./requireAdmin.js";
import { pool } from "../db.js";

process.env.JWT_SECRET = "test-secret";

const originalQuery = pool.query.bind(pool);

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockUser(testContext, row) {
  pool.query = async () => ({ rows: row ? [row] : [] });
  testContext.after(() => {
    pool.query = originalQuery;
  });
}

function tokenFor(userId) {
  return jwt.sign({ sub: userId, email: `user-${userId}@tokenix.local` }, process.env.JWT_SECRET);
}

test("requireAdmin returns 401 without a token", async () => {
  const req = { headers: {} };
  const res = createResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireAdmin returns 403 for authenticated non-admin users", async (t) => {
  mockUser(t, { userId: 2, email: "user@tokenix.local", role: "USER", isFrozen: false });

  const req = { headers: { authorization: `Bearer ${tokenFor(2)}` } };
  const res = createResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requireAdmin allows admin users and exposes req.auth.user.role", async (t) => {
  mockUser(t, { userId: 1, email: "admin@tokenix.local", role: "ADMIN", isFrozen: false });

  const req = { headers: { authorization: `Bearer ${tokenFor(1)}` } };
  const res = createResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(req.auth.user.role, "ADMIN");
  assert.equal(req.user.id, 1);
});
