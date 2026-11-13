CREATE TABLE funds (
  id VARCHAR(36) PRIMARY KEY,
  fund_type NVARCHAR(50) NOT NULL UNIQUE CHECK (fund_type IN ('MAIN', 'RESERVE')),
  balance DECIMAL(18, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM funds WHERE fund_type = 'MAIN')
  INSERT INTO funds (id, fund_type, balance)
  VALUES ('00000000-0000-4000-8000-000000000001', 'MAIN', 0);

IF NOT EXISTS (SELECT 1 FROM funds WHERE fund_type = 'RESERVE')
  INSERT INTO funds (id, fund_type, balance)
  VALUES ('00000000-0000-4000-8000-000000000002', 'RESERVE', 0);


CREATE TABLE contributions (
  id VARCHAR(36) PRIMARY KEY,
  donor_member_id VARCHAR(36) REFERENCES members(id) ON DELETE NO ACTION,
  amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
  main_allocated DECIMAL(18, 2) NOT NULL CHECK (main_allocated >= 0),
  reserve_allocated DECIMAL(18, 2) NOT NULL CHECK (reserve_allocated >= 0),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  CHECK (amount = main_allocated + reserve_allocated)
);

CREATE INDEX contributions_created_at_idx ON contributions (created_at);
CREATE INDEX contributions_donor_created_at_idx
  ON contributions (donor_member_id, created_at);
