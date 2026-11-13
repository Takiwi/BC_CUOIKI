CREATE TABLE events (
  id VARCHAR(36) PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
  name NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(name)) > 0),
  start_at DATETIMEOFFSET NOT NULL,
  end_at DATETIMEOFFSET NOT NULL,
  location NVARCHAR(255) NOT NULL CHECK (LEN(TRIM(location)) > 0),
  max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
  CHECK (start_at < end_at)
);

CREATE INDEX events_start_at_idx ON events (start_at, id);

CREATE TABLE event_registrations (
  event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE NO ACTION,
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
  ON event_registrations (member_id, status, event_id);
