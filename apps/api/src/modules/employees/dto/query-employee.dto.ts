import { IsOptional, IsString, IsInt, IsEnum, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { EmploymentType } from '@prisma/client';

export class QueryEmployeeDto {
  /** Ism yoki PINFL boyicha qidiruv */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  regionCode?: number;

  @IsOptional()
  @IsString()
  districtId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  /** Guruh: markaz-shtat, tuman-shtat, shartnoma */
  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeInactive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
