import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

const createToken = (payload) => jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

export const register = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('email and password are required');
    error.status = 400;
    throw error;
  }

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (existingUser.rowCount > 0) {
    const error = new Error('user already exists');
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);
  const createdUser = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );

  const user = createdUser.rows[0];
  const token = createToken({ sub: user.id, email: user.email });
  return { user, token };
};

export const login = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('email and password are required');
    error.status = 400;
    throw error;
  }

  const userResult = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (userResult.rowCount === 0) {
    const error = new Error('invalid credentials');
    error.status = 401;
    throw error;
  }

  const user = userResult.rows[0];
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    const error = new Error('invalid credentials');
    error.status = 401;
    throw error;
  }

  const token = createToken({ sub: user.id, email: user.email });
  return { user: { id: user.id, email: user.email }, token };
};
