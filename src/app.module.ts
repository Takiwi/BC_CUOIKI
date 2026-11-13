import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { MembersModule } from './members/members.module';
import { EventsModule } from './events/events.module';
import { FundsModule } from './funds/funds.module';
import { ProposalsModule } from './proposals/proposals.module';
import { TransactionsModule } from './transactions/transactions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MembersModule,
    EventsModule,
    FundsModule,
    ProposalsModule,
    TransactionsModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
