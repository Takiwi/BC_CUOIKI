import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  DatabaseService,
  PoolClient,
  QueryResultRow,
} from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

interface MemberAuthRecord extends QueryResultRow {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: AuthenticatedUser['role'];
  isActive: boolean;
  applicationStatus: AuthenticatedUser['applicationStatus'];
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  member: Pick<AuthenticatedUser, 'id' | 'email' | 'fullName' | 'role'>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(input: RegisterDto) {
    if (Buffer.byteLength(input.password, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 UTF-8 bytes');
    }

    let id: string = randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const email = input.email.trim().toLowerCase();

    try {
      await this.database.transaction(async (client) => {
        const existing = await client.query<{
          id: string;
          status: string;
        }>(
          `SELECT m.id, m.status
           FROM members m WITH (UPDLOCK, ROWLOCK)
           WHERE lower(m.email) = lower($1)`,
          [email],
        );

        const existingMember = existing.rows[0];
        if (existingMember) {
          if (existingMember.status === 'REJECTED') {
            await client.query(
              `UPDATE members
               SET full_name = $1, password_hash = $2, gender = $3,
                   date_of_birth = $4, status = 'PENDING', is_active = 1, updated_at = SYSUTCDATETIME()
               WHERE id = $5`,
              [
                input.fullName.trim(),
                passwordHash,
                input.gender ?? null,
                input.dateOfBirth ?? null,
                existingMember.id,
              ],
            );
            await client.query(
              `DELETE FROM refresh_tokens WHERE member_id = $1`,
              [existingMember.id],
            );
            id = existingMember.id;
            return;
          }

          throw new ConflictException('Email is already registered');
        }

        await client.query(
          `INSERT INTO members
             (id, full_name, email, password_hash, gender, date_of_birth, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
          [
            id,
            input.fullName.trim(),
            email,
            passwordHash,
            input.gender ?? null,
            input.dateOfBirth ?? null,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }

    void this.notifications.notifyPresidentNewApplication(
      input.fullName.trim(),
      email,
      id,
    );

    return {
      id,
      email,
      applicationStatus: 'PENDING' as const,
    };
  }

  async login(input: LoginDto): Promise<SessionTokens> {
    const result = await this.database.query<MemberAuthRecord>(
      `SELECT m.id, m.email, m.full_name AS "fullName",
              m.password_hash AS "passwordHash", m.role,
              m.is_active AS "isActive", m.status AS "applicationStatus"
       FROM members m
       WHERE lower(m.email) = lower($1)`,
      [input.email.trim()],
    );
    const member = result.rows[0];
    if (
      !member ||
      !(await bcrypt.compare(input.password, member.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!member.isActive) {
      throw new ForbiddenException('Account is inactive');
    }
    if (member.applicationStatus !== 'APPROVED') {
      throw new ForbiddenException(
        member.applicationStatus === 'PENDING'
          ? 'Membership application is pending approval'
          : 'Membership application was rejected',
      );
    }

    return this.createSession(member);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const tokenHash = hashToken(refreshToken);
    const nextRefreshToken = createRefreshToken();
    const member = await this.database.transaction(async (client) => {
      const result = await client.query<MemberAuthRecord>(
        `SELECT m.id, m.email, m.full_name AS "fullName",
                m.password_hash AS "passwordHash", m.role,
                m.is_active AS "isActive", m.status AS "applicationStatus"
         FROM refresh_tokens rt WITH (UPDLOCK, ROWLOCK)
         JOIN members m ON m.id = rt.member_id
         WHERE rt.token_hash = $1
           AND rt.revoked_at IS NULL
           AND rt.expires_at > SYSUTCDATETIME()`,
        [tokenHash],
      );
      const storedMember = result.rows[0];
      if (!storedMember) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      assertEligible(storedMember);

      await client.query(
        'UPDATE refresh_tokens SET revoked_at = SYSUTCDATETIME() WHERE token_hash = $1',
        [tokenHash],
      );
      await insertRefreshToken(client, storedMember.id, nextRefreshToken);
      return storedMember;
    });

    return this.createSession(member, nextRefreshToken);
  }

  async logout(refreshToken: string): Promise<{ revoked: true }> {
    await this.database.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, SYSUTCDATETIME())
       WHERE token_hash = $1`,
      [hashToken(refreshToken)],
    );
    return { revoked: true };
  }

  getCurrentUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      applicationStatus: user.applicationStatus,
    };
  }

  private async createSession(
    member: Pick<MemberAuthRecord, 'id' | 'email' | 'fullName' | 'role'>,
    existingRefreshToken?: string,
  ): Promise<SessionTokens> {
    const refreshToken = existingRefreshToken ?? createRefreshToken();
    if (!existingRefreshToken) {
      await this.database.query(
        `INSERT INTO refresh_tokens (id, member_id, token_hash, expires_at)
         VALUES ($1, $2, $3, DATEADD(day, 30, SYSUTCDATETIME()))`,
        [randomUUID(), member.id, hashToken(refreshToken)],
      );
    }

    const accessToken = await this.jwtService.signAsync({
      sub: member.id,
      email: member.email,
    });
    return {
      accessToken,
      refreshToken,
      member: {
        id: member.id,
        email: member.email,
        fullName: member.fullName,
        role: member.role,
      },
    };
  }
}

function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function insertRefreshToken(
  client: PoolClient,
  memberId: string,
  token: string,
): Promise<void> {
  await client.query(
    `INSERT INTO refresh_tokens (id, member_id, token_hash, expires_at)
     VALUES ($1, $2, $3, DATEADD(day, 30, SYSUTCDATETIME()))`,
    [randomUUID(), memberId, hashToken(token)],
  );
}

function assertEligible(member: MemberAuthRecord): void {
  if (!member.isActive) {
    throw new ForbiddenException('Account is inactive');
  }
  if (member.applicationStatus !== 'APPROVED') {
    throw new ForbiddenException('Membership application is not approved');
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as Record<string, any>;
  return (
    err.code === '23505' ||
    err.number === 2627 ||
    err.number === 2601 ||
    (typeof err.message === 'string' &&
      (err.message.includes('UNIQUE KEY') ||
        err.message.includes('unique index')))
  );
}
