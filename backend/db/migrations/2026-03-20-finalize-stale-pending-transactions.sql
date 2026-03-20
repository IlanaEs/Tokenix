UPDATE transactions
SET status = 'FAILED'
WHERE status = 'PENDING'
  AND confirmed_at IS NULL
  AND created_at < NOW() - INTERVAL '10 minutes'
  AND type IN ('SYSTEM_FUNDING', 'USER_TRANSFER');
