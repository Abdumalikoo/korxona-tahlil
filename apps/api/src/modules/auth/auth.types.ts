import type { UserRole } from '@prisma/client';

/** JWT ichida saqlanadigan ma'lumot */
export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: UserRole;
  /** Token versiyasi: PIN tiklansa yoki hisob bloklansa — eski tokenlar yaroqsiz bo'ladi */
  tv?: number;
}

/** Ishchi rolga ochiq bo'limlar (admin va kuzatuvchida — null) */
export interface UserAccess {
  /** Kirgandan keyin ochiladigan sahifa */
  home: string;
  /** Ruxsat etilgan sahifalar (web manzillar, prefiks bo'yicha) */
  pages: string[];
  /** Bo'limlar nomi */
  sections: string[];
}

/** Autentifikatsiyadan o'tgan foydalanuvchi — request'ga biriktiriladi */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  roleLabel: string;
  /** ID kod (ishchi rollarda): "SK-0001" */
  loginCode: string | null;
  /** Admin bergan/tiklagan PIN — o'zi yangisini o'rnatmaguncha boshqa bo'limlar yopiq */
  mustChangePin: boolean;
  access: UserAccess | null;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
}