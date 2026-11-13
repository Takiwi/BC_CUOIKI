import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FundsController } from './funds.controller';
import { FundsService } from './funds.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [FundsController],
  providers: [FundsService, OptionalJwtAuthGuard],
})
export class FundsModule {}
