import { IsString, IsInt, IsOptional, IsBoolean, Min, MaxLength, Matches } from "class-validator";

export class CreateDepartmentDto {
  @IsString()
  @MaxLength(30, { message: "Kod 30 belgidan oshmasligi kerak" })
  @Matches(/^[A-Z0-9_]+$/, {
    message: "Kod faqat katta lotin harflari, raqam va pastki chiziqdan iborat bolsin",
  })
  code!: string;

  @IsString()
  @MaxLength(200, { message: "Nom 200 belgidan oshmasligi kerak" })
  name!: string;

  /** Foydalanuvchi koradigan raqamli indeks */
  @IsInt({ message: "Indeks butun son bolishi kerak" })
  @Min(1, { message: "Indeks 1 dan boshlanadi" })
  index!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /** Umumiy xarajatlarni taqsimlash ogirligi */
  @IsOptional()
  @IsInt()
  @Min(0)
  allocationWeight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}