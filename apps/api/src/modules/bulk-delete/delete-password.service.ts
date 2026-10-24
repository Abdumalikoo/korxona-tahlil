import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// O'chirish paroli — ko'p yozuvni birdan o'chirishdan oldin so'raladi:
//   • «Hammasi» (barcha davrlar) tanlanganda;
//   • 50 tadan ortiq yozuv o'chirilayotganda.
// Standart parol — 3642. U hammaga ma'lum, shuning uchun u bilan o'chirib bo'lmaydi:
// avval Sozlamalar › Xavfsizlik'da yangi parol (kamida 6 belgi) o'rnatiladi.
// Bazada faqat xesh (scrypt + tuz) saqlanadi — parolning o'zi hech qayerda yozilmaydi va logga chiqmaydi.
// Noto'g'ri parol 5 marta kiritilsa — shu foydalanuvchi uchun 5 daqiqa kutish.
// ═══════════════════════════════════════════════════════════

const KEY = 'delete.password';
const DEFAULT_PASSWORD = '3642';
/** Shundan ko'p yozuv o'chirilsa — parol so'raladi */
export const PASSWORD_THRESHOLD = 50;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

interface Stored {
  salt: string;
  hash: string;
  updatedAt: string;
  updatedBy: string | null;
}

@Injectable()
export class DeletePasswordService {
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async stored(): Promise<Stored | null> {
    const v = (await this.prisma.setting.findUnique({ where: { key: KEY } }).catch(() => null))?.value as Partial<Stored> | undefined;
    return v && typeof v.salt === 'string' && typeof v.hash === 'string' ? (v as Stored) : null;
  }

  private async hashOf(password: string, salt: Buffer): Promise<Buffer> {
    return scrypt(password, salt, 32);
  }

  private async matches(password: string): Promise<boolean> {
    const s = await this.stored();
    if (!s) {
      const a = Buffer.from(password);
      const b = Buffer.from(DEFAULT_PASSWORD);
      return a.length === b.length && timingSafeEqual(a, b);
    }
    const got = await this.hashOf(password, Buffer.from(s.salt, 'hex'));
    const want = Buffer.from(s.hash, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  }

  /** O'chirishdan oldin: parol to'g'rimi (noto'g'ri bo'lsa — xato) */
  async verify(password: unknown, userId: string, allowDefault = false): Promise<void> {
    const now = Date.now();
    const f = this.fails.get(userId);
    if (f && f.until > now) {
      throw new ForbiddenException(`Parol ${MAX_ATTEMPTS} marta noto'g'ri kiritildi — ${Math.ceil((f.until - now) / 60_000)} daqiqadan keyin urinib ko'ring`);
    }
    if (typeof password !== 'string' || !password) throw new BadRequestException("Bu o'chirish uchun parol kerak");
    if (password.length > 64 || !(await this.matches(password))) {
      // Kutish muddati o'tgan bo'lsa — hisob boshidan
      const count = (f && f.until && f.until <= now ? 0 : (f?.count ?? 0)) + 1;
      this.fails.set(userId, { count, until: count >= MAX_ATTEMPTS ? now + LOCK_MS : 0 });
      await this.audit.log({ userId, action: 'DELETE', entity: 'delete_password', entityId: 'verify', summary: `O'chirish paroli noto'g'ri kiritildi (${count}/${MAX_ATTEMPTS})` }).catch(() => null);
      throw new BadRequestException(count >= MAX_ATTEMPTS ? `Parol noto'g'ri — ${LOCK_MS / 60_000} daqiqa kuting` : `Parol noto'g'ri (${MAX_ATTEMPTS - count} ta urinish qoldi)`);
    }
    this.fails.delete(userId);
    if (!allowDefault && !(await this.stored())) {
      throw new ForbiddenException("Standart o'chirish paroli bilan o'chirish yopilgan — avval Sozlamalar › Xavfsizlik'da yangi parol o'rnating");
    }
  }

  /** Sozlamalar: standart parolmi, qachon o'zgargan */
  async info() {
    const s = await this.stored();
    let by: string | null = null;
    if (s?.updatedBy) by = (await this.prisma.user.findUnique({ where: { id: s.updatedBy }, select: { fullName: true } }).catch(() => null))?.fullName ?? null;
    return { isDefault: !s, updatedAt: s?.updatedAt ?? null, updatedBy: by, threshold: PASSWORD_THRESHOLD };
  }

  /** Parolni o'zgartirish (administrator): joriy parol va yangisi (6–32 belgi) */
  async change(body: { current?: unknown; next?: unknown }, userId: string) {
    await this.verify(body?.current, userId, true);
    const next = typeof body?.next === 'string' ? body.next : '';
    if (next.length < 6 || next.length > 32) throw new BadRequestException("Yangi parol 6 dan 32 belgigacha bo'lsin");
    if (/\s/.test(next)) throw new BadRequestException("Parolda bo'sh joy bo'lmasin");
    if (next === DEFAULT_PASSWORD || next === body?.current) throw new BadRequestException("Yangi parol standart va joriy paroldan farq qilsin");
    if (/^(.)\1+$/.test(next) || '0123456789012345678901234567890123456789'.includes(next)) throw new BadRequestException("Parol juda oddiy (bir xil yoki ketma-ket belgilar) — boshqasini tanlang");
    const salt = randomBytes(16);
    const value: Stored = { salt: salt.toString('hex'), hash: (await this.hashOf(next, salt)).toString('hex'), updatedAt: new Date().toISOString(), updatedBy: userId };
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: value as unknown as object }, update: { value: value as unknown as object } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'delete_password', entityId: 'change', summary: "O'chirish paroli o'zgartirildi" });
    return this.info();
  }
}