import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { CostBehavior, CostScope } from '@prisma/client';

export class CreateCategoryDto {
  /**
   * Barqaror kod. Korsatilmasa nomdan avtomatik yasaladi.
   * Faqat katta lotin harflari, raqam va pastki chiziq.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'Kod faqat katta lotin harflari, raqam va pastki chiziqdan iborat bolsin',
  })
  code?: string;

  @IsString()
  @MaxLength(100)
  label!: string;

  /** Ota-kategoriya kodi. Null bolsa - yangi guruh */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  parentCode?: string | null;

  @IsOptional()
  @IsEnum(CostBehavior)
  behavior?: CostBehavior;

  @IsOptional()
  @IsEnum(CostScope)
  scope?: CostScope;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
