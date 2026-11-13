DECLARE @sql NVARCHAR(MAX) = N'';

-- Drop any check constraints on status column of spending_proposals
SELECT @sql += N'ALTER TABLE spending_proposals DROP CONSTRAINT [' + cc.name + N']; '
FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('spending_proposals') AND c.name = 'status';

-- Drop any check constraints on result column of proposal_vote_rounds
SELECT @sql += N'ALTER TABLE proposal_vote_rounds DROP CONSTRAINT [' + cc.name + N']; '
FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('proposal_vote_rounds') AND c.name = 'result';

IF LEN(@sql) > 0
  EXEC sp_executesql @sql;

ALTER TABLE spending_proposals
  ADD CONSTRAINT spending_proposals_status_check
  CHECK (status IN (
    'VOTING',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'TIE_REVIEW_REQUIRED',
    'BOARD_DECISION_REQUIRED'
  ));

ALTER TABLE proposal_vote_rounds
  ADD CONSTRAINT proposal_vote_rounds_result_check
  CHECK (result IN (
    'PASSED',
    'REJECTED',
    'INCOMPLETE',
    'CANCELLED',
    'TIE_REVIEW_REQUIRED',
    'TIED',
    'BOARD_DECISION_REQUIRED'
  ));
