import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        let secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          if (process.env.NODE_ENV === 'production') {
            throw new Error(
              'JWT_SECRET must contain at least 32 characters in production.',
            );
          }
          secret = 'default-dev-jwt-secret-key-at-least-32-chars-long-2026';
        }
        return { secret, signOptions: { expiresIn: 900 } };
      },
    }),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
