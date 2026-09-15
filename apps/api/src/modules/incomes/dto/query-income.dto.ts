import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class QueryIncomeDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Davr "YYYY-MM" ko\u2018rinishida bo\u2018lsin' })
  period?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  periodFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  periodTo?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  categoryCode?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Mijoz, tavsif va shartnoma bo'yicha qidiruv */
  @IsOptional()
  @IsString()
  search?: string;

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
