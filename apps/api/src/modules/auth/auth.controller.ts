import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../../common/decorators';
import { AuthService } from './auth.service';
import type { AuthUser, LoginResult } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ data: LoginResult }> {
    const result = await this.auth.login(dto.username, dto.password);
    return { data: result };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): { data: AuthUser } {
    return { data: user };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ data: { success: true } }> {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { data: { success: true } };

  }
}
