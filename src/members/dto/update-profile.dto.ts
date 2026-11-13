import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/, { message: 'Tên không được chỉ chứa khoảng trắng' })
  fullName?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'], {
    message: 'Giới tính phải là MALE, FEMALE hoặc OTHER',
  })
  gender?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày sinh phải theo định dạng YYYY-MM-DD',
  })
  @IsDateString({ strict: true }, { message: 'Ngày sinh không hợp lệ' })
  dateOfBirth?: string;
}
