import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications
   * Lấy danh sách thông báo của người dùng hiện tại.
   * Query param: ?unread=true để chỉ lấy thông báo chưa đọc.
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thông báo của người dùng hiện tại' })
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  async getMyNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unread') unread?: string,
  ) {
    const onlyUnread = unread === 'true' || unread === '1';
    const notifications = await this.notificationsService.getMyNotifications(
      user,
      onlyUnread,
    );
    const unreadCount = await this.notificationsService.countUnread(user);
    return {
      message: 'Lấy danh sách thông báo thành công.',
      data: notifications,
      meta: { unreadCount },
    };
  }

  /**
   * PATCH /notifications/:id/read
   * Đánh dấu một thông báo cụ thể đã đọc.
   */
  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu thông báo đã đọc' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const notification = await this.notificationsService.markAsRead(id, user);
    return {
      message: 'Thông báo đã được đánh dấu đã đọc.',
      data: notification,
    };
  }

  /**
   * PATCH /notifications/read-all
   * Đánh dấu tất cả thông báo của người dùng hiện tại đã đọc.
   */
  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.notificationsService.markAllAsRead(user);
    return {
      message: `Đã đánh dấu ${result.updated} thông báo đã đọc.`,
      data: result,
    };
  }
}
