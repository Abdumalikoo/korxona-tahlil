import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../../common/decorators';
import { RateLimit } from '../../common/security/rate-limit';
import { AuthService } from './auth.service';
import type { AuthUser, LoginResult } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { CodeLoginDto } from './dto/code-login.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Administrator va kuzatuvchi: login + parol */
  @Public()
  @RateLimit({ limit: 10, windowSec: 60, bodyKey: 'username', bodyLimit: 10 })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ data: LoginResult }> {
    const result = await this.auth.login(dto.username, dto.password);
    return { data: result };
  }

  /** Ishchi rollar (Omborchi …): ID kod + 6 xonali PIN */
  @Public()
  @RateLimit({ limit: 20, windowSec: 60, bodyKey: 'code', bodyLimit: 12 })
  @Post('code-login')
  @HttpCode(HttpStatus.OK)
  async codeLogin(@Body() dto: CodeLoginDto): Promise<{ data: LoginResult }> {
    return { data: await this.auth.codeLogin(dto.code, dto.pin) };
  }

  /** Joriy foydalanuvchi, roli va ochiq bo'limlari */
  @Get('me')
  me(@CurrentUser() user: AuthUser): { data: AuthUser } {
    return { data: user };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ data: { success: true } & LoginResult }> {
    // Eski tokenlar yaroqsiz bo'ladi — joriy oyna yangi token bilan davom etadi
    const result = await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { data: { success: true, ...result } };
  }

  /** Chiqish — barcha qurilmalardagi sessiyalar yopiladi */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser('id') userId: string): Promise<{ data: { success: true } }> {
    await this.auth.logout(userId);
    return { data: { success: true } };
  }

  /** Ishchi o'z PIN'ini o'zgartiradi — yangi token qaytadi */
  @Post('change-pin')
  @HttpCode(HttpStatus.OK)
  async changePin(@CurrentUser('id') userId: string, @Body() dto: ChangePinDto): Promise<{ data: LoginResult }> {
    return { data: await this.auth.changePin(userId, dto.currentPin, dto.newPin) };
  }
}