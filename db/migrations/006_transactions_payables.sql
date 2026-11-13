CREATE TABLE payables (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL UNIQUE
    REFERENCES spending_proposals(id) ON DELETE NO ACTION,
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
  ON payables (status, created_at DESC);

CREATE TABLE reserve_withdrawal_requests (
  id VARCHAR(36) PRIMARY KEY,
  requested_by VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  idempotency_key NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(idempotency_key)) > 0),
  amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
  reason NVARCHAR(MAX) NOT NULL CHECK (LEN(TRIM(reason)) > 0),
  status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
  decided_by VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
  decision_reason NVARCHAR(MAX),
  decided_at DATETIMEOFFSET,
  executed_by VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
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
  ON reserve_withdrawal_requests (status, created_at DESC);

CREATE TABLE fund_transactions (
  id VARCHAR(36) PRIMARY KEY,
  transaction_type NVARCHAR(50) NOT NULL
    CHECK (transaction_type IN ('PAYMENT', 'RESERVE_WITHDRAWAL')),
  proposal_id VARCHAR(36) REFERENCES spending_proposals(id) ON DELETE NO ACTION,
  payable_id VARCHAR(36) REFERENCES payables(id) ON DELETE NO ACTION,
  reserve_withdrawal_id VARCHAR(36) UNIQUE
    REFERENCES reserve_withdrawal_requests(id) ON DELETE NO ACTION,
  created_by VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  idempotency_key NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(idempotency_key)) > 0),
  requested_amount DECIMAL(18, 2) NOT NULL CHECK (requested_amount > 0),
  note NVARCHAR(MAX),
  amount DECIMAL(18, 2) CHECK (amount IS NULL OR amount > 0),
  status NVARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')),
  rejection_reason NVARCHAR(MAX),
  overage_status NVARCHAR(50) NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (overage_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  overage_decided_by VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
  overage_decision_reason NVARCHAR(MAX),
  overage_decided_at DATETIMEOFFSET,
  completed_by VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
  completed_at DATETIMEOFFSET,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  CHECK (
    (transaction_type = 'PAYMENT'
      AND (proposal_id IS NOT NULL OR payable_id IS NOT NULL)
      AND reserve_withdrawal_id IS NULL)
    OR (transaction_type = 'RESERVE_WITHDRAWAL'
      AND proposal_id IS NULL AND payable_id IS NULL
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
  UNIQUE (created_by, idempotency_key)
);

CREATE INDEX fund_transactions_proposal_created_idx
  ON fund_transactions (proposal_id, created_at DESC);
CREATE INDEX fund_transactions_payable_created_idx
  ON fund_transactions (payable_id, created_at DESC);
CREATE INDEX fund_transactions_status_created_idx
  ON fund_transactions (status, created_at DESC);
