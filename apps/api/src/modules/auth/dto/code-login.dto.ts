import { IsString, Matches, MaxLength } from 'class-validator';

export class CodeLoginDto {
  @IsString({ message: 'ID kod matn bo‘lishi kerak' })
  @MaxLength(20, { message: 'ID kod juda uzun' })
  @Matches(/^\s*[A-Za-z]{2,4}-?\d{1,6}\s*$/, { message: 'ID kod ko‘rinishi: SK-0001' })
  code!: string;

  @IsString({ message: 'PIN matn bo‘lishi kerak' })
  @Matches(/^\d{6}$/, { message: 'PIN 6 ta raqamdan iborat' })
  pin!: string;
}