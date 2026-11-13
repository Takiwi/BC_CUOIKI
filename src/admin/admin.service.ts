import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AdminEntityConfig {
  tableName: string;
  label: string;
  description: string;
  primaryKey: string;
  defaultSort: string;
  allowedSortColumns: string[];
  searchColumns: string[];
  editableColumns: string[];
  sensitiveColumns?: string[];
}

export const ADMIN_ENTITIES: Record<string, AdminEntityConfig> = {
  members: {
    tableName: 'members',
    label: 'Thành viên & Tài khoản',
    description: 'Danh sách tài khoản, vai trò và trạng thái thành viên',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'updated_at',
      'email',
      'full_name',
      'role',
      'status',
      'is_active',
    ],
    searchColumns: ['email', 'full_name'],
    editableColumns: [
      'full_name',
      'gender',
      'date_of_birth',
      'role',
      'status',
      'is_active',
    ],
    sensitiveColumns: ['password_hash'],
  },
  events: {
    tableName: 'events',
    label: 'Sự kiện CLB',
    description: 'Danh sách sự kiện, thời gian tổ chức và địa điểm',
    primaryKey: 'id',
    defaultSort: 'start_at DESC',
    allowedSortColumns: [
      'start_at',
      'end_at',
      'name',
      'created_at',
      'updated_at',
    ],
    searchColumns: ['name', 'location'],
    editableColumns: [
      'name',
      'location',
      'max_participants',
      'start_at',
      'end_at',
    ],
  },
  event_registrations: {
    tableName: 'event_registrations',
    label: 'Đăng ký sự kiện',
    description: 'Lượt thành viên đăng ký tham gia các sự kiện',
    primaryKey: 'event_id',
    defaultSort: 'registered_at DESC',
    allowedSortColumns: ['registered_at', 'cancelled_at', 'status'],
    searchColumns: ['status'],
    editableColumns: ['status'],
  },
  funds: {
    tableName: 'funds',
    label: 'Số dư các Quỹ',
    description: 'Số dư Quỹ chính và Quỹ dự phòng của CLB',
    primaryKey: 'id',
    defaultSort: 'fund_type ASC',
    allowedSortColumns: ['fund_type', 'balance', 'updated_at'],
    searchColumns: ['fund_type'],
    editableColumns: ['balance'],
  },
  contributions: {
    tableName: 'contributions',
    label: 'Khoản đóng góp',
    description: 'Lịch sử đóng góp quỹ của thành viên và phân bổ',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'amount',
      'main_allocated',
      'reserve_allocated',
    ],
    searchColumns: ['note'],
    editableColumns: ['note'],
  },
  spending_proposals: {
    tableName: 'spending_proposals',
    label: 'Đề xuất chi quỹ',
    description: 'Các đề xuất chi tiêu, xét duyệt và kết quả',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'updated_at',
      'amount',
      'status',
      'title',
    ],
    searchColumns: ['title', 'purpose', 'status'],
    editableColumns: [
      'title',
      'amount',
      'purpose',
      'status',
      'review_decision',
      'review_notes',
    ],
  },
  proposal_vote_rounds: {
    tableName: 'proposal_vote_rounds',
    label: 'Vòng bỏ phiếu',
    description: 'Các vòng bỏ phiếu biểu quyết chi tiêu',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'round_number',
      'starts_at',
      'deadline_at',
      'result',
    ],
    searchColumns: ['result'],
    editableColumns: ['deadline_at', 'result'],
  },
  proposal_votes: {
    tableName: 'proposal_votes',
    label: 'Phiếu biểu quyết',
    description: 'Từng lá phiếu biểu quyết của thành viên',
    primaryKey: 'id',
    defaultSort: 'voted_at DESC',
    allowedSortColumns: ['voted_at', 'choice'],
    searchColumns: ['choice'],
    editableColumns: ['choice'],
  },
  payables: {
    tableName: 'payables',
    label: 'Khoản phải trả',
    description: 'Nghĩa vụ chi tiền theo đề xuất đã duyệt',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'amount_due',
      'amount_paid',
      'balance_due',
      'status',
    ],
    searchColumns: ['status'],
    editableColumns: ['status', 'amount_paid', 'balance_due'],
  },
  reserve_withdrawal_requests: {
    tableName: 'reserve_withdrawal_requests',
    label: 'Rút quỹ dự phòng',
    description: 'Các yêu cầu rút vốn từ quỹ dự phòng',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: ['created_at', 'amount', 'status'],
    searchColumns: ['reason', 'status', 'decision_reason'],
    editableColumns: ['status', 'decision_reason'],
  },
  fund_transactions: {
    tableName: 'fund_transactions',
    label: 'Giao dịch ngân quỹ',
    description: 'Nhật ký thực hiện chi tiền và giải ngân',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: [
      'created_at',
      'transaction_type',
      'status',
      'requested_amount',
      'amount',
    ],
    searchColumns: ['idempotency_key', 'rejection_reason', 'status'],
    editableColumns: ['status', 'rejection_reason'],
  },
  notifications: {
    tableName: 'notifications',
    label: 'Thông báo hệ thống',
    description: 'Toàn bộ thông báo đã gửi cho thành viên',
    primaryKey: 'id',
    defaultSort: 'created_at DESC',
    allowedSortColumns: ['created_at', 'type', 'is_read'],
    searchColumns: ['title', 'body', 'type'],
    editableColumns: ['is_read'],
  },
};

@Injectable()
export class AdminService {
  constructor(private readonly database: DatabaseService) {}

  getEntityConfigList() {
    return Object.entries(ADMIN_ENTITIES).map(([key, config]) => ({
      key,
      label: config.label,
      description: config.description,
      tableName: config.tableName,
      primaryKey: config.primaryKey,
      editableColumns: config.editableColumns,
      allowedSortColumns: config.allowedSortColumns,
    }));
  }

  async getOverviewStats() {
    const [
      membersCount,
      eventsCount,
      registrationsCount,
      fundsData,
      contributionsCount,
      proposalsCount,
      voteRoundsCount,
      votesCount,
      payablesCount,
      withdrawalsCount,
      transactionsCount,
      notificationsCount,
    ] = await Promise.all([
      this.database.query<{
        total: number;
        active: number;
        pending: number;
        approved: number;
        rejected: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
        FROM members
      `),
      this.database.query<{ total: number; active: number }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN end_at > SYSUTCDATETIME() THEN 1 ELSE 0 END) AS active
        FROM events
      `),
      this.database.query<{ total: number; active: number }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
        FROM event_registrations
      `),
      this.database.query<{
        fund_type: string;
        balance: number;
      }>(`SELECT fund_type, balance FROM funds`),
      this.database.query<{ total: number; totalAmount: number }>(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(amount), 0) AS "totalAmount"
        FROM contributions
      `),
      this.database.query<{
        total: number;
        pending: number;
        approved: number;
        rejected: number;
        voting: number;
        executed: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'VOTING' THEN 1 ELSE 0 END) AS voting,
          SUM(CASE WHEN status = 'EXECUTED' THEN 1 ELSE 0 END) AS executed
        FROM spending_proposals
      `),
      this.database.query<{ total: number }>(`
        SELECT COUNT(*) AS total FROM proposal_vote_rounds
      `),
      this.database.query<{ total: number }>(`
        SELECT COUNT(*) AS total FROM proposal_votes
      `),
      this.database.query<{
        total: number;
        open: number;
        paid: number;
        totalDue: number;
        totalPaid: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS [open],
          SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid,
          COALESCE(SUM(amount_due), 0) AS "totalDue",
          COALESCE(SUM(amount_paid), 0) AS "totalPaid"
        FROM payables
      `),
      this.database.query<{
        total: number;
        pending: number;
        approved: number;
        completed: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed
        FROM reserve_withdrawal_requests
      `),
      this.database.query<{
        total: number;
        completed: number;
        pending: number;
        totalVolume: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
          COALESCE(SUM(amount), 0) AS "totalVolume"
        FROM fund_transactions
      `),
      this.database.query<{ total: number; unread: number }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
        FROM notifications
      `),
    ]);

    const fundsMap = {
      main: Number(
        fundsData.rows.find((f) => f.fund_type === 'MAIN')?.balance ?? 0,
      ),
      reserve: Number(
        fundsData.rows.find((f) => f.fund_type === 'RESERVE')?.balance ?? 0,
      ),
    };

    return {
      members: membersCount.rows[0] ?? {
        total: 0,
        active: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      },
      events: eventsCount.rows[0] ?? { total: 0, active: 0 },
      eventRegistrations: registrationsCount.rows[0] ?? { total: 0, active: 0 },
      funds: {
        ...fundsMap,
        total: fundsMap.main + fundsMap.reserve,
      },
      contributions: contributionsCount.rows[0] ?? {
        total: 0,
        totalAmount: 0,
      },
      proposals: proposalsCount.rows[0] ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        voting: 0,
        executed: 0,
      },
      voteRounds: voteRoundsCount.rows[0] ?? { total: 0 },
      votes: votesCount.rows[0] ?? { total: 0 },
      payables: payablesCount.rows[0] ?? {
        total: 0,
        open: 0,
        paid: 0,
        totalDue: 0,
        totalPaid: 0,
      },
      reserveWithdrawals: withdrawalsCount.rows[0] ?? {
        total: 0,
        pending: 0,
        approved: 0,
        completed: 0,
      },
      transactions: transactionsCount.rows[0] ?? {
        total: 0,
        completed: 0,
        pending: 0,
        totalVolume: 0,
      },
      notifications: notificationsCount.rows[0] ?? { total: 0, unread: 0 },
    };
  }

  async getEntityData(
    entityKey: string,
    options: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: 'ASC' | 'DESC';
      search?: string;
    } = {},
  ) {
    const config = ADMIN_ENTITIES[entityKey];
    if (!config) {
      throw new NotFoundException(`Entity '${entityKey}' does not exist.`);
    }

    const page = Math.max(1, Number(options.page || 1));
    const limit = Math.min(100, Math.max(1, Number(options.limit || 20)));
    const offset = (page - 1) * limit;

    let sortCol = options.sort?.trim();
    if (!sortCol || !config.allowedSortColumns.includes(sortCol)) {
      sortCol = config.defaultSort.split(' ')[0];
    }
    const orderDirection =
      options.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (options.search?.trim() && config.searchColumns.length > 0) {
      const searchParamIdx = params.length + 1;
      params.push(`%${options.search.trim()}%`);
      const searchExpr = config.searchColumns
        .map(
          (col) =>
            `LOWER(CAST(${col} AS NVARCHAR(MAX))) LIKE LOWER($${searchParamIdx})`,
        )
        .join(' OR ');
      whereClauses.push(`(${searchExpr})`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total rows
    const countSql = `SELECT COUNT(*) AS total FROM [${config.tableName}] ${whereSql}`;
    const countResult = await this.database.query<{ total: number }>(
      countSql,
      params,
    );
    const total = Number(countResult.rows[0]?.total || 0);

    // Fetch paginated data
    const offsetParamIdx = params.length + 1;
    const limitParamIdx = params.length + 2;
    params.push(offset, limit);

    const querySql = `
      SELECT *
      FROM [${config.tableName}]
      ${whereSql}
      ORDER BY [${sortCol}] ${orderDirection}
      OFFSET $${offsetParamIdx} ROWS FETCH NEXT $${limitParamIdx} ROWS ONLY
    `;

    const dataResult = await this.database.query<Record<string, unknown>>(
      querySql,
      params,
    );

    // Strip sensitive columns (e.g. password_hash)
    const sanitizedRows = dataResult.rows.map((row) => {
      const copy = { ...row };
      if (config.sensitiveColumns) {
        for (const col of config.sensitiveColumns) {
          if (col in copy) {
            copy[col] = '********';
          }
        }
      }
      return copy;
    });

    return {
      entity: entityKey,
      label: config.label,
      description: config.description,
      primaryKey: config.primaryKey,
      editableColumns: config.editableColumns,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: sanitizedRows,
    };
  }

  private buildIdCondition(
    entityKey: string,
    id: string,
  ): { whereSql: string; params: unknown[] } {
    const config = ADMIN_ENTITIES[entityKey];
    if (entityKey === 'event_registrations' && id.includes(':')) {
      const [eventId, memberId] = id.split(':');
      return {
        whereSql: '[event_id] = $1 AND [member_id] = $2',
        params: [eventId, memberId],
      };
    }
    if (entityKey === 'proposal_votes' && id.includes(':')) {
      const [roundId, memberId] = id.split(':');
      return {
        whereSql: '[round_id] = $1 AND [member_id] = $2',
        params: [roundId, memberId],
      };
    }
    return {
      whereSql: `[${config.primaryKey}] = $1`,
      params: [id],
    };
  }

  async getEntityRecord(entityKey: string, id: string) {
    const config = ADMIN_ENTITIES[entityKey];
    if (!config) {
      throw new NotFoundException(`Entity '${entityKey}' does not exist.`);
    }

    const idCond = this.buildIdCondition(entityKey, id);
    const query = `SELECT * FROM [${config.tableName}] WHERE ${idCond.whereSql}`;
    const result = await this.database.query<Record<string, unknown>>(
      query,
      idCond.params,
    );

    if (!result.rows[0]) {
      throw new NotFoundException(`Record not found in ${config.label}.`);
    }

    const row = { ...result.rows[0] };
    if (config.sensitiveColumns) {
      for (const col of config.sensitiveColumns) {
        if (col in row) {
          row[col] = '********';
        }
      }
    }

    return {
      entity: entityKey,
      config,
      data: row,
    };
  }

  async updateEntityRecord(
    entityKey: string,
    id: string,
    updates: Record<string, unknown>,
  ) {
    const config = ADMIN_ENTITIES[entityKey];
    if (!config) {
      throw new NotFoundException(`Entity '${entityKey}' does not exist.`);
    }

    const keysToUpdate = Object.keys(updates).filter((k) =>
      config.editableColumns.includes(k),
    );

    if (keysToUpdate.length === 0) {
      throw new BadRequestException(
        `Không có trường nào hợp lệ để cập nhật. Các trường cho phép: ${config.editableColumns.join(', ')}`,
      );
    }

    const idCond = this.buildIdCondition(entityKey, id);
    const setClauses: string[] = [];
    const params: unknown[] = [...idCond.params];
    const offset = idCond.params.length;

    keysToUpdate.forEach((key, index) => {
      params.push(updates[key]);
      setClauses.push(`[${key}] = $${offset + index + 1}`);
    });

    // Check if table has updated_at column
    if (config.allowedSortColumns.includes('updated_at')) {
      setClauses.push(`updated_at = SYSUTCDATETIME()`);
    }

    const updateSql = `
      UPDATE [${config.tableName}]
      SET ${setClauses.join(', ')}
      WHERE ${idCond.whereSql}
    `;

    await this.database.query(updateSql, params);

    return this.getEntityRecord(entityKey, id);
  }

  async deleteEntityRecord(entityKey: string, id: string) {
    const config = ADMIN_ENTITIES[entityKey];
    if (!config) {
      throw new NotFoundException(`Entity '${entityKey}' does not exist.`);
    }

    if (entityKey === 'funds') {
      throw new BadRequestException('Không thể xóa các bản ghi Quỹ hệ thống.');
    }

    try {
      const idCond = this.buildIdCondition(entityKey, id);
      const deleteSql = `DELETE FROM [${config.tableName}] WHERE ${idCond.whereSql}`;
      await this.database.query(deleteSql, idCond.params);
      return {
        success: true,
        message: `Đã xóa bản ghi ${id} khỏi ${config.label}`,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      throw new BadRequestException(
        `Không thể xóa bản ghi do ràng buộc dữ liệu liên quan: ${err.message || 'Lỗi cơ sở dữ liệu'}`,
      );
    }
  }
}
