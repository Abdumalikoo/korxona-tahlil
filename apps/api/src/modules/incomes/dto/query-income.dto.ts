import { ENTRY_UNIT_CODES } from '../../../common/segments/segments';
import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

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

  /** Sana oraligi */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

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

  /** Bo'lim: DOIMIY yoki BOSHQA */
  @IsOptional()
  @IsString()
  section?: 'DOIMIY' | 'BOSHQA';

  /** Kiritish bo'limi: CENTER, REGION, TAX_FREE, MARKSHEYDER, FERMER, BUXGALTERIYA */
  @IsOptional()
  @IsIn(ENTRY_UNIT_CODES)
  unit?: string;
}