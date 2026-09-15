import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export class CreateExpenseDto {
  /** ISO sana: "2026-09-10" */
  @IsDateString({}, { message: 'Sana notogri formatda' })
  date!: string;

  /**
   * Summa TIYIN'da.
   * Frontend so'mni tiyinga o'girib yuboradi: 1 000 000 so'm -> 100 000 000
   */
  @IsInt({ message: 'Summa butun son bolishi kerak (tiyinda)' })
  @Min(1, { message: 'Summa noldan katta bolishi kerak' })
  amountTiyin!: number;

  @IsString()
  @MaxLength(50)
  categoryCode!: string;

  // --------- Ixtiyoriy maydonlar ---------

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Notogri tolov usuli' })
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentNo?: string;

  /** Kimga to'landi */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty?: string;

  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Notogri tolov holati' })
  paymentStatus?: PaymentStatus;

  /** Qachongacha to'lanishi kerak */
  @IsOptional()
  @IsDateString({}, { message: 'Tolov muddati notogri formatda' })
  dueDate?: string;

  /** Javobgar shaxs */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsible?: string;

  /** Summa ichidagi QQS, tiyinda */
  @IsOptional()
  @IsInt({ message: 'QQS butun son bolishi kerak (tiyinda)' })
  @Min(0)
  vatTiyin?: number;
}