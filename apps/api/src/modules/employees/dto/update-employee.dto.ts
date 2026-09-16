import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  middleName?: string | null;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsInt()
  @Min(0)
  regionCode?: number;

  @IsOptional()
  @IsString()
  districtId?: string | null;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsDateString()
  hiredAt?: string | null;

  @IsOptional()
  @IsDateString()
  firedAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
