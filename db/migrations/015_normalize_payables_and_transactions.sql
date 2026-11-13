-- Migration 015: Normalize payables and fund_transactions (3NF)
-- 1. Ensure all APPROVED proposals have a corresponding record in payables
-- 2. Link any unlinked fund_transactions to payables
-- 3. Remove redundant proposal_id from fund_transactions
-- 4. Recreate v_fund_transaction_details view joining through payables
-- 5. Update sp_complete_payment_transaction to work with normalized payables

-- Step 1: Backfill missing payables for any approved proposals
INSERT INTO payables (
  id, proposal_id, approved_amount, amount_due, amount_paid, balance_due, status, created_at, updated_at
)
SELECT 
  LOWER(CAST(NEWID() AS VARCHAR(36))),
  p.id,
  p.amount,
  p.amount,
  0,
  p.amount,
  'OPEN',
  p.updated_at,
  p.updated_at
FROM spending_proposals p
WHERE p.status = 'APPROVED'
  AND NOT EXISTS (SELECT 1 FROM payables d WHERE d.proposal_id = p.id);

-- Step 2: Backfill payable_id on fund_transactions
UPDATE t
SET t.payable_id = d.id
FROM fund_transactions t
JOIN payables d ON d.proposal_id = t.proposal_id
WHERE t.payable_id IS NULL AND t.transaction_type = 'PAYMENT';

-- Step 3: Drop constraints, indexes, and column proposal_id from fund_transactions
DECLARE @sql NVARCHAR(MAX) = N'';

-- 3.1. Drop foreign keys referencing proposal_id in fund_transactions
SELECT @sql += N'ALTER TABLE fund_transactions DROP CONSTRAINT [' + fk.name + N']; '
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
WHERE fk.parent_object_id = OBJECT_ID('fund_transactions')
  AND fkc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('fund_transactions'), 'proposal_id', 'ColumnId');

-- 3.2. Drop check constraints involving proposal_id in fund_transactions
SELECT @sql += N'ALTER TABLE fund_transactions DROP CONSTRAINT [' + cc.name + N']; '
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('fund_transactions')
  AND cc.definition LIKE '%proposal_id%';

-- 3.3. Drop index fund_transactions_proposal_created_idx
IF EXISTS (
  SELECT 1 FROM sys.indexes 
  WHERE name = 'fund_transactions_proposal_created_idx' 
    AND object_id = OBJECT_ID('fund_transactions')
)
  SET @sql += N'DROP INDEX fund_transactions_proposal_created_idx ON fund_transactions; ';

IF LEN(@sql) > 0
  EXEC sp_executesql @sql;

-- 3.4. Drop column proposal_id
IF EXISTS (
  SELECT 1 FROM sys.columns 
  WHERE name = 'proposal_id' 
    AND object_id = OBJECT_ID('fund_transactions')
)
  ALTER TABLE fund_transactions DROP COLUMN proposal_id;

-- 3.5. Add new clean constraint on fund_transactions
ALTER TABLE fund_transactions
  ADD CONSTRAINT fund_transactions_type_links_check
  CHECK (
    (transaction_type = 'PAYMENT'
      AND payable_id IS NOT NULL
      AND reserve_withdrawal_id IS NULL)
    OR (transaction_type = 'RESERVE_WITHDRAWAL'
      AND payable_id IS NULL
      AND reserve_withdrawal_id IS NOT NULL)
  );

-- Step 4: Recreate v_fund_transaction_details view
IF OBJECT_ID('dbo.v_fund_transaction_details', 'V') IS NOT NULL
  DROP VIEW dbo.v_fund_transaction_details;

EXEC('
CREATE VIEW dbo.v_fund_transaction_details
AS
SELECT t.id,
       t.transaction_type AS transactionType,
       d.proposal_id AS proposalId,
       t.payable_id AS payableId,
       t.reserve_withdrawal_id AS reserveWithdrawalId,
       p.purpose AS proposalPurpose,
       CAST(t.requested_amount AS NVARCHAR(50)) AS requestedAmount,
       CAST(t.amount AS NVARCHAR(50)) AS amount,
       t.note,
       t.status,
       t.rejection_reason AS rejectionReason,
       t.overage_status AS overageStatus,
       t.overage_decision_reason AS overageDecisionReason,
       t.created_by AS createdBy,
       m.full_name AS creatorName,
       m.is_active AS creatorIsActive,
       t.completed_by AS completedBy,
       completer.full_name AS completedByName,
       completer.is_active AS completedByIsActive,
       t.created_at AS createdAt,
       t.completed_at AS completedAt
FROM fund_transactions t
JOIN members m ON m.id = t.created_by
LEFT JOIN members completer ON completer.id = t.completed_by
LEFT JOIN payables d ON d.id = t.payable_id
LEFT JOIN spending_proposals p ON p.id = d.proposal_id;
');

-- Step 5: Update sp_complete_payment_transaction
EXEC('
CREATE OR ALTER PROCEDURE sp_complete_payment_transaction
  @TransactionId VARCHAR(36),
  @ActorId VARCHAR(36)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRANSACTION;
  BEGIN TRY
    -- 1. Khóa và kiểm tra giao dịch
    DECLARE @Status NVARCHAR(50),
            @TransactionType NVARCHAR(50),
            @PayableId VARCHAR(36),
            @RequestedAmount DECIMAL(18,2),
            @OverageStatus NVARCHAR(50),
            @AmountToPay DECIMAL(18,2);

    SELECT @Status = status,
           @TransactionType = transaction_type,
           @PayableId = CAST(payable_id AS VARCHAR(36)),
           @RequestedAmount = requested_amount,
           @OverageStatus = overage_status
    FROM fund_transactions WITH (UPDLOCK, ROWLOCK)
    WHERE id = @TransactionId;

    IF @Status IS NULL
      THROW 50001, N''Giao dịch không tồn tại'', 1;
    IF @Status <> ''PENDING''
      THROW 50002, N''Giao dịch không ở trạng thái chờ thực hiện (PENDING)'', 1;
    IF @TransactionType <> ''PAYMENT''
      THROW 50003, N''Chỉ giao dịch thanh toán (PAYMENT) mới được hoàn tất qua thủ tục này'', 1;
    IF @PayableId IS NULL
      THROW 50004, N''Giao dịch không gắn với khoản phải trả nào'', 1;

    SET @AmountToPay = @RequestedAmount;

    -- 2. Khóa và kiểm tra khoản nợ (Payable)
    DECLARE @PayableStatus NVARCHAR(50),
            @AmountDue DECIMAL(18,2),
            @AmountPaid DECIMAL(18,2),
            @BalanceDue DECIMAL(18,2),
            @ApprovedAmount DECIMAL(18,2);

    SELECT @PayableStatus = status,
           @AmountDue = amount_due,
           @AmountPaid = amount_paid,
           @BalanceDue = balance_due,
           @ApprovedAmount = approved_amount
    FROM payables WITH (UPDLOCK, ROWLOCK)
    WHERE id = @PayableId;

    IF @PayableStatus IS NULL
      THROW 50004, N''Khoản phải trả không tồn tại'', 1;
    IF @PayableStatus <> ''OPEN''
      THROW 50005, N''Khoản phải trả đã thanh toán hoàn tất (PAID)'', 1;

    IF @OverageStatus = ''PENDING''
      THROW 50010, N''Phần vượt dự toán đang chờ Ban Chủ nhiệm duyệt'', 1;

    IF @OverageStatus = ''REJECTED''
    BEGIN
      IF @AmountToPay > @BalanceDue
        SET @AmountToPay = @BalanceDue;
    END

    -- Nếu AmountToPay vượt BalanceDue (trường hợp overage được duyệt), cập nhật amount_due và balance_due
    IF @AmountToPay > @BalanceDue
    BEGIN
      SET @AmountDue = @AmountPaid + @AmountToPay;
      SET @BalanceDue = @AmountToPay;
      UPDATE payables
      SET amount_due = @AmountDue,
          balance_due = @BalanceDue,
          updated_at = SYSUTCDATETIME()
      WHERE id = @PayableId;
    END

    -- 3. Khóa và trừ Quỹ chính (MAIN)
    DECLARE @FundBalance DECIMAL(18,2);
    SELECT @FundBalance = balance
    FROM funds WITH (UPDLOCK, ROWLOCK)
    WHERE fund_type = ''MAIN'';

    IF @FundBalance IS NULL
      THROW 50007, N''Quỹ chính (MAIN) không tồn tại'', 1;
    IF @FundBalance < @AmountToPay
      THROW 50009, N''Số dư Quỹ chính không đủ để thực hiện thanh toán'', 1;

    UPDATE funds
    SET balance = balance - @AmountToPay,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = ''MAIN'';

    -- 4. Cập nhật khoản nợ (Payable)
    UPDATE payables
    SET amount_paid = amount_paid + @AmountToPay,
        balance_due = balance_due - @AmountToPay,
        status = CASE WHEN balance_due - @AmountToPay = 0 THEN ''PAID'' ELSE ''OPEN'' END,
        updated_at = SYSUTCDATETIME()
    WHERE id = @PayableId;

    -- 5. Cập nhật trạng thái giao dịch
    UPDATE fund_transactions
    SET status = ''COMPLETED'',
        amount = @AmountToPay,
        completed_by = @ActorId,
        completed_at = SYSUTCDATETIME()
    WHERE id = @TransactionId;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0
      ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;
');

