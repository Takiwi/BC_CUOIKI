import { IsOptional, IsString, IsUUID } from 'class-validator';
import type { ProposalStatus } from '../proposals.service';

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  'VOTING',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'TIE_REVIEW_REQUIRED',
  'BOARD_DECISION_REQUIRED',
];

export class ProposalFiltersDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  eventId?: string;
}
