import { IsOptional, IsString, IsInt, IsEnum, Matches, Min, Max } from 'class-validator';
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

  /**
   * Shu kuni ishlayotgan xodimlar (YYYY-MM-DD) — umumiy «Davr» oxiri.
   * O'tgan kun bo'lsa: ishga kirgan sanasi shu kungacha, bo'shagan sanasi shu kundan keyin (yoki hali ishlaydi).
   * Bugun yoki keyin bo'lsa — e'tiborga olinmaydi (bugungi holat).
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Sana YYYY-MM-DD ko'rinishida bo'lsin" })
  activeOn?: string;

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