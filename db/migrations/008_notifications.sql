-- Migration 008: Notifications table
-- Thông báo trong ứng dụng (BR-024)
-- Không yêu cầu email/push; chỉ hiển thị khi đăng nhập.

CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  recipient_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  type NVARCHAR(50) NOT NULL
    CHECK (type IN (
      'NEW_MEMBER_APPLICATION',   -- Đơn đăng ký thành viên mới -> Chủ tịch
      'NEW_EVENT',                -- Chủ tịch tạo sự kiện -> tất cả thành viên
      'PROPOSAL_CREATED',         -- Proposal mới -> người đủ điều kiện vote (event-linked hoặc tất cả)
      'PROPOSAL_DECIDED',         -- Proposal được duyệt/từ chối -> người tạo
      'TIE_BOARD_REQUIRED'        -- Hòa sau vòng 2 -> Ban chủ nhiệm
    )),
  title NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(title)) > 0),
  body NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(body)) > 0),
  -- Reference data (optional, for deep linking)
  ref_id VARCHAR(36),                    -- ID tham chiếu (memberId, eventId, proposalId...)
  ref_type NVARCHAR(50)
    CHECK (ref_type IN ('member_application', 'event', 'proposal') OR ref_type IS NULL),
  is_read BIT NOT NULL DEFAULT 0,
  read_at DATETIMEOFFSET,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  CHECK (
    (is_read = 0 AND read_at IS NULL)
    OR (is_read = 1 AND read_at IS NOT NULL)
  )
);

CREATE INDEX notifications_recipient_read_idx
  ON notifications (recipient_id, is_read, created_at DESC);

CREATE INDEX notifications_ref_idx
  ON notifications (ref_type, ref_id)
  WHERE ref_id IS NOT NULL;
