import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsModule:
 * - Cung cấp NotificationsService (ghi DB thực, có thể inject vào bất kỳ module nào).
 * - Import AuthModule qua forwardRef() để tránh circular dependency
 *   (AuthModule cũng import NotificationsModule qua forwardRef).
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
