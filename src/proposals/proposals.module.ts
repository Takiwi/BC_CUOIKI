import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BallotsController, ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ProposalsController, BallotsController],
  providers: [ProposalsService],
})
export class ProposalsModule {}
