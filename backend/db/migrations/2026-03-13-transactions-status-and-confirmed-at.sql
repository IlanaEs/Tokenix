UPDATE transactions
SET status = 'FAILED'
WHERE status NOT IN ('PENDING', 'CONFIRMED', 'FAILED')
   OR status IS NULL;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL;

ALTER TABLE transactions
DROP CONSTRAINT IF EXISTS transactions_status_check;

ALTER TABLE transactions
ADD CONSTRAINT transactions_status_check
CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED'));
