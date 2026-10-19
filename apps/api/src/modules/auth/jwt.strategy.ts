import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import type { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET .env faylida ko‘rsatilmagan');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /** Hisob bloklangan, PIN tiklangan yoki rol o'zgargan bo'lsa — eski token qabul qilinmaydi */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.auth.validateById(payload.sub, payload.tv);
    if (!user) {
      throw new UnauthorizedException('Sessiya yaroqsiz — qaytadan kiring');
    }
    return user;
  }
}