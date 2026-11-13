import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/)
  location!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  maxParticipants?: number | null;
}
