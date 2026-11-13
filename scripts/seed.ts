import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as sql from 'mssql';
import * as bcrypt from 'bcryptjs';
import { createDatabaseConfig } from '../src/database/database.config';

/**
 * Cấu hình dữ liệu mẫu cho các vai trò trong hệ thống CLB.
 * Chứa thông tin MẬT KHẨU GỐC (rawPassword) rõ ràng trước khi hash bằng bcrypt.
 */
export interface SeedMemberDefinition {
  fullName: string;
  email: string;
  rawPassword: string; // Mật khẩu dạng rõ (plaintext) trước khi hash
  role: 'PRESIDENT' | 'BOARD' | 'TREASURER' | 'MEMBER' | 'ADMIN';
}

function parseCliArgs(): {
  email?: string;
  password?: string;
  fullName?: string;
  onlyPresident: boolean;
} {
  const args = process.argv.slice(2);
  const options = {
    onlyPresident: false,
  } as {
    email?: string;
    password?: string;
    fullName?: string;
    onlyPresident: boolean;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) {
      options.email = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      options.password = args[++i];
    } else if (arg === '--name' && args[i + 1]) {
      options.fullName = args[++i];
    } else if (arg === '--only-president') {
      options.onlyPresident = true;
    }
  }

  return options;
}

async function runSeed(): Promise<void> {
  const cliArgs = parseCliArgs();

  // 1. Thông tin Chủ tịch CLB (hỗ trợ tùy biến qua CLI hoặc file .env)
  const presidentEmail = (
    cliArgs.email ??
    process.env.PRESIDENT_EMAIL ??
    'president@example.com'
  )
    .trim()
    .toLowerCase();

  const presidentPassword =
    cliArgs.password ?? process.env.PRESIDENT_PASSWORD ?? 'President@123456';

  const presidentName =
    cliArgs.fullName ?? process.env.PRESIDENT_NAME ?? 'Chủ tịch CLB';

  if (!presidentEmail || !presidentEmail.includes('@')) {
    throw new Error('Địa chỉ email của President không hợp lệ.');
  }

  if (Buffer.byteLength(presidentPassword, 'utf8') < 8) {
    throw new Error('Mật khẩu của President phải có ít nhất 8 ký tự.');
  }

  // 2. Danh sách toàn bộ tài khoản mẫu được định nghĩa với mật khẩu gốc
  const seedMembers: SeedMemberDefinition[] = [
    {
      fullName: presidentName,
      email: presidentEmail,
      rawPassword: presidentPassword, // Mật khẩu gốc Chủ tịch
      role: 'PRESIDENT',
    },
    {
      fullName: 'Ban Chủ nhiệm (Board)',
      email: 'board@example.com',
      rawPassword: 'Board@123456', // Mật khẩu gốc Ban Chủ nhiệm
      role: 'BOARD',
    },
    {
      fullName: 'Thủ quỹ CLB (Treasurer)',
      email: 'treasurer@example.com',
      rawPassword: 'Treasurer@123456', // Mật khẩu gốc Thủ quỹ
      role: 'TREASURER',
    },
    {
      fullName: 'Thành viên CLB (Member)',
      email: 'member@example.com',
      rawPassword: 'Member@123456', // Mật khẩu gốc Thành viên
      role: 'MEMBER',
    },
    {
      fullName: 'Quản trị viên (Admin)',
      email: 'admin@example.com',
      rawPassword: 'Admin@123456', // Mật khẩu gốc Quản trị viên
      role: 'ADMIN',
    },
  ];

  const membersToSeed = cliArgs.onlyPresident
    ? seedMembers.filter((m) => m.role === 'PRESIDENT')
    : seedMembers;

  console.log('='.repeat(75));
  console.log('BẮT ĐẦU KHỞI TẠO DỮ LIỆU SEED CHO CƠ SỞ DỮ LIỆU SQL SERVER');
  console.log('='.repeat(75));

  const pool = new sql.ConnectionPool(createDatabaseConfig());
  await pool.connect();

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  const resultTable: Array<{
    'Họ và tên': string;
    Email: string;
    'Mật khẩu trước khi hash': string;
    'Vai trò': string;
    'Trạng thái': string;
    'Thao tác': string;
  }> = [];

  try {
    let presidentId = '';

    for (const item of membersToSeed) {
      const email = item.email.trim().toLowerCase();
      const rawPassword = item.rawPassword;

      // Hash mật khẩu dạng rõ bằng bcrypt (12 rounds)
      const passwordHash = await bcrypt.hash(rawPassword, 12);

      // Kiểm tra tài khoản đã tồn tại chưa
      const checkReq = new sql.Request(transaction);
      checkReq.input('email', sql.NVarChar, email);
      const existingRes = await checkReq.query<{
        id: string;
        role: string;
        is_active: boolean;
      }>(
        `SELECT id, role, is_active
         FROM members WITH (UPDLOCK, ROWLOCK)
         WHERE lower(email) = lower(@email)`,
      );

      let memberId: string;
      let actionType: string;

      if (existingRes.recordset && existingRes.recordset.length > 0) {
        memberId = existingRes.recordset[0].id;
        actionType = 'Cập nhật';

        const updateMemberReq = new sql.Request(transaction);
        updateMemberReq.input('id', sql.NVarChar, memberId);
        updateMemberReq.input('fullName', sql.NVarChar, item.fullName);
        updateMemberReq.input('passwordHash', sql.NVarChar, passwordHash);
        updateMemberReq.input('role', sql.NVarChar, item.role);
        await updateMemberReq.query(
          `UPDATE members
           SET full_name = @fullName,
               password_hash = @passwordHash,
               role = @role,
               status = 'APPROVED',
               is_active = 1,
               updated_at = SYSUTCDATETIME()
           WHERE id = @id`,
        );
      } else {
        memberId = randomUUID();
        actionType = 'Tạo mới';

        const insertMemberReq = new sql.Request(transaction);
        insertMemberReq.input('id', sql.NVarChar, memberId);
        insertMemberReq.input('fullName', sql.NVarChar, item.fullName);
        insertMemberReq.input('email', sql.NVarChar, email);
        insertMemberReq.input('passwordHash', sql.NVarChar, passwordHash);
        insertMemberReq.input('role', sql.NVarChar, item.role);
        await insertMemberReq.query(
          `INSERT INTO members (id, full_name, email, password_hash, role, status, is_active, created_at, updated_at)
           VALUES (@id, @fullName, @email, @passwordHash, @role, 'APPROVED', 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        );
      }

      if (item.role === 'PRESIDENT') {
        presidentId = memberId;
      }

      resultTable.push({
        'Họ và tên': item.fullName,
        Email: email,
        'Mật khẩu trước khi hash': rawPassword,
        'Vai trò': item.role,
        'Trạng thái': 'APPROVED',
        'Thao tác': actionType,
      });
    }

    await transaction.commit();

    console.log('\nDANH SÁCH TÀI KHOẢN ĐÃ SEED THÀNH CÔNG:');
    console.table(resultTable);
    console.log(
      'Tất cả mật khẩu trên đều được hash bằng bcrypt (12 rounds) khi lưu vào database.',
    );
    console.log('='.repeat(75));
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    await pool.close();
  }
}

runSeed().catch((error: unknown) => {
  console.error('\nLỗi khi thực hiện seed dữ liệu:');
  console.error(error instanceof Error ? error.message : 'Lỗi không xác định');
  process.exitCode = 1;
});
