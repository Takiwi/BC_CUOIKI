IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('fund_transactions') AND name = 'completed_by'
)
BEGIN
  ALTER TABLE fund_transactions
    ADD completed_by VARCHAR(36)
    REFERENCES members(id) ON DELETE NO ACTION;
END;

UPDATE fund_transactions
SET completed_by = created_by
WHERE status = 'COMPLETED' AND completed_by IS NULL;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE object_id = OBJECT_ID('fund_transactions_completed_by_check')
)
BEGIN
  ALTER TABLE fund_transactions DROP CONSTRAINT fund_transactions_completed_by_check;
END;

ALTER TABLE fund_transactions
  ADD CONSTRAINT fund_transactions_completed_by_check
  CHECK (
    (status = 'COMPLETED' AND completed_by IS NOT NULL)
    OR (status <> 'COMPLETED' AND completed_by IS NULL)
  );
