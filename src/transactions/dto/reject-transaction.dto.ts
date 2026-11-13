import { IsString, Matches, MaxLength } from 'class-validator';

export class RejectTransactionDto {
  @IsString()
  @MaxLength(1000)
  @Matches(/\S/, { message: 'reason cannot be blank' })
  reason!: string;
}
