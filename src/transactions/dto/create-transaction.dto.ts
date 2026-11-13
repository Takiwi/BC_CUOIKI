import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  @Matches(/^(?=.*[1-9])\d+(?:\.\d+)?$/, {
    message: 'amount must be a positive decimal value',
  })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
