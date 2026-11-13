import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '../auth.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
