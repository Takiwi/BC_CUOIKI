import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as sql from 'mssql';
import * as bcrypt from 'bcryptjs';
import { createDatabaseConfig } from '../src/database/database.config';

/**
 * Cấu hình dữ liệu mẫu cho các thành viên trong hệ thống CLB.
 * Chứa thông tin họ tên thực tế, mật khẩu gốc, giới tính, ngày sinh và trạng thái.
 */
export interface SeedMemberDefinition {
  fullName: string;
  email: string;
  rawPassword: string; // Mật khẩu dạng rõ (plaintext) trước khi hash
  role: 'PRESIDENT' | 'BOARD' | 'TREASURER' | 'MEMBER' | 'ADMIN';
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
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
    cliArgs.fullName ?? process.env.PRESIDENT_NAME ?? 'Nguyễn Văn An';

  if (!presidentEmail || !presidentEmail.includes('@')) {
    throw new Error('Địa chỉ email của President không hợp lệ.');
  }

  if (Buffer.byteLength(presidentPassword, 'utf8') < 8) {
    throw new Error('Mật khẩu của President phải có ít nhất 8 ký tự.');
  }

  // 2. Danh sách toàn bộ tài khoản mẫu được định nghĩa với Họ và tên đầy đủ thực tế
  const seedMembers: SeedMemberDefinition[] = [
    {
      fullName: presidentName,
      email: presidentEmail,
      rawPassword: presidentPassword,
      role: 'PRESIDENT',
      gender: 'MALE',
      dateOfBirth: '2002-05-15',
      status: 'APPROVED',
    },
    {
      fullName: 'Trần Thị Mai Phương',
      email: 'board@example.com',
      rawPassword: 'Board@123456',
      role: 'BOARD',
      gender: 'FEMALE',
      dateOfBirth: '2003-08-20',
      status: 'APPROVED',
    },
    {
      fullName: 'Lê Hoàng Long',
      email: 'treasurer@example.com',
      rawPassword: 'Treasurer@123456',
      role: 'TREASURER',
      gender: 'MALE',
      dateOfBirth: '2002-11-10',
      status: 'APPROVED',
    },
    {
      fullName: 'Phạm Minh Tuấn',
      email: 'member@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'MALE',
      dateOfBirth: '2004-03-25',
      status: 'APPROVED',
    },
    {
      fullName: 'Đỗ Thu Hà',
      email: 'member2@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'FEMALE',
      dateOfBirth: '2004-07-12',
      status: 'APPROVED',
    },
    {
      fullName: 'Vũ Đình Trọng',
      email: 'member3@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'MALE',
      dateOfBirth: '2003-01-18',
      status: 'APPROVED',
    },
    {
      fullName: 'Nguyễn Thị Bích Ngọc',
      email: 'member4@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'FEMALE',
      dateOfBirth: '2004-09-30',
      status: 'APPROVED',
    },
    {
      fullName: 'Đặng Quốc Huy',
      email: 'member5@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'MALE',
      dateOfBirth: '2003-12-05',
      status: 'APPROVED',
    },
    {
      fullName: 'Bùi Phương Linh',
      email: 'linh.bui@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'FEMALE',
      dateOfBirth: '2005-02-14',
      status: 'PENDING',
    },
    {
      fullName: 'Trần Đức Anh',
      email: 'ducanh.tran@example.com',
      rawPassword: 'Member@123456',
      role: 'MEMBER',
      gender: 'MALE',
      dateOfBirth: '2004-06-22',
      status: 'REJECTED',
    },
    {
      fullName: 'Hoàng Trung Dũng',
      email: 'admin@example.com',
      rawPassword: 'Admin@123456',
      role: 'ADMIN',
      gender: 'MALE',
      dateOfBirth: '2000-01-01',
      status: 'APPROVED',
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
    // 0. Dọn dẹp các email thử nghiệm sót lại từ quá trình chạy kiểm thử E2E (nếu có)
    const cleanupReq = new sql.Request(transaction);
    await cleanupReq.query(
      `DELETE FROM members WHERE email LIKE 'rejected-applicant-%' OR email LIKE 'test-%'`,
    );

    const memberIdMap = new Map<string, string>();

    // 1. Seed danh sách tài khoản thành viên
    for (const item of membersToSeed) {
      const email = item.email.trim().toLowerCase();
      const rawPassword = item.rawPassword;
      const status = item.status ?? 'APPROVED';
      const gender = item.gender ?? null;
      const dateOfBirth = item.dateOfBirth ?? null;

      // Hash mật khẩu dạng rõ bằng bcrypt (12 rounds)
      const passwordHash = await bcrypt.hash(rawPassword, 12);

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
        updateMemberReq.input('gender', sql.NVarChar, gender);
        updateMemberReq.input('dateOfBirth', sql.Date, dateOfBirth);
        updateMemberReq.input('status', sql.NVarChar, status);
        await updateMemberReq.query(
          `UPDATE members
           SET full_name = @fullName,
               password_hash = @passwordHash,
               role = @role,
               gender = @gender,
               date_of_birth = @dateOfBirth,
               status = @status,
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
        insertMemberReq.input('gender', sql.NVarChar, gender);
        insertMemberReq.input('dateOfBirth', sql.Date, dateOfBirth);
        insertMemberReq.input('status', sql.NVarChar, status);
        await insertMemberReq.query(
          `INSERT INTO members (id, full_name, email, password_hash, role, gender, date_of_birth, status, is_active, created_at, updated_at)
           VALUES (@id, @fullName, @email, @passwordHash, @role, @gender, @dateOfBirth, @status, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        );
      }

      memberIdMap.set(email, memberId);

      resultTable.push({
        'Họ và tên': item.fullName,
        Email: email,
        'Mật khẩu trước khi hash': rawPassword,
        'Vai trò': item.role,
        'Trạng thái': status,
        'Thao tác': actionType,
      });
    }

    // 2. Seed dữ liệu thực tế cho các bảng chức năng (chỉ chạy khi không dùng flag --only-president)
    if (!cliArgs.onlyPresident) {
      const presidentId = memberIdMap.get(presidentEmail)!;
      const boardId = memberIdMap.get('board@example.com')!;
      const treasurerId = memberIdMap.get('treasurer@example.com')!;
      const member1Id = memberIdMap.get('member@example.com')!;
      const member2Id = memberIdMap.get('member2@example.com')!;
      const member3Id = memberIdMap.get('member3@example.com')!;
      const member4Id = memberIdMap.get('member4@example.com')!;
      const member5Id = memberIdMap.get('member5@example.com')!;

      // 2.1 Quỹ câu lạc bộ (funds)
      const fundsReq = new sql.Request(transaction);
      await fundsReq.query(`
        IF EXISTS (SELECT 1 FROM funds WHERE fund_type = 'MAIN')
          UPDATE funds SET balance = 15000000, updated_at = SYSUTCDATETIME() WHERE fund_type = 'MAIN';
        ELSE
          INSERT INTO funds (id, fund_type, balance, created_at, updated_at)
          VALUES ('${randomUUID()}', 'MAIN', 15000000, SYSUTCDATETIME(), SYSUTCDATETIME());

        IF EXISTS (SELECT 1 FROM funds WHERE fund_type = 'RESERVE')
          UPDATE funds SET balance = 10000000, updated_at = SYSUTCDATETIME() WHERE fund_type = 'RESERVE';
        ELSE
          INSERT INTO funds (id, fund_type, balance, created_at, updated_at)
          VALUES ('${randomUUID()}', 'RESERVE', 10000000, SYSUTCDATETIME(), SYSUTCDATETIME());
      `);

      // 2.2 Lịch sử đóng góp quỹ (contributions)
      const checkContribReq = new sql.Request(transaction);
      const contribCount = await checkContribReq.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM contributions`,
      );
      if (Number(contribCount.recordset[0].count) === 0) {
        const insertContribReq = new sql.Request(transaction);
        await insertContribReq.query(`
          INSERT INTO contributions (id, donor_member_id, amount, main_allocated, reserve_allocated, created_at)
          VALUES
            ('${randomUUID()}', '${presidentId}', 10000000, 7000000, 3000000, DATEADD(day, -25, SYSUTCDATETIME())),
            ('${randomUUID()}', '${boardId}', 8000000, 5000000, 3000000, DATEADD(day, -15, SYSUTCDATETIME())),
            ('${randomUUID()}', '${treasurerId}', 5000000, 3000000, 2000000, DATEADD(day, -5, SYSUTCDATETIME()));
        `);
      }

      // 2.3 Sự kiện CLB (events)
      const event1Id: string = randomUUID();
      const event2Id: string = randomUUID();
      const event3Id: string = randomUUID();

      const checkEventsReq = new sql.Request(transaction);
      const eventCount = await checkEventsReq.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM events`,
      );

      let activeEvent1: string = event1Id;
      let activeEvent2: string = event2Id;

      if (Number(eventCount.recordset[0].count) === 0) {
        const insertEventsReq = new sql.Request(transaction);
        insertEventsReq.input('ev1', sql.VarChar, event1Id);
        insertEventsReq.input('ev2', sql.VarChar, event2Id);
        insertEventsReq.input('ev3', sql.VarChar, event3Id);
        insertEventsReq.input('presId', sql.VarChar, presidentId);
        insertEventsReq.input('boardId', sql.VarChar, boardId);

        await insertEventsReq.query(`
          INSERT INTO events (id, created_by, name, start_at, end_at, location, max_participants, created_at, updated_at)
          VALUES
            (@ev1, @presId, N'Workshop Ứng Dụng Generative AI & Cloud Computing 2026', DATEADD(day, 3, SYSUTCDATETIME()), DATEADD(day, 3, DATEADD(hour, 4, SYSUTCDATETIME())), N'Hội trường A2 - Khu Công nghệ cao', 50, SYSUTCDATETIME(), SYSUTCDATETIME()),
            (@ev2, @boardId, N'Giải Thể Thao & Bóng Đá Mini Hội Viên CLB 2026', DATEADD(hour, -4, SYSUTCDATETIME()), DATEADD(day, 2, SYSUTCDATETIME()), N'Sân vận động Trung tâm Thanh thiếu niên', 30, SYSUTCDATETIME(), SYSUTCDATETIME()),
            (@ev3, @presId, N'Chuỗi Tập Huấn Kỹ Năng Lãnh Đạo & Quản Trị Dự Án CLB', DATEADD(day, -15, SYSUTCDATETIME()), DATEADD(day, -13, SYSUTCDATETIME()), N'Phòng Hội thảo B4 - Tòa nhà Điều hành', 40, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);

        // Đăng ký tham gia sự kiện (event_registrations)
        const insertRegReq = new sql.Request(transaction);
        await insertRegReq.query(`
          INSERT INTO event_registrations (event_id, member_id, status, registered_at)
          VALUES
            ('${event1Id}', '${member1Id}', 'ACTIVE', DATEADD(day, -2, SYSUTCDATETIME())),
            ('${event1Id}', '${member2Id}', 'ACTIVE', DATEADD(day, -2, SYSUTCDATETIME())),
            ('${event1Id}', '${member3Id}', 'ACTIVE', DATEADD(day, -1, SYSUTCDATETIME())),
            ('${event1Id}', '${boardId}', 'ACTIVE', DATEADD(day, -1, SYSUTCDATETIME())),
            ('${event2Id}', '${member1Id}', 'ACTIVE', DATEADD(day, -3, SYSUTCDATETIME())),
            ('${event2Id}', '${member2Id}', 'ACTIVE', DATEADD(day, -3, SYSUTCDATETIME())),
            ('${event2Id}', '${member3Id}', 'ACTIVE', DATEADD(day, -2, SYSUTCDATETIME())),
            ('${event2Id}', '${member4Id}', 'ACTIVE', DATEADD(day, -2, SYSUTCDATETIME())),
            ('${event2Id}', '${member5Id}', 'ACTIVE', DATEADD(day, -1, SYSUTCDATETIME())),
            ('${event2Id}', '${treasurerId}', 'ACTIVE', DATEADD(day, -1, SYSUTCDATETIME())),
            ('${event3Id}', '${member1Id}', 'ACTIVE', DATEADD(day, -18, SYSUTCDATETIME())),
            ('${event3Id}', '${member2Id}', 'ACTIVE', DATEADD(day, -18, SYSUTCDATETIME())),
            ('${event3Id}', '${member3Id}', 'ACTIVE', DATEADD(day, -17, SYSUTCDATETIME())),
            ('${event3Id}', '${boardId}', 'ACTIVE', DATEADD(day, -16, SYSUTCDATETIME()));
        `);
      } else {
        const getExistingEvents = await checkEventsReq.query<{ id: string }>(
          `SELECT TOP 2 id FROM events ORDER BY created_at DESC`,
        );
        if (getExistingEvents.recordset.length > 0) {
          activeEvent1 = getExistingEvents.recordset[0].id;
          activeEvent2 = getExistingEvents.recordset[1]?.id ?? activeEvent1;
        }
      }

      // 2.4 Đề xuất chi tiêu (spending_proposals) & Biểu quyết
      const checkPropReq = new sql.Request(transaction);
      const propCount = await checkPropReq.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM spending_proposals`,
      );

      if (Number(propCount.recordset[0].count) === 0) {
        const prop1Id = randomUUID(); // Đang biểu quyết
        const prop2Id = randomUUID(); // Đã duyệt & sinh payable
        const prop3Id = randomUUID(); // Chờ phê duyệt
        const prop4Id = randomUUID(); // Bị từ chối

        const round1Id = randomUUID();
        const round2Id = randomUUID();

        // Thêm 4 đề xuất
        const insertPropReq = new sql.Request(transaction);
        await insertPropReq.query(`
          INSERT INTO spending_proposals (id, creator_member_id, event_id, amount, purpose, note, status, reviewer_member_id, review_decision, review_reason, reviewed_at, created_at, updated_at)
          VALUES
            ('${prop1Id}', '${member1Id}', '${activeEvent1}', 6500000, N'Thuê thiết bị âm thanh, ánh sáng và màn hình LED phục vụ Workshop AI', N'Dự toán bao gồm nhân công lắp đặt và trực kỹ thuật xuyên suốt sự kiện', 'VOTING', NULL, NULL, NULL, NULL, DATEADD(day, -2, SYSUTCDATETIME()), SYSUTCDATETIME()),
            ('${prop2Id}', '${boardId}', '${activeEvent2}', 4000000, N'Mua áo thi đấu thể thao, cờ lưu niệm và nước uống cho Giải bóng đá mini', N'Đã liên hệ đơn vị in áo thể thao số lượng lớn chiết khấu 15%', 'APPROVED', '${presidentId}', 'APPROVED', N'Kế hoạch chi tiêu chi tiết, đúng mục đích hoạt động và phù hợp ngân quỹ.', DATEADD(day, -5, SYSUTCDATETIME()), DATEADD(day, -8, SYSUTCDATETIME()), SYSUTCDATETIME()),
            ('${prop3Id}', '${member2Id}', '${activeEvent1}', 1800000, N'In ấn standee, tài liệu hướng dẫn và hashtag cầm tay sự kiện', N'Thiết kế theo đúng bộ nhận diện thương hiệu của câu lạc bộ', 'PENDING_APPROVAL', NULL, NULL, NULL, NULL, DATEADD(hour, -6, SYSUTCDATETIME()), SYSUTCDATETIME()),
            ('${prop4Id}', '${member3Id}', NULL, 5500000, N'Chi phí đặt tiệc liên hoan cao cấp tại nhà hàng ngoài danh mục ngân sách', N'Tổ chức tiệc tối cho nhóm ban cán sự sau kỳ thi', 'REJECTED', '${boardId}', 'REJECTED', N'Vượt định mức sinh hoạt của CLB và không phù hợp với quy chế tài chính.', DATEADD(day, -10, SYSUTCDATETIME()), DATEADD(day, -12, SYSUTCDATETIME()), SYSUTCDATETIME());
        `);

        // Vòng biểu quyết cho Đề xuất 1 (đang mở) & Đề xuất 2 (đã pass)
        const insertRoundsReq = new sql.Request(transaction);
        await insertRoundsReq.query(`
          INSERT INTO proposal_vote_rounds (id, proposal_id, round_number, starts_at, deadline_at, closed_at, result)
          VALUES
            ('${round1Id}', '${prop1Id}', 1, DATEADD(day, -2, SYSUTCDATETIME()), DATEADD(day, 3, SYSUTCDATETIME()), NULL, NULL),
            ('${round2Id}', '${prop2Id}', 1, DATEADD(day, -8, SYSUTCDATETIME()), DATEADD(day, -5, SYSUTCDATETIME()), DATEADD(day, -5, SYSUTCDATETIME()), 'PASSED');
        `);

        // Phiếu biểu quyết cho Round 1 (Đề xuất 1: 4 Đồng ý, 1 Không đồng ý, 1 Phiếu trắng)
        const insertVotesReq = new sql.Request(transaction);
        await insertVotesReq.query(`
          INSERT INTO proposal_votes (round_id, member_id, choice, cast_at)
          VALUES
            ('${round1Id}', '${presidentId}', 'YES', DATEADD(hour, -30, SYSUTCDATETIME())),
            ('${round1Id}', '${boardId}', 'YES', DATEADD(hour, -25, SYSUTCDATETIME())),
            ('${round1Id}', '${member1Id}', 'YES', DATEADD(hour, -20, SYSUTCDATETIME())),
            ('${round1Id}', '${member2Id}', 'YES', DATEADD(hour, -18, SYSUTCDATETIME())),
            ('${round1Id}', '${treasurerId}', 'NO', DATEADD(hour, -15, SYSUTCDATETIME())),
            ('${round1Id}', '${member3Id}', 'BLANK', DATEADD(hour, -10, SYSUTCDATETIME())),
            ('${round2Id}', '${presidentId}', 'YES', DATEADD(day, -7, SYSUTCDATETIME())),
            ('${round2Id}', '${boardId}', 'YES', DATEADD(day, -7, SYSUTCDATETIME())),
            ('${round2Id}', '${treasurerId}', 'YES', DATEADD(day, -6, SYSUTCDATETIME())),
            ('${round2Id}', '${member1Id}', 'YES', DATEADD(day, -6, SYSUTCDATETIME())),
            ('${round2Id}', '${member2Id}', 'YES', DATEADD(day, -6, SYSUTCDATETIME())),
            ('${round2Id}', '${member3Id}', 'YES', DATEADD(day, -6, SYSUTCDATETIME()));

          INSERT INTO proposal_non_voters (round_id, member_id)
          VALUES
            ('${round1Id}', '${member4Id}'),
            ('${round1Id}', '${member5Id}');
        `);

        // Khoản phải trả (payables) cho Đề xuất 2
        const payableId = randomUUID();
        const insertPayableReq = new sql.Request(transaction);
        await insertPayableReq.query(`
          INSERT INTO payables (id, proposal_id, approved_amount, amount_due, amount_paid, balance_due, status, created_at, updated_at)
          VALUES
            ('${payableId}', '${prop2Id}', 4000000, 4000000, 2500000, 1500000, 'OPEN', DATEADD(day, -5, SYSUTCDATETIME()), SYSUTCDATETIME());
        `);

        // Giao dịch sổ cái (fund_transactions)
        const insertTxReq = new sql.Request(transaction);
        await insertTxReq.query(`
          INSERT INTO fund_transactions (id, transaction_type, payable_id, reserve_withdrawal_id, created_by, idempotency_key, requested_amount, note, amount, status, completed_by, completed_at, overage_status, created_at)
          VALUES
            ('${randomUUID()}', 'PAYMENT', '${payableId}', NULL, '${treasurerId}', 'payment-prop2-part1', 2500000, N'Thanh toán đợt 1 tiền may áo thể thao và cờ giải đấu', 2500000, 'COMPLETED', '${treasurerId}', DATEADD(day, -4, SYSUTCDATETIME()), 'NOT_REQUIRED', DATEADD(day, -4, SYSUTCDATETIME())),
            ('${randomUUID()}', 'PAYMENT', '${payableId}', NULL, '${treasurerId}', 'payment-prop2-part2', 1500000, N'Thanh toán đợt 2 (phần còn lại) tiền nước uống và cúp lưu niệm', NULL, 'PENDING', NULL, NULL, 'NOT_REQUIRED', DATEADD(hour, -5, SYSUTCDATETIME()));
        `);
      }

      // 2.5 Rút quỹ dự phòng (reserve_withdrawal_requests)
      const checkReserveReq = new sql.Request(transaction);
      const reserveReqCount = await checkReserveReq.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM reserve_withdrawal_requests`,
      );
      if (Number(reserveReqCount.recordset[0].count) === 0) {
        const insertReserveReq = new sql.Request(transaction);
        await insertReserveReq.query(`
          INSERT INTO reserve_withdrawal_requests (id, requested_by, idempotency_key, amount, reason, status, decided_by, decision_reason, decided_at, executed_by, executed_at, created_at, updated_at)
          VALUES
            ('${randomUUID()}', '${boardId}', 'reserve-req-emergency-medical-01', 2000000, N'Chi viện trợ cấp y tế và bảo hiểm tai nạn khẩn cấp cho thành viên trong buổi tập huấn', 'COMPLETED', '${presidentId}', N'Đã xác minh đầy đủ hóa đơn viện phí và báo cáo tai nạn từ bệnh viện.', DATEADD(day, -4, SYSUTCDATETIME()), '${treasurerId}', DATEADD(day, -3, SYSUTCDATETIME()), DATEADD(day, -5, SYSUTCDATETIME()), SYSUTCDATETIME()),
            ('${randomUUID()}', '${treasurerId}', 'reserve-req-projector-fix-02', 1200000, N'Kinh phí dự phòng khắc phục sự cố kỹ thuật hỏng bộ chia nguồn và micro không dây trước giờ khai mạc', 'PENDING', NULL, NULL, NULL, NULL, NULL, DATEADD(hour, -8, SYSUTCDATETIME()), SYSUTCDATETIME());
        `);
      }

      // 2.6 Thông báo hệ thống (notifications)
      const checkNotifReq = new sql.Request(transaction);
      const notifCount = await checkNotifReq.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM notifications`,
      );
      if (Number(notifCount.recordset[0].count) === 0) {
        const insertNotifReq = new sql.Request(transaction);
        await insertNotifReq.query(`
          INSERT INTO notifications (id, recipient_id, type, title, body, ref_id, ref_type, is_read, created_at)
          VALUES
            ('${randomUUID()}', '${presidentId}', 'NEW_MEMBER_APPLICATION', N'Đơn đăng ký gia nhập CLB mới', N'Ứng viên Bùi Phương Linh vừa gửi hồ sơ xin gia nhập câu lạc bộ. Vui lòng vào duyệt đơn.', NULL, 'MEMBERSHIP', 0, DATEADD(hour, -3, SYSUTCDATETIME())),
            ('${randomUUID()}', '${presidentId}', 'PROPOSAL_CREATED', N'Đề xuất chi tiêu mới đang mở biểu quyết', N'Đề xuất "Thuê thiết bị âm thanh, ánh sáng phục vụ Workshop AI" đang mở biểu quyết cho toàn thể cử tri.', NULL, 'PROPOSAL', 0, DATEADD(hour, -12, SYSUTCDATETIME())),
            ('${randomUUID()}', '${boardId}', 'PROPOSAL_DECIDED', N'Đề xuất chi tiêu đã được phê duyệt', N'Chủ tịch CLB đã phê duyệt đề xuất "Mua áo thi đấu thể thao cho Giải bóng đá mini".', NULL, 'PROPOSAL', 1, DATEADD(day, -5, SYSUTCDATETIME())),
            ('${randomUUID()}', '${member1Id}', 'NEW_EVENT', N'Sự kiện mới: Workshop AI & Cloud Computing 2026', N'Sự kiện Workshop AI & Cloud Computing đã được công bố. Bạn có thể đăng ký tham gia ngay từ bây giờ.', NULL, 'EVENT', 0, DATEADD(day, -2, SYSUTCDATETIME())),
            ('${randomUUID()}', '${treasurerId}', 'FUND_SUFFICIENT_FOR_DEBT', N'Số dư quỹ hoạt động đảm bảo thanh toán', N'Ngân quỹ hiện tại có đủ số dư khả dụng để giải ngân cho các khoản phải trả đang mở.', NULL, 'FUND', 0, DATEADD(hour, -6, SYSUTCDATETIME()));
        `);
      }
    }

    await transaction.commit();

    console.log('\nDANH SÁCH TÀI KHOẢN ĐÃ SEED THÀNH CÔNG:');
    console.table(resultTable);
    console.log(
      'Tất cả mật khẩu trên đều được hash bằng bcrypt (12 rounds) khi lưu vào database.',
    );
    console.log('='.repeat(75));
    console.log('ĐÃ KHỞI TẠO ĐẦY ĐỦ DỮ LIỆU SEED MẪU:');
    console.log('- Bảng thành viên: 11 thành viên (Chủ tịch, BCN, Thủ quỹ, Thành viên, Chờ duyệt, Từ chối, Admin)');
    console.log('- Bảng quỹ & đóng góp: Quỹ hoạt động chung (15.000.000 VNĐ), Quỹ dự phòng (10.000.000 VNĐ) & 3 lượt đóng góp');
    console.log('- Bảng sự kiện & đăng ký: 3 sự kiện (Sắp diễn ra, Đang diễn ra, Đã kết thúc) kèm danh sách đăng ký tham gia');
    console.log('- Bảng đề xuất chi tiêu: 4 đề xuất (Đang biểu quyết, Đã duyệt, Chờ duyệt, Bị từ chối)');
    console.log('- Bảng biểu quyết: 2 vòng biểu quyết, 12 phiếu bầu (Đồng ý, Không đồng ý, Phiếu trắng, Cử tri chưa bầu)');
    console.log('- Bảng khoản phải trả & sổ cái: 1 khoản nợ đang mở, 1 giao dịch hoàn thành, 1 giao dịch chờ xử lý');
    console.log('- Bảng rút quỹ dự phòng: 1 yêu cầu đã duyệt giải ngân, 1 yêu cầu chờ phê duyệt');
    console.log('- Bảng thông báo: 5 thông báo mẫu với đa dạng chủ đề');
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
