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

export class CreateIncomeDto {
  @IsDateString({}, { message: 'Sana noto\u2018g\u2018ri formatda' })
  date!: string;

  /** Shartnoma yoki hisob-faktura summasi, TIYIN'da */
  @IsInt({ message: 'Summa butun son bo\u2018lishi kerak (tiyinda)' })
  @Min(1, { message: 'Summa noldan katta bo\u2018lishi kerak' })
  amountTiyin!: number;

  /** Haqiqatda tushgan summa, TIYIN'da. Ko'rsatilmasa to'lov holatidan hisoblanadi */
  @IsOptional()
  @IsInt()
  @Min(0)
  paidTiyin?: number;

  @IsString()
  @MaxLength(50)
  categoryCode!: string;

  @IsOptional()
  @IsString()

  departmentId?: string;

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
  @IsEnum(PaymentStatus, { message: 'Noto\u2018g\u2018ri to\u2018lov holati' })
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}
