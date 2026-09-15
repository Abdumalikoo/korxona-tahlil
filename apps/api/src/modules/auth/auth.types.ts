import type { UserRole } from '@prisma/client';

/** JWT ichida saqlanadigan ma'lumot */
export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: UserRole;
}

/** Autentifikatsiyadan o'tgan foydalanuvchi — request'ga biriktiriladi */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
}
