CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'USER',
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  wallet_address TEXT,
  public_key TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  tx_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  from_address TEXT,
  to_address TEXT,
  amount NUMERIC,
  tx_hash TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
