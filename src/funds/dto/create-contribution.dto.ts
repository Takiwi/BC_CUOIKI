import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class CreateContributionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' ? String(value) : value,
  )
  @IsString()
  @Matches(/^(?=.*[1-9])\d+(?:\.\d+)?$/, {
    message: 'amount must be a positive decimal value',
  })
  amount!: string;
}
