import { PaymentMethod, PaymentStatus } from '@prisma/client';
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';

export class UpdateIncomeDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountTiyin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidTiyin?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryCode?: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  /** 0 — Markaz, boshqa kod — hudud; null — biriktirilmagan */
  @IsOptional()
  @IsInt()
  @Min(0)
  regionCode?: number | null;

  @IsOptional()
  @IsString()
  districtId?: string | null;

  /** Yo'nalish; null yoki '' — olib tashlanadi */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  segment?: string | null;


  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contractNo?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}