import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApprovalDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
