import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProposalDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?=.*[1-9])\d+(?:\.\d+)?$/, {
    message: 'amount must be a positive decimal value',
  })
  amount?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'purpose cannot be blank' })
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
