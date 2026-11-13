-- Migration 009: Database Views for repeated read-only query projections
-- Tuân thủ .agents/sql-rule.md

-- 1. View: v_event_details
IF OBJECT_ID('dbo.v_event_details', 'V') IS NOT NULL
  DROP VIEW dbo.v_event_details;
GO

CREATE VIEW dbo.v_event_details
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
        FROM event_registrations r
        WHERE r.event_id = e.id AND r.status = 'ACTIVE') AS participantCount,
       CASE
         WHEN SYSUTCDATETIME() < e.start_at THEN 'UPCOMING'
         WHEN SYSUTCDATETIME() < e.end_at THEN 'ONGOING'
         ELSE 'ENDED'
       END AS status
FROM events e;
GO

-- 2. View: v_spending_proposal_details
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

-- 3. View: v_fund_transaction_details
IF OBJECT_ID('dbo.v_fund_transaction_details', 'V') IS NOT NULL
  DROP VIEW dbo.v_fund_transaction_details;
GO

CREATE VIEW dbo.v_fund_transaction_details
AS
SELECT t.id,
       t.transaction_type AS transactionType,
       t.proposal_id AS proposalId,
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
LEFT JOIN spending_proposals p ON p.id = t.proposal_id;
GO

-- 4. View: v_reserve_withdrawal_details
IF OBJECT_ID('dbo.v_reserve_withdrawal_details', 'V') IS NOT NULL
  DROP VIEW dbo.v_reserve_withdrawal_details;
GO

CREATE VIEW dbo.v_reserve_withdrawal_details
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
FROM reserve_withdrawal_requests r
JOIN members requester ON requester.id = r.requested_by
LEFT JOIN members decider ON decider.id = r.decided_by
LEFT JOIN members executor ON executor.id = r.executed_by;
GO

