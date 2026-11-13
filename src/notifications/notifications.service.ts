import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService, QueryResultRow } from '../database/database.service';

export type NotificationType =
  | 'NEW_MEMBER_APPLICATION'
  | 'NEW_EVENT'
  | 'PROPOSAL_CREATED'
  | 'PROPOSAL_DECIDED'
  | 'TIE_BOARD_REQUIRED'
  | 'FUND_SUFFICIENT_FOR_DEBT';

export interface NotificationRow extends QueryResultRow {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  refId: string | null;
  refType: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Public helper: tạo thông báo cho một người nhận ───────────────────────

  async createForRecipient(
    recipientId: string,
    type: NotificationType,
    title: string,
    body: string,
    refId?: string,
    refType?: 'member_application' | 'event' | 'proposal' | 'debt',
  ): Promise<void> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO notifications (id, recipient_id, type, title, body, ref_id, ref_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, recipientId, type, title, body, refId ?? null, refType ?? null],
    );
  }

  // ─── Thông báo cho Chủ tịch: đơn đăng ký mới (BR-024) ─────────────────────

  async notifyPresidentNewApplication(
    applicantName: string,
    applicantEmail: string,
    applicationId: string,
  ): Promise<void> {
    try {
      // Tìm Chủ tịch CLB (is_active = 1)
      const res = await this.db.query<{ id: string }>(
        `SELECT TOP (1) id FROM members WHERE role = 'PRESIDENT' AND is_active = 1`,
        [],
      );
      if (!res.rows.length) {
        this.logger.warn(
          '[Notifications] Không tìm thấy Chủ tịch để gửi thông báo đơn đăng ký.',
        );
        return;
      }
      const presidentId = res.rows[0].id;
      await this.createForRecipient(
        presidentId,
        'NEW_MEMBER_APPLICATION',
        'Đơn đăng ký thành viên mới',
        `"${applicantName}" (${applicantEmail}) vừa gửi đơn đăng ký tham gia CLB.`,
        applicationId,
        'member_application',
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo đơn đăng ký:',
        err,
      );
    }
  }

  // ─── Thông báo cho tất cả thành viên: sự kiện mới (BR-024) ────────────────

  async notifyAllMembersNewEvent(
    eventId: string,
    eventName: string,
    createdByMemberId: string,
  ): Promise<void> {
    try {
      // Tất cả thành viên active APPROVED, trừ người tạo sự kiện
      const res = await this.db.query<{ id: string }>(
        `SELECT m.id
         FROM members m
         WHERE m.is_active = 1
           AND m.status = 'APPROVED'
           AND m.id != $1`,
        [createdByMemberId],
      );
      const title = 'Sự kiện mới';
      const body = `CLB vừa tạo sự kiện mới: "${eventName}". Hãy đăng ký tham gia!`;
      for (const row of res.rows) {
        await this.createForRecipient(
          row.id,
          'NEW_EVENT',
          title,
          body,
          eventId,
          'event',
        );
      }
      this.logger.log(
        `[Notifications] Đã gửi thông báo sự kiện "${eventName}" cho ${res.rows.length} thành viên.`,
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo sự kiện mới:',
        err,
      );
    }
  }

  // ─── Thông báo khi proposal được tạo ──────────────────────────────────────

  async notifyProposalCreated(
    proposalId: string,
    purpose: string,
    creatorMemberId: string,
    eventId: string | null,
  ): Promise<void> {
    try {
      let recipientIds: string[];

      if (eventId) {
        // Proposal gắn sự kiện: chỉ thành viên đăng ký sự kiện đủ điều kiện (active, approved), trừ người tạo
        const res = await this.db.query<{ memberId: string }>(
          `SELECT er.member_id AS "memberId"
           FROM event_registrations er
           JOIN members m ON m.id = er.member_id
           WHERE er.event_id = $1
             AND er.status = 'ACTIVE'
             AND m.is_active = 1
             AND m.status = 'APPROVED'
             AND m.id != $2`,
          [eventId, creatorMemberId],
        );
        recipientIds = res.rows.map((r) => r.memberId);
      } else {
        // Proposal chung: tất cả thành viên active approved, trừ người tạo
        const res = await this.db.query<{ id: string }>(
          `SELECT m.id
           FROM members m
           WHERE m.is_active = 1
             AND m.status = 'APPROVED'
             AND m.id != $1`,
          [creatorMemberId],
        );
        recipientIds = res.rows.map((r) => r.id);
      }

      const title = 'Đề xuất chi mới';
      const body = `Có đề xuất chi mới: "${purpose}". Hãy tham gia biểu quyết!`;
      for (const recipientId of recipientIds) {
        await this.createForRecipient(
          recipientId,
          'PROPOSAL_CREATED',
          title,
          body,
          proposalId,
          'proposal',
        );
      }
      this.logger.log(
        `[Notifications] Đã gửi thông báo proposal "${purpose}" cho ${recipientIds.length} người nhận.`,
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo proposal mới:',
        err,
      );
    }
  }

  // ─── Thông báo khi proposal được duyệt/từ chối ─────────────────────────────

  async notifyProposalDecided(
    proposalId: string,
    purpose: string,
    creatorMemberId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string | null,
  ): Promise<void> {
    try {
      const decisionLabel =
        decision === 'APPROVED' ? 'được duyệt' : 'bị từ chối';
      const reasonPart = reason ? ` Lý do: ${reason}` : '';
      await this.createForRecipient(
        creatorMemberId,
        'PROPOSAL_DECIDED',
        `Đề xuất ${decisionLabel}`,
        `Đề xuất chi "${purpose}" của bạn đã ${decisionLabel}.${reasonPart}`,
        proposalId,
        'proposal',
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo quyết định proposal:',
        err,
      );
    }
  }

  // ─── Thông báo khi hòa vòng 2 → Ban chủ nhiệm (BR-004) ───────────────────

  async notifyBoardTieDecisionRequired(
    proposalId: string,
    purpose: string,
  ): Promise<void> {
    try {
      const res = await this.db.query<{ id: string }>(
        `SELECT id FROM members WHERE role = 'BOARD' AND is_active = 1`,
        [],
      );
      const title = 'Biểu quyết hòa – Cần quyết định';
      const body = `Đề xuất chi "${purpose}" hòa sau 2 vòng biểu quyết. Ban chủ nhiệm cần đưa ra quyết định cuối.`;
      for (const row of res.rows) {
        await this.createForRecipient(
          row.id,
          'TIE_BOARD_REQUIRED',
          title,
          body,
          proposalId,
          'proposal',
        );
      }
      this.logger.log(
        `[Notifications] Đã gửi thông báo hòa vòng 2 cho ${res.rows.length} thành viên Ban chủ nhiệm.`,
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo hòa vòng 2:',
        err,
      );
    }
  }

  // ─── Thông báo khi số dư quỹ đủ để thanh toán công nợ (Spec 8.5 & BR-013) ─

  async notifyFundSufficientForDebts(
    currentBalance: string,
    totalDebt: string,
  ): Promise<void> {
    try {
      const res = await this.db.query<{ id: string }>(
        `SELECT id FROM members WHERE role IN ('PRESIDENT', 'TREASURER') AND is_active = 1`,
        [],
      );
      const title = 'Số dư quỹ đủ để thanh toán công nợ';
      const body = `Quỹ chính hiện có ${currentBalance} VND, đã đủ để thanh toán toàn bộ công nợ thành viên còn lại (${totalDebt} VND).`;
      for (const row of res.rows) {
        await this.createForRecipient(
          row.id,
          'FUND_SUFFICIENT_FOR_DEBT',
          title,
          body,
          undefined,
          'debt',
        );
      }
      this.logger.log(
        `[Notifications] Đã gửi thông báo quỹ đủ trả nợ tới ${res.rows.length} cán bộ quản lý (Chủ tịch, Thủ quỹ).`,
      );
    } catch (err) {
      this.logger.error(
        '[Notifications] Lỗi khi gửi thông báo quỹ đủ trả nợ:',
        err,
      );
    }
  }

  // ─── GET thông báo của người dùng hiện tại ─────────────────────────────────

  async getMyNotifications(
    user: AuthenticatedUser,
    onlyUnread = false,
  ): Promise<NotificationRow[]> {
    const sql = `
      SELECT TOP (100)
        id,
        recipient_id AS "recipientId",
        type,
        title,
        body,
        ref_id AS "refId",
        ref_type AS "refType",
        is_read AS "isRead",
        read_at AS "readAt",
        created_at AS "createdAt"
      FROM notifications
      WHERE recipient_id = $1
        ${onlyUnread ? 'AND is_read = 0' : ''}
      ORDER BY created_at DESC
    `;
    const res = await this.db.query<NotificationRow>(sql, [user.id]);
    return res.rows;
  }

  // ─── PATCH: đánh dấu đã đọc ────────────────────────────────────────────────

  async markAsRead(
    notificationId: string,
    user: AuthenticatedUser,
  ): Promise<NotificationRow> {
    // Lấy notification và kiểm tra quyền sở hữu
    const res = await this.db.query<NotificationRow>(
      `SELECT id, recipient_id AS "recipientId", type, title, body,
              ref_id AS "refId", ref_type AS "refType",
              is_read AS "isRead", read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
       WHERE id = $1`,
      [notificationId],
    );
    if (!res.rows.length) {
      throw new NotFoundException('Không tìm thấy thông báo.');
    }
    const notification = res.rows[0];
    if (notification.recipientId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập thông báo này.',
      );
    }
    if (notification.isRead) {
      return notification; // Idempotent: đã đọc rồi thì trả về luôn
    }
    const updated = await this.db.query<NotificationRow>(
      `UPDATE notifications
       SET is_read = 1, read_at = SYSUTCDATETIME()
       OUTPUT
         inserted.id, inserted.recipient_id AS "recipientId", inserted.type, inserted.title, inserted.body,
         inserted.ref_id AS "refId", inserted.ref_type AS "refType",
         inserted.is_read AS "isRead", inserted.read_at AS "readAt", inserted.created_at AS "createdAt"
       WHERE id = $1`,
      [notificationId],
    );
    return updated.rows[0];
  }

  // ─── PATCH: đánh dấu tất cả đã đọc ────────────────────────────────────────

  async markAllAsRead(user: AuthenticatedUser): Promise<{ updated: number }> {
    const res = await this.db.query<{ id: string }>(
      `UPDATE notifications
       SET is_read = 1, read_at = SYSUTCDATETIME()
       OUTPUT inserted.id
       WHERE recipient_id = $1 AND is_read = 0`,
      [user.id],
    );
    return { updated: res.rowCount ?? 0 };
  }

  // ─── Count unread ────────────────────────────────────────────────────────────

  async countUnread(user: AuthenticatedUser): Promise<number> {
    const res = await this.db.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = $1 AND is_read = 0`,
      [user.id],
    );
    return parseInt(String(res.rows[0].count), 10);
  }
}
