ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE transactions
SET type = CASE
  WHEN from_address IS NULL THEN 'SYSTEM_FUNDING'
  ELSE 'USER_TRANSFER'
END
WHERE type IS NULL;

ALTER TABLE transactions
ALTER COLUMN type SET NOT NULL;

ALTER TABLE transactions
DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
ADD CONSTRAINT transactions_type_check
CHECK (type IN ('SYSTEM_FUNDING', 'USER_TRANSFER'));
