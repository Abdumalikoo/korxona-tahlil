import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'Foydalanuvchi nomi matn bo\u2018lishi kerak' })
  @MinLength(3, { message: 'Foydalanuvchi nomi juda qisqa' })
  @MaxLength(50, { message: 'Foydalanuvchi nomi juda uzun' })
  username!: string;

  @IsString({ message: 'Parol matn bo\u2018lishi kerak' })
  @MinLength(6, { message: 'Parol kamida 6 belgidan iborat bo\u2018lishi kerak' })
  @MaxLength(100, { message: 'Parol juda uzun' })
  password!: string;
}
