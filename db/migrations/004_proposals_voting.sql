CREATE TABLE spending_proposals (
  id VARCHAR(36) PRIMARY KEY,
  creator_member_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  event_id VARCHAR(36) REFERENCES events(id) ON DELETE NO ACTION,
  amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
  purpose NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(purpose)) > 0),
  note NVARCHAR(MAX),
  status NVARCHAR(50) NOT NULL DEFAULT 'VOTING'
    CHECK (status IN (
      'VOTING',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'TIE_REVIEW_REQUIRED'
    )),
  reviewer_member_id VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
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
  ON spending_proposals (status, created_at DESC);
CREATE INDEX spending_proposals_creator_created_idx
  ON spending_proposals (creator_member_id, created_at DESC);
CREATE INDEX spending_proposals_event_status_idx
  ON spending_proposals (event_id, status);

CREATE TABLE proposal_vote_rounds (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL REFERENCES spending_proposals(id) ON DELETE NO ACTION,
  round_number SMALLINT NOT NULL CHECK (round_number BETWEEN 1 AND 2),
  starts_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  deadline_at DATETIMEOFFSET NOT NULL DEFAULT (DATEADD(day, 3, SYSUTCDATETIME())),
  closed_at DATETIMEOFFSET,
  result NVARCHAR(50) CHECK (result IN (
    'PASSED',
    'REJECTED',
    'INCOMPLETE',
    'CANCELLED',
    'TIE_REVIEW_REQUIRED'
  )),
  yes_count INTEGER CHECK (yes_count IS NULL OR yes_count >= 0),
  no_count INTEGER CHECK (no_count IS NULL OR no_count >= 0),
  blank_count INTEGER CHECK (blank_count IS NULL OR blank_count >= 0),
  UNIQUE (proposal_id, round_number),
  UNIQUE (id, proposal_id),
  CHECK (deadline_at > starts_at),
  CHECK (
    (closed_at IS NULL AND result IS NULL)
    OR (closed_at IS NOT NULL AND result IS NOT NULL)
  )
);

CREATE TABLE proposal_votes (
  round_id VARCHAR(36) NOT NULL REFERENCES proposal_vote_rounds(id) ON DELETE NO ACTION,
  member_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  choice NVARCHAR(50) NOT NULL CHECK (choice IN ('YES', 'NO', 'BLANK')),
  cast_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (round_id, member_id)
);

CREATE TABLE proposal_non_voters (
  round_id VARCHAR(36) NOT NULL REFERENCES proposal_vote_rounds(id) ON DELETE NO ACTION,
  member_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  recorded_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (round_id, member_id)
);
