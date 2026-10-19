import { IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Joriy PIN 6 ta raqamdan iborat' })
  currentPin!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Yangi PIN 6 ta raqamdan iborat' })
  newPin!: string;
}