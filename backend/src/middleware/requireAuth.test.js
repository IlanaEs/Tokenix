import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { requireAuth } from "./requireAuth.js";
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

test("requireAuth returns 401 without a token", async () => {
  const req = { headers: {} };
  const res = createResponse();
  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireAuth blocks frozen users with 403 even with a valid token", async (t) => {
  mockUser(t, { userId: 5, email: "frozen@tokenix.local", role: "USER", isFrozen: true });

  const req = { headers: { authorization: `Bearer ${tokenFor(5)}` } };
  const res = createResponse();
  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.deepEqual(res.body, { message: "User account is frozen" });
});

test("requireAuth allows active users and populates req.auth", async (t) => {
  mockUser(t, { userId: 7, email: "active@tokenix.local", role: "USER", isFrozen: false });

  const req = { headers: { authorization: `Bearer ${tokenFor(7)}` } };
  const res = createResponse();
  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 7);
  assert.equal(req.auth.user.isFrozen, false);
});
