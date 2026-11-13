-- Migration 012: Bỏ bảng proposal_voter_snapshots, tính cử tri hợp lệ động

-- 1. Xóa các FK trên proposal_votes và proposal_non_voters tham chiếu đến proposal_voter_snapshots
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) +
               N' DROP CONSTRAINT ' + QUOTENAME(name) + N';' + CHAR(13)
FROM sys.foreign_keys
WHERE referenced_object_id = OBJECT_ID('dbo.proposal_voter_snapshots');

IF LEN(@sql) > 0
  EXEC sp_executesql @sql;
GO

-- 2. Thêm FK trực tiếp tới proposal_vote_rounds và members cho proposal_votes
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.proposal_votes')
    AND referenced_object_id = OBJECT_ID('dbo.proposal_vote_rounds')
)
BEGIN
  ALTER TABLE dbo.proposal_votes
    ADD CONSTRAINT FK_proposal_votes_round FOREIGN KEY (round_id)
    REFERENCES dbo.proposal_vote_rounds(id) ON DELETE NO ACTION;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.proposal_votes')
    AND referenced_object_id = OBJECT_ID('dbo.members')
)
BEGIN
  ALTER TABLE dbo.proposal_votes
    ADD CONSTRAINT FK_proposal_votes_member FOREIGN KEY (member_id)
    REFERENCES dbo.members(id) ON DELETE NO ACTION;
END;
GO

-- 3. Thêm FK trực tiếp tới proposal_vote_rounds và members cho proposal_non_voters
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.proposal_non_voters')
    AND referenced_object_id = OBJECT_ID('dbo.proposal_vote_rounds')
)
BEGIN
  ALTER TABLE dbo.proposal_non_voters
    ADD CONSTRAINT FK_proposal_non_voters_round FOREIGN KEY (round_id)
    REFERENCES dbo.proposal_vote_rounds(id) ON DELETE NO ACTION;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.proposal_non_voters')
    AND referenced_object_id = OBJECT_ID('dbo.members')
)
BEGIN
  ALTER TABLE dbo.proposal_non_voters
    ADD CONSTRAINT FK_proposal_non_voters_member FOREIGN KEY (member_id)
    REFERENCES dbo.members(id) ON DELETE NO ACTION;
END;
GO

-- 4. Xóa bảng proposal_voter_snapshots
IF OBJECT_ID('dbo.proposal_voter_snapshots', 'U') IS NOT NULL
BEGIN
  DROP TABLE dbo.proposal_voter_snapshots;
END;
GO

-- 5. Cập nhật lại view v_spending_proposal_details để tính eligible_voters động
IF OBJECT_ID('dbo.v_spending_proposal_details', 'V') IS NOT NULL
  DROP VIEW dbo.v_spending_proposal_details;
GO

CREATE VIEW dbo.v_spending_proposal_details
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
FROM spending_proposals p
JOIN members creator ON creator.id = p.creator_member_id
LEFT JOIN events e ON e.id = p.event_id
LEFT JOIN members reviewer ON reviewer.id = p.reviewer_member_id
OUTER APPLY (
  SELECT TOP (1) r.id, r.round_number, r.deadline_at, r.closed_at
  FROM proposal_vote_rounds r
  WHERE r.proposal_id = p.id
  ORDER BY r.round_number DESC
) round
OUTER APPLY (
  SELECT COUNT(*) AS eligible_voters
  FROM (
    SELECT r.member_id
    FROM event_registrations r
    JOIN members m ON m.id = r.member_id
    WHERE p.event_id IS NOT NULL
      AND r.event_id = p.event_id
      AND r.status = 'ACTIVE'
      AND r.registered_at <= COALESCE(round.closed_at, round.deadline_at)
      AND m.is_active = 1
      AND m.status = 'APPROVED'
      AND r.member_id <> p.creator_member_id
    UNION ALL
    SELECT m.id
    FROM members m
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
  FROM proposal_votes v
  WHERE v.round_id = round.id
) votes;
GO

