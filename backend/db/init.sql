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
  type TEXT NOT NULL DEFAULT 'USER_TRANSFER'
    CHECK (type IN ('SYSTEM_FUNDING', 'USER_TRANSFER')),
  from_address TEXT,
  to_address TEXT,
  amount NUMERIC,
  tx_hash TEXT UNIQUE,
  status TEXT CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED')),
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS chain_epochs (
  chain_epoch_id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  faucet_address TEXT,
  deployment_marker TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_funding_jobs (
  funding_job_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id),
  wallet_address TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'funding_pending',
  funding_ready BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_target INTEGER NOT NULL DEFAULT 1,
  token_request_id TEXT NOT NULL,
  chain_id BIGINT,
  chain_epoch_id TEXT,
  gas_status TEXT NOT NULL DEFAULT 'not_started',
  gas_tx_hash TEXT,
  gas_nonce INTEGER,
  gas_signer_address TEXT,
  gas_confirmations INTEGER NOT NULL DEFAULT 0,
  gas_confirmed_at TIMESTAMPTZ,
  gas_error_code TEXT,
  token_status TEXT NOT NULL DEFAULT 'not_started',
  token_tx_hash TEXT,
  token_nonce INTEGER,
  token_signer_address TEXT,
  token_confirmations INTEGER NOT NULL DEFAULT 0,
  token_confirmed_at TIMESTAMPTZ,
  token_transfer_event_validated BOOLEAN NOT NULL DEFAULT FALSE,
  token_error_code TEXT,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id),
  UNIQUE(wallet_address),
  UNIQUE(token_request_id)
);

CREATE TABLE IF NOT EXISTS signed_transaction_outbox (
  outbox_id SERIAL PRIMARY KEY,
  funding_job_id INTEGER NOT NULL REFERENCES wallet_funding_jobs(funding_job_id),
  phase TEXT NOT NULL CHECK (phase IN ('gas', 'token')),
  tx_hash TEXT NOT NULL UNIQUE,
  signer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  chain_id BIGINT NOT NULL,
  chain_epoch_id TEXT NOT NULL,
  encrypted_raw_tx BYTEA NOT NULL,
  encryption_iv BYTEA NOT NULL,
  encryption_tag BYTEA NOT NULL,
  encryption_key_id TEXT NOT NULL,
  gas_limit TEXT,
  max_fee_per_gas TEXT,
  max_priority_fee_per_gas TEXT,
  status TEXT NOT NULL DEFAULT 'signed',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(signer_address, chain_id, chain_epoch_id, nonce)
);

CREATE TABLE IF NOT EXISTS faucet_nonce_reservations (
  signer_address TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  chain_epoch_id TEXT NOT NULL,
  next_nonce INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (signer_address, chain_id, chain_epoch_id)
);
