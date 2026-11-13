import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProposalDto {
  @IsString()
  @Matches(/^(?=.*[1-9])\d+(?:\.\d+)?$/, {
    message: 'amount must be a positive decimal value',
  })
  amount!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'purpose cannot be blank' })
  purpose!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsUUID()
  eventId?: string | null;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsOptional()
  @IsString()
  votingDeadline?: string;
}
