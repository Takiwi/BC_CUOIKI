-- Migration 014: Stored Procedures for atomic multi-table operations

-- 1. Stored Procedure hoàn tất thanh toán đề xuất chi và cập nhật nợ
CREATE OR ALTER PROCEDURE sp_complete_payment_transaction
  @TransactionId VARCHAR(36),
  @ActorId VARCHAR(36)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    -- 1. Khóa và kiểm tra giao dịch
    DECLARE @Status NVARCHAR(50),
            @TransactionType NVARCHAR(50),
            @PayableId VARCHAR(36),
            @ProposalId VARCHAR(36),
            @RequestedAmount DECIMAL(18,2),
            @OverageStatus NVARCHAR(50),
            @AmountToPay DECIMAL(18,2);

    SELECT @Status = status,
           @TransactionType = transaction_type,
           @PayableId = CAST(payable_id AS VARCHAR(36)),
           @ProposalId = CAST(proposal_id AS VARCHAR(36)),
           @RequestedAmount = requested_amount,
           @OverageStatus = overage_status
    FROM fund_transactions WITH (UPDLOCK, ROWLOCK)
    WHERE id = @TransactionId;

    IF @Status IS NULL
      THROW 50001, N'Giao dịch không tồn tại', 1;
    IF @Status <> 'PENDING'
      THROW 50002, N'Giao dịch không ở trạng thái chờ thực hiện (PENDING)', 1;
    IF @TransactionType <> 'PAYMENT'
      THROW 50003, N'Chỉ giao dịch thanh toán đề xuất (PAYMENT) mới được hoàn tất qua thủ tục này', 1;

    SET @AmountToPay = @RequestedAmount;

    -- 2. Kiểm tra công nợ hoặc đề xuất chi
    IF @PayableId IS NOT NULL
    BEGIN
      DECLARE @PayableStatus NVARCHAR(50), @BalanceDue DECIMAL(18,2);
      SELECT @PayableStatus = status, @BalanceDue = balance_due
      FROM payables WITH (UPDLOCK, ROWLOCK)
      WHERE id = @PayableId;

      IF @PayableStatus IS NULL
        THROW 50004, N'Khoản phải trả không tồn tại', 1;
      IF @PayableStatus <> 'OPEN'
        THROW 50005, N'Khoản phải trả đã thanh toán hoàn tất (PAID)', 1;
      IF @AmountToPay > @BalanceDue
        THROW 50006, N'Số tiền thanh toán vượt quá số nợ còn lại', 1;

      -- Cập nhật payable hiện tại
      UPDATE payables
      SET amount_paid = amount_paid + @AmountToPay,
          balance_due = balance_due - @AmountToPay,
          status = CASE WHEN balance_due - @AmountToPay = 0 THEN 'PAID' ELSE 'OPEN' END,
          updated_at = SYSUTCDATETIME()
      WHERE id = @PayableId;
    END
    ELSE
    BEGIN
      IF @ProposalId IS NULL
        THROW 50007, N'Giao dịch thanh toán không gắn với đề xuất chi nào', 1;

      DECLARE @ProposalStatus NVARCHAR(50), @ProposalApprovedAmount DECIMAL(18,2);
      SELECT @ProposalStatus = status, @ProposalApprovedAmount = amount
      FROM spending_proposals WITH (UPDLOCK, ROWLOCK)
      WHERE id = @ProposalId;

      IF @ProposalStatus IS NULL
        THROW 50008, N'Đề xuất chi không tồn tại', 1;
      IF @ProposalStatus <> 'APPROVED'
        THROW 50009, N'Đề xuất chi phải được duyệt (APPROVED) trước khi hoàn tất chi trả', 1;

      IF @OverageStatus = 'PENDING'
        THROW 50010, N'Phần vượt dự toán đang chờ Ban Chủ nhiệm duyệt', 1;

      IF @OverageStatus = 'REJECTED'
      BEGIN
        IF @AmountToPay > @ProposalApprovedAmount
          SET @AmountToPay = @ProposalApprovedAmount;
      END

      -- Tạo payable mới
      SET @PayableId = LOWER(CAST(NEWID() AS VARCHAR(36)));
      DECLARE @NewBalanceDue DECIMAL(18,2) = @RequestedAmount - @AmountToPay;
      DECLARE @NewPayableStatus NVARCHAR(50) = CASE WHEN @NewBalanceDue = 0 THEN 'PAID' ELSE 'OPEN' END;

      INSERT INTO payables (
        id, proposal_id, approved_amount, amount_due, amount_paid,
        balance_due, status, created_at, updated_at
      ) VALUES (
        @PayableId, @ProposalId, @ProposalApprovedAmount, @RequestedAmount, @AmountToPay,
        @NewBalanceDue, @NewPayableStatus, SYSUTCDATETIME(), SYSUTCDATETIME()
      );

      UPDATE fund_transactions
      SET payable_id = @PayableId
      WHERE id = @TransactionId;
    END

    -- 3. Khóa và trừ Quỹ chính (MAIN)
    UPDATE funds
    SET balance = balance - @AmountToPay,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = 'MAIN' AND balance >= @AmountToPay;

    IF @@ROWCOUNT = 0
      THROW 50011, N'Số dư Quỹ chính (MAIN) không đủ để thanh toán', 1;

    -- 4. Cập nhật giao dịch sang COMPLETED
    UPDATE fund_transactions
    SET status = 'COMPLETED',
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
  END CATCH
END;
GO

-- 2. Stored Procedure hoàn tất giải ngân rút quỹ dự phòng
CREATE OR ALTER PROCEDURE sp_complete_reserve_withdrawal
  @RequestId VARCHAR(36),
  @ExecutorId VARCHAR(36)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    -- 1. Khóa và kiểm tra yêu cầu rút quỹ dự phòng
    DECLARE @Status NVARCHAR(50),
            @Amount DECIMAL(18,2);

    SELECT @Status = status,
           @Amount = amount
    FROM reserve_withdrawal_requests WITH (UPDLOCK, ROWLOCK)
    WHERE id = @RequestId;

    IF @Status IS NULL
      THROW 50020, N'Yêu cầu rút quỹ dự phòng không tồn tại', 1;
    IF @Status <> 'APPROVED'
      THROW 50021, N'Chỉ yêu cầu đã được Ban Chủ nhiệm duyệt (APPROVED) mới có thể giải ngân', 1;

    -- 2. Khóa và trừ tiền Quỹ dự phòng (RESERVE)
    UPDATE funds
    SET balance = balance - @Amount,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = 'RESERVE' AND balance >= @Amount;

    IF @@ROWCOUNT = 0
      THROW 50022, N'Số dư Quỹ dự phòng (RESERVE) không đủ để giải ngân', 1;

    -- 3. Tạo bản ghi giao dịch COMPLETED trong fund_transactions
    DECLARE @TransactionId VARCHAR(36) = LOWER(CAST(NEWID() AS VARCHAR(36)));
    DECLARE @IdempotencyKey NVARCHAR(255) = CONCAT('reserve-withdrawal:', @RequestId);

    INSERT INTO fund_transactions (
      id, transaction_type, reserve_withdrawal_id, created_by,
      idempotency_key, requested_amount, amount, status,
      completed_by, completed_at, created_at
    ) VALUES (
      @TransactionId, 'RESERVE_WITHDRAWAL', @RequestId, @ExecutorId,
      @IdempotencyKey, @Amount, @Amount, 'COMPLETED',
      @ExecutorId, SYSUTCDATETIME(), SYSUTCDATETIME()
    );

    -- 4. Cập nhật trạng thái yêu cầu rút sang COMPLETED
    UPDATE reserve_withdrawal_requests
    SET status = 'COMPLETED',
        executed_by = @ExecutorId,
        executed_at = SYSUTCDATETIME(),
        updated_at = SYSUTCDATETIME()
    WHERE id = @RequestId;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0
      ROLLBACK TRANSACTION;
    THROW;
  END CATCH
END;
GO

-- 3. Stored Procedure tiếp nhận đóng góp và phân bổ quỹ
CREATE OR ALTER PROCEDURE sp_record_contribution
  @ContributionId VARCHAR(36),
  @DonorMemberId VARCHAR(36) = NULL,
  @Amount DECIMAL(18,2),
  @MainAllocated DECIMAL(18,2),
  @ReserveAllocated DECIMAL(18,2)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @Amount <= 0
      THROW 50030, N'Số tiền đóng góp phải lớn hơn 0', 1;
    IF @Amount <> (@MainAllocated + @ReserveAllocated)
      THROW 50031, N'Tổng tiền phân bổ không khớp với số tiền đóng góp', 1;

    -- 1. Cộng tiền Quỹ chính
    IF @MainAllocated > 0
    BEGIN
      UPDATE funds
      SET balance = balance + @MainAllocated,
          updated_at = SYSUTCDATETIME()
      WHERE fund_type = 'MAIN';
    END

    -- 2. Cộng tiền Quỹ dự phòng
    IF @ReserveAllocated > 0
    BEGIN
      UPDATE funds
      SET balance = balance + @ReserveAllocated,
          updated_at = SYSUTCDATETIME()
      WHERE fund_type = 'RESERVE';
    END

    -- 3. Tạo bản ghi đóng góp
    INSERT INTO contributions (
      id, donor_member_id, amount, main_allocated, reserve_allocated, created_at
    ) VALUES (
      @ContributionId, @DonorMemberId, @Amount, @MainAllocated, @ReserveAllocated, SYSUTCDATETIME()
    );

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0
      ROLLBACK TRANSACTION;
    THROW;
  END CATCH
END;
GO

