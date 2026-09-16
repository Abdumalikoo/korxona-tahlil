import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  IsDateString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  /** PINFL - 14 raqam */
  @IsString()
  @Matches(/^\d{14}$/, { message: 'PINFL 14 ta raqamdan iborat bolishi kerak' })
  pinfl!: string;

  @IsString()
  @MaxLength(50)
  lastName!: string;

  @IsString()
  @MaxLength(50)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  middleName?: string;

  @IsEnum(EmploymentType, { message: 'Ish turi notogri' })
  employmentType!: EmploymentType;

  /** 0 - Markaz, 3 - Andijon, 33 - Xorazm */
  @IsInt({ message: 'Hudud kodi butun son bolishi kerak' })
  @Min(0)
  regionCode!: number;

  /** Tuman kaliti: "33-1". Markaz uchun bosh */
  @IsOptional()
  @IsString()
  districtId?: string | null;

  /** Bolim - faqat markaz xodimlari uchun */
  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsDateString()
  hiredAt?: string;

  @IsOptional()
  @IsDateString()
  firedAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
