import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import {
  AccessTokenPayload,
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer access token required');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const result = await this.database.query<AuthenticatedUser>(
      `SELECT m.id, m.email, m.full_name AS "fullName", m.role,
              m.is_active AS "isActive", m.status AS "applicationStatus"
       FROM members m
       WHERE m.id = $1`,
      [payload.sub],
    );
    const member = result.rows[0];
    if (!member) {
      throw new UnauthorizedException('Invalid access token');
    }
    if (!member.isActive) {
      throw new ForbiddenException('Account is inactive');
    }
    if (member.applicationStatus !== 'APPROVED') {
      throw new ForbiddenException('Membership application is not approved');
    }

    request.user = member;
    return true;
  }
}
