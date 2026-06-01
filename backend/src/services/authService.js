import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { createHttpError } from '../lib/httpError.js';

const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

// Permissive email shape check: non-empty local part, "@", domain with a dot.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password policy (registration only): min 8 chars with at least one
// uppercase, lowercase, digit, and special character.
const isStrongPassword = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

const createToken = (payload) => jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

export const register = async ({ email, password }) => {
  if (!email || !password) {
    throw createHttpError('email and password are required', 400);
  }

  if (!EMAIL_REGEX.test(email)) {
    throw createHttpError('Invalid email format', 400);
  }

  if (!isStrongPassword(password)) {
    throw createHttpError('Password does not meet security requirements', 400);
  }

  const existingUser = await pool.query('SELECT user_id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (existingUser.rowCount > 0) {
    throw createHttpError('user already exists', 409);
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);
  const createdUser = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id AS "userId", email',
    [email, passwordHash]
  );

  const user = createdUser.rows[0];
  const token = createToken({ sub: user.userId, email: user.email });
  return { user, token };
};

export const login = async ({ email, password }) => {
  if (!email || !password) {
    throw createHttpError('email and password are required', 400);
  }

  if (!EMAIL_REGEX.test(email)) {
    throw createHttpError('Invalid email format', 400);
  }

  const userResult = await pool.query(
    'SELECT user_id AS "userId", email, password_hash FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (userResult.rowCount === 0) {
    throw createHttpError('invalid credentials', 401);
  }

  const user = userResult.rows[0];
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw createHttpError('invalid credentials', 401);
  }

  const token = createToken({ sub: user.userId, email: user.email });
  return { user: { userId: user.userId, email: user.email }, token };
};
