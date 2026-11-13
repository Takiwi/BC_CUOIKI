-- Migration 016: Fix business rules (BR-010, BR-014, Debt notification)

-- 1. Cập nhật CHECK constraints cho bảng notifications (hỗ trợ FUND_SUFFICIENT_FOR_DEBT)
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE notifications DROP CONSTRAINT [' + cc.name + N']; '
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('notifications')
  AND (cc.definition LIKE '%type%' OR cc.definition LIKE '%ref_type%');

IF LEN(@sql) > 0
  EXEC sp_executesql @sql;
GO

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'NEW_MEMBER_APPLICATION',
    'NEW_EVENT',
    'PROPOSAL_CREATED',
    'PROPOSAL_DECIDED',
    'TIE_BOARD_REQUIRED',
    'FUND_SUFFICIENT_FOR_DEBT'
  ));
GO

ALTER TABLE notifications
  ADD CONSTRAINT notifications_ref_type_check
  CHECK (ref_type IN ('member_application', 'event', 'proposal', 'debt') OR ref_type IS NULL);
GO

-- 2. Cập nhật sp_complete_payment_transaction: Xử lý phần vượt chi phí thực tế khi Ban chủ nhiệm từ chối (BR-014)
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
    -- 1. Khóa và kiểm tra thông tin giao dịch
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
    FROM dbo.fund_transactions WITH (UPDLOCK, ROWLOCK)
    WHERE id = @TransactionId;

    IF @Status IS NULL
      THROW 50001, N''Giao dịch không tồn tại'', 1;
    IF @Status <> ''PENDING''
      THROW 50002, N''Giao dịch không ở trạng thái chờ thực hiện (PENDING)'', 1;
    IF @TransactionType <> ''PAYMENT''
      THROW 50003, N''Chỉ giao dịch thanh toán (PAYMENT) mới được hoàn tất qua thủ tục này'', 1;
    IF @PayableId IS NULL
      THROW 50004, N''Giao dịch không gắn với khoản phải trả nào'', 1;

    -- 2. Khóa và kiểm tra khoản công nợ (Payable)
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
    FROM dbo.payables WITH (UPDLOCK, ROWLOCK)
    WHERE id = @PayableId;

    IF @PayableStatus IS NULL
      THROW 50004, N''Khoản phải trả không tồn tại'', 1;
    IF @PayableStatus <> ''OPEN''
      THROW 50005, N''Khoản phải trả đã thanh toán hoàn tất (PAID)'', 1;

    IF @OverageStatus = ''PENDING''
      THROW 50010, N''Phần vượt dự toán đang chờ Ban Chủ nhiệm duyệt'', 1;

    -- Xử lý chi phí thực tế vượt đề xuất ban đầu (RequestedAmount > BalanceDue)
    IF @RequestedAmount > @BalanceDue
    BEGIN
      -- Cập nhật tổng số tiền thực tế phát sinh của đề xuất vào amount_due
      SET @AmountDue = @AmountPaid + @RequestedAmount;

      IF @OverageStatus = ''REJECTED''
      BEGIN
        -- Nếu Ban Chủ nhiệm từ chối: Quỹ chỉ chi trả phần trong hạn mức ban đầu (@BalanceDue),
        -- phần vượt còn lại chưa chi trả được giữ lại thành khoản nợ thành viên (BR-014)
        SET @AmountToPay = @BalanceDue;
      END
      ELSE IF @OverageStatus = ''APPROVED''
      BEGIN
        -- Nếu Ban Chủ nhiệm duyệt: Quỹ chi trả toàn bộ số tiền thực tế vượt
        SET @AmountToPay = @RequestedAmount;
      END
      ELSE
      BEGIN
        SET @AmountToPay = @BalanceDue;
      END;

      UPDATE dbo.payables
      SET amount_due = @AmountDue,
          updated_at = SYSUTCDATETIME()
      WHERE id = @PayableId;
    END
    ELSE
    BEGIN
      SET @AmountToPay = @RequestedAmount;
    END;

    -- 3. Khóa và trừ Quỹ chính (MAIN)
    DECLARE @FundBalance DECIMAL(18,2);
    SELECT @FundBalance = balance
    FROM dbo.funds WITH (UPDLOCK, ROWLOCK)
    WHERE fund_type = ''MAIN'';

    IF @FundBalance IS NULL
      THROW 50007, N''Quỹ chính (MAIN) không tồn tại'', 1;
    IF @FundBalance < @AmountToPay
      THROW 50009, N''Số dư Quỹ chính không đủ để thực hiện thanh toán'', 1;

    UPDATE dbo.funds
    SET balance = balance - @AmountToPay,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = ''MAIN'';

    -- 4. Cập nhật khoản công nợ (Payable)
    UPDATE dbo.payables
    SET amount_paid = amount_paid + @AmountToPay,
        balance_due = amount_due - (amount_paid + @AmountToPay),
        status = CASE WHEN amount_due - (amount_paid + @AmountToPay) = 0 THEN ''PAID'' ELSE ''OPEN'' END,
        updated_at = SYSUTCDATETIME()
    WHERE id = @PayableId;

    -- 5. Cập nhật trạng thái giao dịch sang COMPLETED
    UPDATE dbo.fund_transactions
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
GO

