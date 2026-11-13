-- Migration 011: Thêm cột status vào members và bỏ bảng membership_applications

-- 1. Thêm cột status vào bảng members nếu chưa có
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.members') AND name = 'status'
)
BEGIN
  ALTER TABLE dbo.members ADD status NVARCHAR(50) NOT NULL
    CONSTRAINT DF_members_status DEFAULT 'PENDING'
    CONSTRAINT members_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
END;
GO

-- 2. Đồng bộ dữ liệu status từ membership_applications sang members (nếu bảng tồn tại)
IF OBJECT_ID('dbo.membership_applications', 'U') IS NOT NULL
BEGIN
  EXEC('
    UPDATE m
    SET m.status = COALESCE(a.status, ''PENDING'')
    FROM dbo.members m
    JOIN dbo.membership_applications a ON a.member_id = m.id
  ');
END;
GO

-- 3. Xóa bảng membership_applications
IF OBJECT_ID('dbo.membership_applications', 'U') IS NOT NULL
BEGIN
  DROP TABLE dbo.membership_applications;
END;
GO

