import { CostBehavior, CostScope } from '@prisma/client';
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsEnum(CostBehavior, { message: 'Noto\u2018g\u2018ri xarajat turi' })
  behavior?: CostBehavior;

  @IsOptional()
  @IsEnum(CostScope, { message: 'Noto\u2018g\u2018ri qamrov' })
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
