import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { accessView, isWorkerRole, normalizeLoginCode, roleLabel } from '../../common/access/role-access';
import { assertPin } from '../../common/access/pin';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, JwtPayload, LoginResult } from './auth.types';

const BCRYPT_ROUNDS = 12;

/** ID kod bilan kirish: shuncha xato PIN'dan keyin hisob vaqtincha yopiladi */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;
/** Ishchi rollar sessiyasi — 12 soat (umumiy kompyuterda qolib ketmasin) */
/** Login + parol: shuncha xatodan keyin hisob vaqtincha yopiladi */
export const MAX_PASSWORD_ATTEMPTS = 5;
export const PASSWORD_LOCK_MINUTES = 15;
const WORKER_TOKEN_TTL_SECONDS = 12 * 60 * 60;

const BAD_CODE = 'ID kod yoki PIN noto‘g‘ri';
/** Topilmagan kod uchun ham bcrypt ishlaydi — javob vaqtidan kod borligini bilib bo'lmaydi */
const DUMMY_HASH = bcrypt.hashSync('korxona-tahlil:dummy', BCRYPT_ROUNDS);

type UserRow = Pick<User, 'id' | 'username' | 'fullName' | 'role' | 'loginCode' | 'mustChangePin'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /** Request'ga biriktiriladigan va ekranga beriladigan ko'rinish */
  toAuthUser(user: UserRow): AuthUser {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      roleLabel: roleLabel(user.role),
      loginCode: user.loginCode,
      mustChangePin: user.mustChangePin,
      access: accessView(user.role),
    };
  }

  private async issue(user: UserRow & { tokenVersion: number }): Promise<LoginResult> {
    const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role, tv: user.tokenVersion };
    const accessToken = isWorkerRole(user.role)
      ? await this.jwt.signAsync(payload, { expiresIn: WORKER_TOKEN_TTL_SECONDS })
      : await this.jwt.signAsync(payload);
    return { accessToken, user: this.toAuthUser(user) };
  }

  /** Login + parol (administrator va kuzatuvchi) */
  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });

    // Foydalanuvchi topilmasa ham bir xil xato beriladi —
    // qaysi login mavjudligini aniqlab bo'lmasligi uchun.
    // Ishchi rollar (Omborchi …) parol bilan kira olmaydi — faqat ID kod + PIN.
    if (!user || !user.isActive || isWorkerRole(user.role)) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      // Yopiq hisob: parol to'g'ri bo'lsa ham kirmaydi (vaqt bo'yicha farq bilinmasin — bcrypt baribir ishlaydi)
      await bcrypt.compare(password, DUMMY_HASH);
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
      throw new UnauthorizedException(`Ko‘p marta xato parol kiritildi. ${minutes} daqiqadan keyin qayta urinib ko‘ring`);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      // Atomik oshirish — parallel so'rovlar ham hisoblanadi
      const bumped = await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
      const attempts = bumped.failedAttempts;
      const lock = attempts >= MAX_PASSWORD_ATTEMPTS;
      if (lock) {
        await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: new Date(now.getTime() + PASSWORD_LOCK_MINUTES * 60_000) } });
      }
      await this.audit
        .log({
          userId: user.id,
          action: 'LOGIN',
          entity: 'user',
          entityId: user.id,
          summary: lock ? `${user.username}: ${MAX_PASSWORD_ATTEMPTS} marta xato parol — ${PASSWORD_LOCK_MINUTES} daqiqaga yopildi` : `${user.username}: xato parol (${attempts}/${MAX_PASSWORD_ATTEMPTS})`,
        })
        .catch(() => null);
      if (lock) throw new UnauthorizedException(`${MAX_PASSWORD_ATTEMPTS} marta xato parol kiritildi. Hisob ${PASSWORD_LOCK_MINUTES} daqiqaga yopildi`);
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    // Parallel urinishlar orasida yopilgan bo'lishi mumkin
    const fresh = await this.prisma.user.findUnique({ where: { id: user.id }, select: { lockedUntil: true } });
    if (fresh?.lockedUntil && fresh.lockedUntil > new Date()) {
      throw new UnauthorizedException(`Ko‘p marta xato parol kiritildi. Hisob ${PASSWORD_LOCK_MINUTES} daqiqagacha yopilgan`);
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, failedAttempts: 0, lockedUntil: null },
    });

    return this.issue(updated);
  }

  /** ID kod + PIN (ishchi rollar). 5 marta xato — 15 daqiqaga yopiladi. */
  async codeLogin(rawCode: string, pin: string): Promise<LoginResult> {
    const code = normalizeLoginCode(rawCode);
    const user = code ? await this.prisma.user.findUnique({ where: { loginCode: code } }) : null;

    if (!user || !user.pinHash || !isWorkerRole(user.role)) {
      await bcrypt.compare(pin, DUMMY_HASH);
      throw new UnauthorizedException(BAD_CODE);
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
      throw new UnauthorizedException(`Ko‘p marta xato PIN kiritildi. ${minutes} daqiqadan keyin qayta urinib ko‘ring yoki administratorga murojaat qiling`);
    }

    const valid = await bcrypt.compare(pin, user.pinHash);
    if (!valid) {
      // Parallel so'rovlar ham hisoblansin: o'qib-yozish emas, bazadagi atomik oshirish
      const bumped = await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
      const attempts = bumped.failedAttempts;
      const lock = attempts >= MAX_PIN_ATTEMPTS;
      if (lock) {
        await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) } });
      }
      await this.audit.log({
        userId: user.id,
        action: 'LOGIN',
        entity: 'user',
        entityId: user.id,
        summary: lock ? `${user.loginCode}: ${MAX_PIN_ATTEMPTS} marta xato PIN — ${PIN_LOCK_MINUTES} daqiqaga yopildi` : `${user.loginCode}: xato PIN (${attempts}/${MAX_PIN_ATTEMPTS})`,
      });
      if (lock) {
        throw new UnauthorizedException(`${MAX_PIN_ATTEMPTS} marta xato PIN kiritildi. Hisob ${PIN_LOCK_MINUTES} daqiqaga yopildi`);
      }
      throw new UnauthorizedException(`${BAD_CODE}. Qolgan urinishlar: ${MAX_PIN_ATTEMPTS - attempts}`);
    }

    // Parallel urinishlar orasida hisob yopilgan bo'lishi mumkin — to'g'ri PIN ham o'tmaydi
    const fresh = await this.prisma.user.findUnique({ where: { id: user.id }, select: { lockedUntil: true } });
    if (fresh?.lockedUntil && fresh.lockedUntil > new Date()) {
      throw new UnauthorizedException(`Ko‘p marta xato PIN kiritildi. Hisob ${PIN_LOCK_MINUTES} daqiqagacha yopilgan`);
    }
    // PIN to'g'ri bo'lsa ham, bloklangan hisob kirmaydi
    if (!user.isActive) {
      throw new UnauthorizedException('Hisobingiz bloklangan. Administratorga murojaat qiling');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, failedAttempts: 0, lockedUntil: null },
    });
    await this.audit.log({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id, summary: `${user.loginCode} (${roleLabel(user.role)}) tizimga kirdi` });
    return this.issue(updated);
  }

  /** Har so'rovda: hisob faolmi va token eskirmaganmi (PIN tiklash / bloklashdan keyin) */
  async validateById(userId: string, tokenVersion?: number): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, loginCode: true, mustChangePin: true, tokenVersion: true },
    });

    if (!user || !user.isActive) return null;
    if ((tokenVersion ?? 0) !== user.tokenVersion) return null;

    return this.toAuthUser(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }
    if (isWorkerRole(user.role)) {
      throw new BadRequestException('Siz ID kod bilan kirasiz — parol emas, PIN o‘zgartiriladi');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Joriy parol noto‘g‘ri');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('Yangi parol eskisidan farq qilishi kerak');
    }

    // Parol o'zgardi — boshqa qurilmalardagi eski tokenlar yaroqsiz; joriy oyna uchun yangi token
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword), tokenVersion: { increment: 1 }, failedAttempts: 0, lockedUntil: null },
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'user', entityId: userId, summary: `${user.username}: parol o'zgartirildi, boshqa sessiyalar yopildi` }).catch(() => null);
    return this.issue(updated);
  }

  /** Chiqish: shu foydalanuvchining barcha tokenlari yaroqsiz bo'ladi (barcha qurilmalarda) */
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }).catch(() => null);
    await this.audit.log({ userId, action: 'LOGIN', entity: 'user', entityId: userId, summary: 'Tizimdan chiqdi (barcha sessiyalar yopildi)' }).catch(() => null);
  }

  /**
   * Ishchi o'z PIN'ini o'zgartiradi. Eski tokenlar yaroqsiz bo'ladi —
   * shu sababli yangi token qaytariladi (joriy oynada ish davom etadi).
   */
  async changePin(userId: string, currentPin: string, newPin: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !isWorkerRole(user.role) || !user.pinHash) {
      throw new BadRequestException('PIN faqat ID kod bilan kiradigan foydalanuvchilarda bor');
    }
    const valid = await bcrypt.compare(currentPin, user.pinHash);
    if (!valid) {
      throw new BadRequestException('Joriy PIN noto‘g‘ri');
    }
    const pin = assertPin(newPin);
    if (pin === currentPin) {
      throw new BadRequestException('Yangi PIN eskisidan farq qilishi kerak');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS), mustChangePin: false, tokenVersion: { increment: 1 } },
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'user', entityId: userId, summary: `${user.loginCode}: PIN o‘zgartirildi` });
    return this.issue(updated);
  }
}