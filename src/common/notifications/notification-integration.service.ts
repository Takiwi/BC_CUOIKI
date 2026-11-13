import { Injectable, Logger } from '@nestjs/common';

export interface ApplicationCreatedEvent {
  memberId: string;
  applicantName: string;
  email: string;
  createdAt: Date;
}

export interface EventCreatedNotification {
  eventId: string;
  eventName: string;
  startDate: Date;
  createdBy: string;
}

@Injectable()
export class NotificationIntegrationService {
  private readonly logger = new Logger(NotificationIntegrationService.name);
  readonly eventNotificationsIntegrated = false;

  /**
   * Integration point: Thông báo cho Chủ tịch CLB khi có đơn đăng ký thành viên mới (BR-024).
   * Được thiết kế làm điểm tích hợp chính thức để cắm bảng Notifications ở Phase 7 mà không làm gián đoạn luồng auth.
   */
  notifyPresidentNewApplication(event: ApplicationCreatedEvent): void {
    this.logger.log(
      `[Notification Integration Point] BR-024: Đơn đăng ký thành viên mới từ "${event.applicantName}" (${event.email}) đã được gửi tới Chủ tịch CLB (memberId: ${event.memberId}).`,
    );
  }

  notifyAllMembersNewEvent(event: EventCreatedNotification): void {
    this.logger.warn(
      `[Notification Integration Point] NOT_INTEGRATED: sự kiện "${event.eventName}" (${event.eventId}) cần thông báo tới toàn bộ thành viên; notification module chưa được triển khai.`,
    );
  }
}
