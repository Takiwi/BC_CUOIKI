-- Migration 013: Add ADMIN to allowed roles in members table

DECLARE @constraint_name NVARCHAR(255);

SELECT @constraint_name = cc.name
FROM sys.check_constraints cc
JOIN sys.columns c ON cc.parent_object_id = c.object_id AND cc.parent_column_id = c.column_id
WHERE cc.parent_object_id = OBJECT_ID('members') AND c.name = 'role';

IF @constraint_name IS NOT NULL
BEGIN
  EXEC('ALTER TABLE members DROP CONSTRAINT ' + @constraint_name);
END;

ALTER TABLE members
  ADD CONSTRAINT members_role_check
  CHECK (role IN ('GUEST', 'MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD', 'ADMIN'));

