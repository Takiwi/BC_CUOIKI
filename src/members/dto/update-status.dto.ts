import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateStatusDto {
  @IsNotEmpty({ message: 'Trạng thái isActive không được để trống' })
  @IsBoolean({ message: 'isActive phải là kiểu boolean' })
  isActive!: boolean;
}
