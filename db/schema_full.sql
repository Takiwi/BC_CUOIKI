-- ============================================================================
-- FILE: db/schema_full.sql
-- DỰ ÁN: Quản Lý Hoạt Động & Tài Chính Câu Lạc Bộ (ql_clb)
-- HỆ QUẢN TRỊ CSDL: Microsoft SQL Server (MSSQL 2019 / 2022 / Azure SQL)
-- MÔ TẢ: Tập lệnh SQL DDL toàn diện bao gồm:
--        1. Tạo các bảng (Tables), Ràng buộc (PK, FK, CHECK, UNIQUE) & Chỉ mục (Indexes)
--        2. Khởi tạo dữ liệu quỹ ban đầu (Default Fund Seeds: MAIN & RESERVE)
--        3. Tạo các View nghiệp vụ và báo cáo (Views)
--        4. Tạo các Thủ tục lưu trữ xử lý giao dịch nguyên tử (Stored Procedures)
-- CẤU TRÚC CHUẨN: Chuẩn 3NF (Loại bỏ proposal_id khỏi fund_transactions,
--                 quản lý chi tiêu qua payables, ADMIN role, dynamic eligible voters)
-- ============================================================================

-- Tùy chọn: Chọn cơ sở dữ liệu (Bỏ comment nếu chạy từ công cụ như SSMS / Azure Data Studio)
-- USE [ql_clb];
-- GO

-- ============================================================================
-- PHẦN 1: TẠO CÁC BẢNG, CHỈ MỤC VÀ RÀNG BUỘC (TABLES, INDEXES & CONSTRAINTS)
-- ============================================================================

-- 1.1. Bảng thành viên (members)
IF OBJECT_ID('dbo.members', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.members (
    id VARCHAR(36) PRIMARY KEY,
    full_name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    gender NVARCHAR(50),
    date_of_birth DATE,
    role NVARCHAR(50) NOT NULL DEFAULT 'MEMBER'
      CONSTRAINT members_role_check CHECK (role IN ('GUEST', 'MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD', 'ADMIN')),
    status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
      CONSTRAINT members_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE UNIQUE INDEX members_email_unique ON dbo.members (email);
END;
GO

-- 1.2. Bảng phiên đăng nhập và token làm mới (refresh_tokens)
IF OBJECT_ID('dbo.refresh_tokens', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.refresh_tokens (
    id VARCHAR(36) PRIMARY KEY,
    member_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIMEOFFSET NOT NULL,
    revoked_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX refresh_tokens_member_expiry_idx
    ON dbo.refresh_tokens (member_id, expires_at);
END;
GO

-- 1.3. Bảng sự kiện của câu lạc bộ (events)
IF OBJECT_ID('dbo.events', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.events (
    id VARCHAR(36) PRIMARY KEY,
    created_by VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    name NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(name)) > 0),
    start_at DATETIMEOFFSET NOT NULL,
    end_at DATETIMEOFFSET NOT NULL,
    location NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(location)) > 0),
    max_participants INT CHECK (max_participants IS NULL OR max_participants > 0),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CHECK (start_at < end_at)
  );

  CREATE INDEX events_start_at_idx ON dbo.events (start_at, id);
END;
GO

-- 1.4. Bảng đăng ký tham gia sự kiện (event_registrations)
IF OBJECT_ID('dbo.event_registrations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.event_registrations (
    event_id VARCHAR(36) NOT NULL REFERENCES dbo.events(id) ON DELETE CASCADE,
    member_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('ACTIVE', 'CANCELLED')),
    registered_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    cancelled_at DATETIMEOFFSET,
    PRIMARY KEY (event_id, member_id),
    CHECK (
      (status = 'ACTIVE' AND cancelled_at IS NULL)
      OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    )
  );

  CREATE INDEX event_registrations_member_status_idx
    ON dbo.event_registrations (member_id, status, event_id);
END;
GO

-- 1.5. Bảng quỹ câu lạc bộ (funds: Quỹ chính & Quỹ dự phòng)
IF OBJECT_ID('dbo.funds', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.funds (
    id VARCHAR(36) PRIMARY KEY,
    fund_type NVARCHAR(50) NOT NULL UNIQUE CHECK (fund_type IN ('MAIN', 'RESERVE')),
    balance DECIMAL(18, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

-- 1.6. Bảng lịch sử tiếp nhận đóng góp tài trợ (contributions)
IF OBJECT_ID('dbo.contributions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.contributions (
    id VARCHAR(36) PRIMARY KEY,
    donor_member_id VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
    main_allocated DECIMAL(18, 2) NOT NULL CHECK (main_allocated >= 0),
    reserve_allocated DECIMAL(18, 2) NOT NULL CHECK (reserve_allocated >= 0),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CHECK (amount = main_allocated + reserve_allocated)
  );

  CREATE INDEX contributions_created_at_idx ON dbo.contributions (created_at);
  CREATE INDEX contributions_donor_created_at_idx
    ON dbo.contributions (donor_member_id, created_at);
END;
GO

-- 1.7. Bảng đề xuất chi tiêu kinh phí (spending_proposals)
IF OBJECT_ID('dbo.spending_proposals', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.spending_proposals (
    id VARCHAR(36) PRIMARY KEY,
    creator_member_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    event_id VARCHAR(36) REFERENCES dbo.events(id) ON DELETE NO ACTION,
    amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
    purpose NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(purpose)) > 0),
    note NVARCHAR(MAX),
    status NVARCHAR(50) NOT NULL DEFAULT 'VOTING'
      CONSTRAINT spending_proposals_status_check
      CHECK (status IN (
        'VOTING',
        'PENDING_APPROVAL',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'TIE_REVIEW_REQUIRED',
        'BOARD_DECISION_REQUIRED'
      )),
    reviewer_member_id VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    review_decision NVARCHAR(50) CHECK (review_decision IN ('APPROVED', 'REJECTED')),
    review_reason NVARCHAR(MAX),
    reviewed_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CHECK (
      (review_decision IS NULL AND reviewer_member_id IS NULL AND reviewed_at IS NULL)
      OR (review_decision IS NOT NULL AND reviewer_member_id IS NOT NULL AND reviewed_at IS NOT NULL)
    )
  );

  CREATE INDEX spending_proposals_status_created_idx
    ON dbo.spending_proposals (status, created_at DESC);
  CREATE INDEX spending_proposals_creator_created_idx
    ON dbo.spending_proposals (creator_member_id, created_at DESC);
  CREATE INDEX spending_proposals_event_status_idx
    ON dbo.spending_proposals (event_id, status);
END;
GO

-- 1.8. Bảng vòng biểu quyết của đề xuất chi (proposal_vote_rounds)
IF OBJECT_ID('dbo.proposal_vote_rounds', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.proposal_vote_rounds (
    id VARCHAR(36) PRIMARY KEY,
    proposal_id VARCHAR(36) NOT NULL REFERENCES dbo.spending_proposals(id) ON DELETE NO ACTION,
    round_number SMALLINT NOT NULL CHECK (round_number BETWEEN 1 AND 2),
    starts_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    deadline_at DATETIMEOFFSET NOT NULL DEFAULT (DATEADD(day, 3, SYSUTCDATETIME())),
    closed_at DATETIMEOFFSET,
    result NVARCHAR(50)
      CONSTRAINT proposal_vote_rounds_result_check
      CHECK (result IN (
        'PASSED',
        'REJECTED',
        'INCOMPLETE',
        'CANCELLED',
        'TIE_REVIEW_REQUIRED',
        'TIED',
        'BOARD_DECISION_REQUIRED'
      )),
    yes_count INT CHECK (yes_count IS NULL OR yes_count >= 0),
    no_count INT CHECK (no_count IS NULL OR no_count >= 0),
    blank_count INT CHECK (blank_count IS NULL OR blank_count >= 0),
    UNIQUE (proposal_id, round_number),
    UNIQUE (id, proposal_id),
    CHECK (deadline_at > starts_at),
    CHECK (
      (closed_at IS NULL AND result IS NULL)
      OR (closed_at IS NOT NULL AND result IS NOT NULL)
    )
  );
END;
GO

-- 1.9. Bảng phiếu biểu quyết của thành viên (proposal_votes)
IF OBJECT_ID('dbo.proposal_votes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.proposal_votes (
    round_id VARCHAR(36) NOT NULL REFERENCES dbo.proposal_vote_rounds(id) ON DELETE NO ACTION,
    member_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    choice NVARCHAR(50) NOT NULL CHECK (choice IN ('YES', 'NO', 'BLANK')),
    cast_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (round_id, member_id)
  );
END;
GO

-- 1.10. Bảng ghi nhận thành viên không tham gia biểu quyết (proposal_non_voters)
IF OBJECT_ID('dbo.proposal_non_voters', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.proposal_non_voters (
    round_id VARCHAR(36) NOT NULL REFERENCES dbo.proposal_vote_rounds(id) ON DELETE NO ACTION,
    member_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    recorded_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (round_id, member_id)
  );
END;
GO

-- 1.11. Bảng quản lý khoản phải trả / công nợ chi tiêu (payables)
IF OBJECT_ID('dbo.payables', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.payables (
    id VARCHAR(36) PRIMARY KEY,
    proposal_id VARCHAR(36) NOT NULL UNIQUE
      REFERENCES dbo.spending_proposals(id) ON DELETE NO ACTION,
    approved_amount DECIMAL(18, 2) NOT NULL CHECK (approved_amount > 0),
    amount_due DECIMAL(18, 2) NOT NULL CHECK (amount_due > 0),
    amount_paid DECIMAL(18, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    balance_due DECIMAL(18, 2) NOT NULL CHECK (balance_due >= 0),
    status NVARCHAR(50) NOT NULL CHECK (status IN ('OPEN', 'PAID')),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CHECK (amount_paid <= amount_due),
    CHECK (balance_due = amount_due - amount_paid),
    CHECK (
      (status = 'OPEN' AND balance_due > 0)
      OR (status = 'PAID' AND balance_due = 0)
    )
  );

  CREATE INDEX payables_status_created_idx
    ON dbo.payables (status, created_at DESC);
END;
GO

-- 1.12. Bảng yêu cầu rút quỹ dự phòng khẩn cấp (reserve_withdrawal_requests)
IF OBJECT_ID('dbo.reserve_withdrawal_requests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.reserve_withdrawal_requests (
    id VARCHAR(36) PRIMARY KEY,
    requested_by VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    idempotency_key NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(idempotency_key)) > 0),
    amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
    reason NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(reason)) > 0),
    status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
    decided_by VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    decision_reason NVARCHAR(MAX),
    decided_at DATETIMEOFFSET,
    executed_by VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    executed_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    UNIQUE (requested_by, idempotency_key),
    CHECK (
      (status = 'PENDING'
        AND decided_by IS NULL AND decided_at IS NULL
        AND decision_reason IS NULL AND executed_by IS NULL AND executed_at IS NULL)
      OR (status = 'APPROVED'
        AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND decision_reason IS NULL AND executed_by IS NULL AND executed_at IS NULL)
      OR (status = 'REJECTED'
        AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND LEN(TRIM(COALESCE(decision_reason, ''))) > 0
        AND executed_by IS NULL AND executed_at IS NULL)
      OR (status = 'COMPLETED'
        AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND executed_by IS NOT NULL AND executed_at IS NOT NULL)
    )
  );

  CREATE INDEX reserve_withdrawal_status_created_idx
    ON dbo.reserve_withdrawal_requests (status, created_at DESC);
END;
GO

-- 1.13. Bảng sổ cái giao dịch quỹ (fund_transactions: Chuẩn 3NF liên kết payables / reserve_withdrawal_requests)
IF OBJECT_ID('dbo.fund_transactions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.fund_transactions (
    id VARCHAR(36) PRIMARY KEY,
    transaction_type NVARCHAR(50) NOT NULL
      CHECK (transaction_type IN ('PAYMENT', 'RESERVE_WITHDRAWAL')),
    payable_id VARCHAR(36) REFERENCES dbo.payables(id) ON DELETE NO ACTION,
    reserve_withdrawal_id VARCHAR(36) UNIQUE
      REFERENCES dbo.reserve_withdrawal_requests(id) ON DELETE NO ACTION,
    created_by VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    idempotency_key NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(idempotency_key)) > 0),
    requested_amount DECIMAL(18, 2) NOT NULL CHECK (requested_amount > 0),
    note NVARCHAR(MAX),
    amount DECIMAL(18, 2) CHECK (amount IS NULL OR amount > 0),
    status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')),
    rejection_reason NVARCHAR(MAX),
    overage_status NVARCHAR(50) NOT NULL DEFAULT 'NOT_REQUIRED'
      CHECK (overage_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
    overage_decided_by VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    overage_decision_reason NVARCHAR(MAX),
    overage_decided_at DATETIMEOFFSET,
    completed_by VARCHAR(36) REFERENCES dbo.members(id) ON DELETE NO ACTION,
    completed_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fund_transactions_type_links_check CHECK (
      (transaction_type = 'PAYMENT'
        AND payable_id IS NOT NULL
        AND reserve_withdrawal_id IS NULL)
      OR (transaction_type = 'RESERVE_WITHDRAWAL'
        AND payable_id IS NULL
        AND reserve_withdrawal_id IS NOT NULL)
    ),
    CHECK (
      (status = 'PENDING' AND amount IS NULL
        AND completed_by IS NULL AND completed_at IS NULL
        AND rejection_reason IS NULL)
      OR (status = 'COMPLETED' AND amount IS NOT NULL
        AND completed_by IS NOT NULL AND completed_at IS NOT NULL
        AND rejection_reason IS NULL)
      OR (status = 'REJECTED' AND amount IS NULL
        AND completed_by IS NULL AND completed_at IS NULL
        AND LEN(TRIM(COALESCE(rejection_reason, ''))) > 0)
    ),
    CHECK (
      (overage_status IN ('NOT_REQUIRED', 'PENDING')
        AND overage_decided_by IS NULL
        AND overage_decision_reason IS NULL
        AND overage_decided_at IS NULL)
      OR (overage_status = 'APPROVED'
        AND overage_decided_by IS NOT NULL
        AND overage_decided_at IS NOT NULL)
      OR (overage_status = 'REJECTED'
        AND overage_decided_by IS NOT NULL
        AND overage_decided_at IS NOT NULL
        AND LEN(TRIM(COALESCE(overage_decision_reason, ''))) > 0)
    ),
    CONSTRAINT fund_transactions_completed_by_check CHECK (
      (status = 'COMPLETED' AND completed_by IS NOT NULL)
      OR (status <> 'COMPLETED' AND completed_by IS NULL)
    ),
    UNIQUE (created_by, idempotency_key)
  );

  CREATE INDEX fund_transactions_payable_created_idx
    ON dbo.fund_transactions (payable_id, created_at DESC);
  CREATE INDEX fund_transactions_status_created_idx
    ON dbo.fund_transactions (status, created_at DESC);
END;
GO

-- 1.14. Bảng thông báo người dùng nội bộ (notifications)
IF OBJECT_ID('dbo.notifications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.notifications (
    id VARCHAR(36) PRIMARY KEY,
    recipient_id VARCHAR(36) NOT NULL REFERENCES dbo.members(id) ON DELETE NO ACTION,
    type NVARCHAR(50) NOT NULL
      CHECK (type IN (
        'NEW_MEMBER_APPLICATION',
        'NEW_EVENT',
        'PROPOSAL_CREATED',
        'PROPOSAL_DECIDED',
        'TIE_BOARD_REQUIRED',
        'FUND_SUFFICIENT_FOR_DEBT'
      )),
    title NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(title)) > 0),
    body NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(body)) > 0),
    ref_id VARCHAR(36),
    ref_type NVARCHAR(50)
      CHECK (ref_type IN ('member_application', 'event', 'proposal', 'debt') OR ref_type IS NULL),
    is_read BIT NOT NULL DEFAULT 0,
    read_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    CHECK (
      (is_read = 0 AND read_at IS NULL)
      OR (is_read = 1 AND read_at IS NOT NULL)
    )
  );

  CREATE INDEX notifications_recipient_read_idx
    ON dbo.notifications (recipient_id, is_read, created_at DESC);

  CREATE INDEX notifications_ref_idx
    ON dbo.notifications (ref_type, ref_id)
    WHERE ref_id IS NOT NULL;
END;
GO

-- 1.15. Bảng quản lý phiên bản migration (schema_migrations)
IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (
    name NVARCHAR(255) PRIMARY KEY,
    applied_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO


-- ============================================================================
-- PHẦN 2: DỮ LIỆU BAN ĐẦU (SEED DATA: DEFAULT FUNDS)
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM dbo.funds WHERE fund_type = 'MAIN')
BEGIN
  INSERT INTO dbo.funds (id, fund_type, balance, created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-000000000001', 'MAIN', 0, SYSUTCDATETIME(), SYSUTCDATETIME());
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.funds WHERE fund_type = 'RESERVE')
BEGIN
  INSERT INTO dbo.funds (id, fund_type, balance, created_at, updated_at)
  VALUES ('00000000-0000-4000-8000-000000000002', 'RESERVE', 0, SYSUTCDATETIME(), SYSUTCDATETIME());
END;
GO


-- ============================================================================
-- PHẦN 3: ĐỊNH NGHĨA CÁC KHUNG NHÌN (DATABASE VIEWS)
-- ============================================================================

-- 3.1. Khung nhìn chi tiết sự kiện và trạng thái diễn ra (v_event_details)
CREATE OR ALTER VIEW dbo.v_event_details
AS
SELECT e.id,
       e.name,
       e.start_at AS startDate,
       e.end_at AS endDate,
       e.location,
       e.max_participants AS maxParticipants,
       e.created_by AS createdBy,
       e.created_at AS createdAt,
       e.updated_at AS updatedAt,
       (SELECT COUNT(*)
        FROM dbo.event_registrations r
        WHERE r.event_id = e.id AND r.status = 'ACTIVE') AS participantCount,
       CASE
         WHEN SYSUTCDATETIME() < e.start_at THEN 'UPCOMING'
         WHEN SYSUTCDATETIME() < e.end_at THEN 'ONGOING'
         ELSE 'ENDED'
       END AS status
FROM dbo.events e;
GO

-- 3.2. Khung nhìn chi tiết đề xuất chi tiêu, tính số cử tri và số phiếu (v_spending_proposal_details)
CREATE OR ALTER VIEW dbo.v_spending_proposal_details
AS
SELECT p.id,
       p.creator_member_id AS creatorMemberId,
       creator.full_name AS creatorName,
       creator.role AS creatorRole,
       p.event_id AS eventId,
       e.name AS eventName,
       CAST(p.amount AS NVARCHAR(50)) AS amount,
       p.purpose,
       p.note,
       p.status,
       p.reviewer_member_id AS reviewerMemberId,
       reviewer.full_name AS reviewerName,
       p.review_decision AS reviewDecision,
       p.review_reason AS reviewReason,
       p.reviewed_at AS reviewedAt,
       p.created_at AS createdAt,
       p.updated_at AS updatedAt,
       round.round_number AS currentRound,
       round.deadline_at AS deadlineAt,
       COALESCE(voters.eligible_voters, 0) AS eligibleVoters,
       COALESCE(votes.total_votes, 0) AS totalVotes
FROM dbo.spending_proposals p
JOIN dbo.members creator ON creator.id = p.creator_member_id
LEFT JOIN dbo.events e ON e.id = p.event_id
LEFT JOIN dbo.members reviewer ON reviewer.id = p.reviewer_member_id
OUTER APPLY (
  SELECT TOP (1) r.id, r.round_number, r.deadline_at, r.closed_at
  FROM dbo.proposal_vote_rounds r
  WHERE r.proposal_id = p.id
  ORDER BY r.round_number DESC
) round
OUTER APPLY (
  SELECT COUNT(*) AS eligible_voters
  FROM (
    SELECT r.member_id
    FROM dbo.event_registrations r
    JOIN dbo.members m ON m.id = r.member_id
    WHERE p.event_id IS NOT NULL
      AND r.event_id = p.event_id
      AND r.status = 'ACTIVE'
      AND r.registered_at <= COALESCE(round.closed_at, round.deadline_at)
      AND m.is_active = 1
      AND m.status = 'APPROVED'
      AND r.member_id <> p.creator_member_id
    UNION ALL
    SELECT m.id
    FROM dbo.members m
    WHERE p.event_id IS NULL
      AND m.is_active = 1
      AND m.status = 'APPROVED'
      AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
      AND m.created_at <= COALESCE(round.closed_at, round.deadline_at)
      AND m.id <> p.creator_member_id
  ) eligible
) voters
OUTER APPLY (
  SELECT COUNT(*) AS total_votes
  FROM dbo.proposal_votes v
  WHERE v.round_id = round.id
) votes;
GO

-- 3.3. Khung nhìn chi tiết giao dịch quỹ, truy xuất đề xuất qua payables (v_fund_transaction_details - Chuẩn 3NF)
CREATE OR ALTER VIEW dbo.v_fund_transaction_details
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
FROM dbo.fund_transactions t
JOIN dbo.members m ON m.id = t.created_by
LEFT JOIN dbo.members completer ON completer.id = t.completed_by
LEFT JOIN dbo.payables d ON d.id = t.payable_id
LEFT JOIN dbo.spending_proposals p ON p.id = d.proposal_id;
GO

-- 3.4. Khung nhìn chi tiết yêu cầu rút quỹ dự phòng (v_reserve_withdrawal_details)
CREATE OR ALTER VIEW dbo.v_reserve_withdrawal_details
AS
SELECT r.id,
       r.requested_by AS requestedBy,
       requester.full_name AS requesterName,
       requester.is_active AS requesterIsActive,
       CAST(r.amount AS NVARCHAR(50)) AS amount,
       r.reason,
       r.status,
       r.decided_by AS decidedBy,
       decider.full_name AS deciderName,
       r.decision_reason AS decisionReason,
       r.executed_by AS executedBy,
       executor.full_name AS executorName,
       r.created_at AS createdAt,
       r.decided_at AS decidedAt,
       r.executed_at AS executedAt
FROM dbo.reserve_withdrawal_requests r
JOIN dbo.members requester ON requester.id = r.requested_by
LEFT JOIN dbo.members decider ON decider.id = r.decided_by
LEFT JOIN dbo.members executor ON executor.id = r.executed_by;
GO


-- ============================================================================
-- PHẦN 4: CÁC THỦ TỤC LƯU TRỮ (STORED PROCEDURES)
-- ============================================================================

-- 4.1. Thủ tục ghi nhận đóng góp và phân bổ quỹ tự động (sp_record_contribution)
CREATE OR ALTER PROCEDURE dbo.sp_record_contribution
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

    -- 1. Phân bổ vào Quỹ chính
    IF @MainAllocated > 0
    BEGIN
      UPDATE dbo.funds
      SET balance = balance + @MainAllocated,
          updated_at = SYSUTCDATETIME()
      WHERE fund_type = 'MAIN';
    END;

    -- 2. Phân bổ vào Quỹ dự phòng
    IF @ReserveAllocated > 0
    BEGIN
      UPDATE dbo.funds
      SET balance = balance + @ReserveAllocated,
          updated_at = SYSUTCDATETIME()
      WHERE fund_type = 'RESERVE';
    END;

    -- 3. Tạo bản ghi đóng góp
    INSERT INTO dbo.contributions (
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

-- 4.2. Thủ tục hoàn tất thanh toán chi tiêu đề xuất, trừ Quỹ chính và cập nhật công nợ (sp_complete_payment_transaction)
CREATE OR ALTER PROCEDURE dbo.sp_complete_payment_transaction
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
      THROW 50001, N'Giao dịch không tồn tại', 1;
    IF @Status <> 'PENDING'
      THROW 50002, N'Giao dịch không ở trạng thái chờ thực hiện (PENDING)', 1;
    IF @TransactionType <> 'PAYMENT'
      THROW 50003, N'Chỉ giao dịch thanh toán (PAYMENT) mới được hoàn tất qua thủ tục này', 1;
    IF @PayableId IS NULL
      THROW 50004, N'Giao dịch không gắn với khoản phải trả nào', 1;

    SET @AmountToPay = @RequestedAmount;

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
      THROW 50004, N'Khoản phải trả không tồn tại', 1;
    IF @PayableStatus <> 'OPEN'
      THROW 50005, N'Khoản phải trả đã thanh toán hoàn tất (PAID)', 1;

    IF @OverageStatus = 'PENDING'
      THROW 50010, N'Phần vượt dự toán đang chờ Ban Chủ nhiệm duyệt', 1;

    -- Xử lý chi phí thực tế vượt đề xuất ban đầu (RequestedAmount > BalanceDue)
    IF @RequestedAmount > @BalanceDue
    BEGIN
      -- Cập nhật tổng số tiền thực tế phát sinh của đề xuất vào amount_due
      SET @AmountDue = @AmountPaid + @RequestedAmount;

      IF @OverageStatus = 'REJECTED'
      BEGIN
        -- Nếu Ban Chủ nhiệm từ chối: Quỹ chỉ chi trả phần trong hạn mức ban đầu (@BalanceDue),
        -- phần vượt còn lại chưa chi trả được giữ lại thành khoản nợ thành viên (BR-014)
        SET @AmountToPay = @BalanceDue;
      END
      ELSE IF @OverageStatus = 'APPROVED'
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
    WHERE fund_type = 'MAIN';

    IF @FundBalance IS NULL
      THROW 50007, N'Quỹ chính (MAIN) không tồn tại', 1;
    IF @FundBalance < @AmountToPay
      THROW 50009, N'Số dư Quỹ chính không đủ để thực hiện thanh toán', 1;

    UPDATE dbo.funds
    SET balance = balance - @AmountToPay,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = 'MAIN';

    -- 4. Cập nhật khoản công nợ (Payable)
    UPDATE dbo.payables
    SET amount_paid = amount_paid + @AmountToPay,
        balance_due = amount_due - (amount_paid + @AmountToPay),
        status = CASE WHEN amount_due - (amount_paid + @AmountToPay) = 0 THEN 'PAID' ELSE 'OPEN' END,
        updated_at = SYSUTCDATETIME()
    WHERE id = @PayableId;

    -- 5. Cập nhật trạng thái giao dịch sang COMPLETED
    UPDATE dbo.fund_transactions
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
  END CATCH;
END;
GO

-- 4.3. Thủ tục hoàn tất giải ngân rút quỹ dự phòng (sp_complete_reserve_withdrawal)
CREATE OR ALTER PROCEDURE dbo.sp_complete_reserve_withdrawal
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
    FROM dbo.reserve_withdrawal_requests WITH (UPDLOCK, ROWLOCK)
    WHERE id = @RequestId;

    IF @Status IS NULL
      THROW 50020, N'Yêu cầu rút quỹ dự phòng không tồn tại', 1;
    IF @Status <> 'APPROVED'
      THROW 50021, N'Chỉ yêu cầu đã được Ban Chủ nhiệm duyệt (APPROVED) mới có thể giải ngân', 1;

    -- 2. Khóa và trừ tiền Quỹ dự phòng (RESERVE)
    UPDATE dbo.funds
    SET balance = balance - @Amount,
        updated_at = SYSUTCDATETIME()
    WHERE fund_type = 'RESERVE' AND balance >= @Amount;

    IF @@ROWCOUNT = 0
      THROW 50022, N'Số dư Quỹ dự phòng (RESERVE) không đủ để giải ngân', 1;

    -- 3. Tạo bản ghi giao dịch COMPLETED trong fund_transactions
    DECLARE @TransactionId VARCHAR(36) = LOWER(CAST(NEWID() AS VARCHAR(36)));
    DECLARE @IdempotencyKey NVARCHAR(255) = CONCAT('reserve-withdrawal:', @RequestId);

    INSERT INTO dbo.fund_transactions (
      id, transaction_type, reserve_withdrawal_id, created_by,
      idempotency_key, requested_amount, amount, status,
      completed_by, completed_at, created_at
    ) VALUES (
      @TransactionId, 'RESERVE_WITHDRAWAL', @RequestId, @ExecutorId,
      @IdempotencyKey, @Amount, @Amount, 'COMPLETED',
      @ExecutorId, SYSUTCDATETIME(), SYSUTCDATETIME()
    );

    -- 4. Cập nhật trạng thái yêu cầu rút sang COMPLETED
    UPDATE dbo.reserve_withdrawal_requests
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

