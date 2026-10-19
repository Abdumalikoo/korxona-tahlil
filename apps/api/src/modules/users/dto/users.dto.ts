import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkerDto {
  @IsString({ message: 'F.I.Sh. matn bo‘lishi kerak' })
  @MinLength(3, { message: 'F.I.Sh. juda qisqa' })
  @MaxLength(120, { message: 'F.I.Sh. juda uzun' })
  fullName!: string;

  /** Ishchi rol: SKLADCHI … (ro'yxat — role-access.ts) */
  @IsString()
  @MaxLength(30)
  role!: string;

  /** Berilmasa — tizim tasodifiy PIN yaratadi */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'PIN 6 ta raqamdan iborat' })
  pin?: string;

  /** true (standart) — birinchi kirishda o'z PIN'ini o'rnatadi */
  @IsOptional()
  @IsBoolean()
  mustChange?: boolean;
}

export class UpdateWorkerDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'F.I.Sh. juda qisqa' })
  @MaxLength(120, { message: 'F.I.Sh. juda uzun' })
  fullName?: string;

  /** false — bloklash (hamma ochiq sessiyalari shu zahoti yopiladi) */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** ID kodni o'zgartirish: SK-0007, SK-12 … (2–4 harf + raqam) */
  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z]{2,4}-?\d{1,6}\s*$/, { message: 'ID kod ko\u2018rinishi: SK-0001 (2–4 harf, chiziqcha, raqam)' })
  loginCode?: string;
}

export class ResetPinDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'PIN 6 ta raqamdan iborat' })
  pin?: string;

  /** true (standart) — xodim birinchi kirishda o'z PIN'ini o'rnatadi; false — shu PIN bilan ishlayveradi */
  @IsOptional()
  @IsBoolean()
  mustChange?: boolean;
}