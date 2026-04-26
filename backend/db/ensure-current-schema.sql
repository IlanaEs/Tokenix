ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name = 'timestamp'
  ) THEN
    EXECUTE '
      UPDATE transactions
      SET created_at = COALESCE(created_at, "timestamp", NOW())
      WHERE created_at IS NULL
    ';
  ELSE
    EXECUTE '
      UPDATE transactions
      SET created_at = COALESCE(created_at, NOW())
      WHERE created_at IS NULL
    ';
  END IF;
END $$;

UPDATE transactions
SET type = CASE
  WHEN from_address IS NULL THEN 'SYSTEM_FUNDING'
  ELSE 'USER_TRANSFER'
END
WHERE type IS NULL;

UPDATE transactions
SET status = 'FAILED'
WHERE status NOT IN ('PENDING', 'CONFIRMED', 'FAILED')
   OR status IS NULL;

ALTER TABLE transactions
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE transactions
ALTER COLUMN type SET DEFAULT 'USER_TRANSFER';

ALTER TABLE transactions
ALTER COLUMN type SET NOT NULL;

ALTER TABLE transactions
DROP CONSTRAINT IF EXISTS transactions_status_check;

ALTER TABLE transactions
ADD CONSTRAINT transactions_status_check
CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED'));

ALTER TABLE transactions
DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
ADD CONSTRAINT transactions_type_check
CHECK (type IN ('SYSTEM_FUNDING', 'USER_TRANSFER'));
