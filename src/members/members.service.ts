import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, QueryResultRow } from '../database/database.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { ApprovalDto } from './dto/approval.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface MemberSummary extends QueryResultRow {
  id: string;
  fullName: string;
  email: string;
  role: AuthenticatedUser['role'];
  gender: string | null;
  dateOfBirth: string | null;
  isActive: boolean;
  statusLabel: 'Hoạt động' | 'Không hoạt động';
  applicationStatus: string | null;
  createdAt: Date;
}

export interface MemberDetail extends MemberSummary {
  decisionReason: string | null;
  decidedAt: Date | null;
  updatedAt: Date;
}

export interface ApplicationRecord extends QueryResultRow {
  id: string;
  memberId: string;
  fullName: string;
  email: string;
  gender: string | null;
  dateOfBirth: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionReason: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ApplicationDecision extends QueryResultRow {
  id: string;
  memberId: string;
  status: ApprovalDto['decision'];
  reason: string | null;
  decidedAt: Date;
}

@Injectable()
export class MembersService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Danh sách thành viên dành cho President, Board, Treasurer (api-spec.md).
   * Luôn giữ và hiển thị rõ trạng thái "Không hoạt động" cho thành viên inactive (BR-025).
   */
  async findAll(): Promise<MemberSummary[]> {
    const result = await this.database.query<MemberSummary>(
      `SELECT m.id,
              m.full_name AS "fullName",
              m.email,
              m.role,
              m.gender,
              CONVERT(VARCHAR(10), m.date_of_birth, 23) AS "dateOfBirth",
              m.is_active AS "isActive",
              CASE WHEN m.is_active = 1 THEN N'Hoạt động' ELSE N'Không hoạt động' END AS "statusLabel",
              m.status AS "applicationStatus",
              m.created_at AS "createdAt"
       FROM members m
       ORDER BY m.created_at DESC`,
    );
    return result.rows;
  }

  /**
   * Danh sách đơn đăng ký thành viên dành cho President và Board.
   */
  async findApplications(): Promise<ApplicationRecord[]> {
    const result = await this.database.query<ApplicationRecord>(
      `SELECT m.id,
              m.id AS "memberId",
              m.full_name AS "fullName",
              m.email,
              m.gender,
              CONVERT(VARCHAR(10), m.date_of_birth, 23) AS "dateOfBirth",
              m.status,
              CAST(NULL AS NVARCHAR(MAX)) AS "decisionReason",
              CAST(NULL AS VARCHAR(36)) AS "decidedBy",
              CAST(NULL AS NVARCHAR(255)) AS "decidedByName",
              CAST(NULL AS DATETIMEOFFSET) AS "decidedAt",
              m.created_at AS "createdAt"
       FROM members m
       ORDER BY
         CASE WHEN m.status = 'PENDING' THEN 1 ELSE 2 END,
         m.created_at DESC`,
    );
    return result.rows;
  }

  /**
   * Xem hồ sơ chi tiết theo quy tắc quyền riêng tư:
   * - Member chỉ xem hồ sơ của chính mình.
   * - President, Board, Treasurer xem hồ sơ cần thiết.
   */
  async findById(
    targetId: string,
    currentUser: AuthenticatedUser,
  ): Promise<MemberDetail> {
    if (currentUser.role === 'MEMBER' && currentUser.id !== targetId) {
      throw new ForbiddenException(
        'Bạn chỉ có quyền xem thông tin hồ sơ của chính mình',
      );
    }

    const result = await this.database.query<MemberDetail>(
      `SELECT m.id,
              m.full_name AS "fullName",
              m.email,
              m.role,
              m.gender,
              CONVERT(VARCHAR(10), m.date_of_birth, 23) AS "dateOfBirth",
              m.is_active AS "isActive",
              CASE WHEN m.is_active = 1 THEN N'Hoạt động' ELSE N'Không hoạt động' END AS "statusLabel",
              m.status AS "applicationStatus",
              CAST(NULL AS NVARCHAR(MAX)) AS "decisionReason",
              CAST(NULL AS DATETIMEOFFSET) AS "decidedAt",
              m.created_at AS "createdAt",
              m.updated_at AS "updatedAt"
       FROM members m
       WHERE m.id = $1`,
      [targetId],
    );

    const member = result.rows[0];
    if (!member) {
      throw new NotFoundException('Không tìm thấy thông tin thành viên');
    }

    return member;
  }

  /**
   * Thành viên cập nhật thông tin hồ sơ của chính mình.
   */
  async updateProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<MemberDetail> {
    const existing = await this.database.query<{ id: string }>(
      'SELECT id FROM members WHERE id = $1',
      [userId],
    );
    if (!existing.rows[0]) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }

    const trimmedName = input.fullName ? input.fullName.trim() : null;

    const result = await this.database.query<MemberDetail>(
      `UPDATE members
       SET full_name = COALESCE($1, full_name),
           gender = COALESCE($2, gender),
           date_of_birth = COALESCE($3, date_of_birth),
           updated_at = SYSUTCDATETIME()
       OUTPUT inserted.id,
              inserted.full_name AS "fullName",
              inserted.email,
              inserted.role,
              inserted.gender,
              CONVERT(VARCHAR(10), inserted.date_of_birth, 23) AS "dateOfBirth",
              inserted.is_active AS "isActive",
              CASE WHEN inserted.is_active = 1 THEN N'Hoạt động' ELSE N'Không hoạt động' END AS "statusLabel",
              inserted.created_at AS "createdAt",
              inserted.updated_at AS "updatedAt"
       WHERE id = $4`,
      [trimmedName, input.gender ?? null, input.dateOfBirth ?? null, userId],
    );

    return result.rows[0];
  }

  /**
   * Duyệt hoặc từ chối đơn đăng ký thành viên. Duy nhất Chủ tịch có quyền (BR-019).
   */
  async decideApplication(
    memberId: string,
    decision: ApprovalDto['decision'],
    reason: string | undefined,
    president: AuthenticatedUser,
  ): Promise<ApplicationDecision> {
    return this.database.transaction<ApplicationDecision>(async (client) => {
      const member = await client.query<{ id: string; status: string }>(
        `SELECT id, status
         FROM members WITH (UPDLOCK, ROWLOCK)
         WHERE id = $1`,
        [memberId],
      );
      const current = member.rows[0];
      if (!current) {
        throw new NotFoundException('Không tìm thấy đơn đăng ký thành viên');
      }
      if (current.status !== 'PENDING') {
        throw new ConflictException('Đơn đăng ký này đã được xử lý trước đó');
      }

      await client.query(
        `UPDATE members
         SET status = $1, updated_at = SYSUTCDATETIME()
         WHERE id = $2`,
        [decision, memberId],
      );
      return {
        id: memberId,
        memberId,
        status: decision,
        reason: reason ?? null,
        decidedAt: new Date(),
      };
    });
  }

  /**
   * Cập nhật trạng thái hoạt động / Thành viên rời CLB (BR-022, BR-025):
   * - President có thể vô hiệu hóa/kích hoạt lại thành viên.
   * - Hoặc chính thành viên tự rời CLB (chuyển isActive = false).
   * - Khi isActive = false: thu hồi mọi refresh token lập tức, không xóa dữ liệu lịch sử.
   */
  async updateStatus(
    targetId: string,
    isActive: boolean,
    currentUser: AuthenticatedUser,
  ): Promise<{ id: string; isActive: boolean; statusLabel: string }> {
    const isSelfLeaving = currentUser.id === targetId && !isActive;
    const isPresident = currentUser.role === 'PRESIDENT';

    if (!isPresident && !isSelfLeaving) {
      throw new ForbiddenException(
        'Bạn không có quyền thay đổi trạng thái hoạt động của tài khoản này',
      );
    }

    return this.database.transaction(async (client) => {
      const memberRes = await client.query<{
        id: string;
        role: string;
        is_active: boolean;
      }>(
        'SELECT id, role, is_active FROM members WITH (UPDLOCK, ROWLOCK) WHERE id = $1',
        [targetId],
      );
      const member = memberRes.rows[0];
      if (!member) {
        throw new NotFoundException('Không tìm thấy thành viên');
      }

      if (Boolean(member.is_active) === isActive) {
        throw new ConflictException(
          `Tài khoản đã ở trạng thái ${isActive ? 'Hoạt động' : 'Không hoạt động'}`,
        );
      }

      if (member.role === 'PRESIDENT' && !isActive) {
        const countRes = await client.query<{ count: string | number }>(
          `SELECT COUNT(*) AS count
           FROM members
           WHERE role = 'PRESIDENT' AND is_active = 1 AND id != $1`,
          [targetId],
        );
        if (Number(countRes.rows[0].count) === 0) {
          throw new ConflictException(
            'Không thể vô hiệu hóa Chủ tịch duy nhất của CLB. Hãy chuyển giao vai trò trước.',
          );
        }
      }

      await client.query(
        'UPDATE members SET is_active = $1, updated_at = SYSUTCDATETIME() WHERE id = $2',
        [isActive ? 1 : 0, targetId],
      );

      if (!isActive) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = SYSUTCDATETIME()
           WHERE member_id = $1 AND revoked_at IS NULL`,
          [targetId],
        );
        await client.query(
          `DELETE v
           FROM proposal_votes v
           JOIN proposal_vote_rounds r ON r.id = v.round_id
           JOIN spending_proposals p ON p.id = r.proposal_id
           WHERE v.member_id = $1
             AND r.closed_at IS NULL
             AND p.status = 'VOTING'`,
          [targetId],
        );
      }

      return {
        id: targetId,
        isActive,
        statusLabel: isActive ? 'Hoạt động' : 'Không hoạt động',
      };
    });
  }
}
