import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString({ message: 'Yangi parol matn bo\u2018lishi kerak' })
  @MinLength(8, { message: 'Yangi parol kamida 8 belgidan iborat bo\u2018lishi kerak' })
  @MaxLength(100)
  newPassword!: string;
}
