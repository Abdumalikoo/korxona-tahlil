import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @MaxLength(20, { message: 'Kod 20 belgidan oshmasligi kerak' })
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'Kod faqat katta lotin harflari, raqam va pastki chiziqdan iborat bo\u2018lsin',
  })
  code!: string;

  @IsString()
  @MaxLength(100, { message: 'Nom 100 belgidan oshmasligi kerak' })
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /** Umumiy xarajatlarni taqsimlash og'irligi */
  @IsOptional()
  @IsInt()
  @Min(0)
  allocationWeight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
