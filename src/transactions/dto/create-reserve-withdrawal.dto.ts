import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateReserveWithdrawalDto {
  @IsString()
  @Matches(/^(?=.*[1-9])\d+(?:\.\d+)?$/, {
    message: 'amount must be a positive decimal value',
  })
  amount!: string;

  @IsString()
  @MaxLength(1000)
  @Matches(/\S/, { message: 'reason cannot be blank' })
  reason!: string;
}
