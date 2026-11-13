import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class TransactionDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
