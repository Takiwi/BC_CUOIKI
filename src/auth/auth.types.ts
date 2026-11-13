import type { Request } from 'express';

export const MEMBER_ROLES = [
  'GUEST',
  'MEMBER',
  'TREASURER',
  'PRESIDENT',
  'BOARD',
  'ADMIN',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: MemberRole;
  isActive: boolean;
  applicationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
}
