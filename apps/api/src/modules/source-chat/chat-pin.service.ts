import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Chat kodi — Manba chatida ishlash, saqlash va yangi suhbat ochish uchun kod.
//  • Standart kod — 8020. U hammaga ma'lum, shuning uchun u bilan faqat YANGI kod o'rnatish mumkin:
//    chatga kirish, saqlash va yangi suhbat standart kod bilan ishlamaydi (avval o'z kodingizni qo'ying).
//  • Qayerda so'raladi — sozlanadi: chatga kirish (ishlash), saqlash (☆ saqlash, Excel), yangi suhbat.
//  • Kirishda kod to'g'ri bo'lsa — vaqtinchalik ruxsat (token) beriladi: belgilangan daqiqa davomida qayta so'ralmaydi.
//    Saqlash va yangi suhbat — har safar kod bilan.
//  • Bazada faqat xesh (scrypt + tuz). Kodning o'zi hech qayerda yozilmaydi va logga chiqmaydi.
//  • Noto'g'ri kod 5 marta — shu foydalanuvchi uchun 5 daqiqa kutish.
// ═══════════════════════════════════════════════════════════

const KEY = 'chat.pin';
const DEFAULT_CODE = '8020';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;
/** Kiritilgan kod (eski 4 xonali kodlar ham o'tadi) */
const CODE_RE = /^\d{4,8}$/;
/** Yangi o'rnatiladigan kod — 6–8 raqam */
const NEW_CODE_RE = /^\d{6,8}$/;
/** Juda oddiy kodlar (bir xil yoki ketma-ket raqamlar) qabul qilinmaydi */
function weakCode(code: string): boolean {
  if (/^(\d)\1+$/.test(code)) return true;
  const up = '01234567890123456789';
  const down = '98765432109876543210';
  return up.includes(code) || down.includes(code);
}
/**
 * Token imzosi uchun kalit — birinchi ishlatilganda o'qiladi (fayl yuklanganda emas):
 * .env ConfigModule orqali keyinroq yuklanadi, oldinroq o'qilsa kalit har ishga tushishda tasodifiy bo'lib qolardi.
 * JWT_SECRET bo'lmasa — jarayon uchun tasodifiy (qayta ishga tushganda chat qayta kod so'raydi).
 */
let secret: Buffer | null = null;
function signingKey(): Buffer {
  if (!secret) secret = createHmac('sha256', process.env.JWT_SECRET || randomBytes(32).toString('hex')).update('chat-pin').digest();
  return secret;
}

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface ChatPinRequire {
  /** Chatga kirish (savol berish, suhbatlarni ko'rish) */
  use: boolean;
  /** Saqlash: ☆ saqlash va Excel'ga yuklab olish */
  save: boolean;
  /** Yangi suhbat ochish */
  newChat: boolean;
}

interface Stored {
  salt?: string;
  hash?: string;
  require?: Partial<ChatPinRequire>;
  ttlMinutes?: number;
  updatedAt?: string;
  updatedBy?: string | null;
}

export type ChatPinAction = 'use' | 'save' | 'newChat';

@Injectable()
export class ChatPinService {
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async stored(): Promise<Stored> {
    return ((await this.prisma.setting.findUnique({ where: { key: KEY } }).catch(() => null))?.value as Stored | undefined) ?? {};
  }

  async config(): Promise<{ require: ChatPinRequire; ttlMinutes: number; isDefault: boolean; updatedAt: string | null }> {
    const s = await this.stored();
    return {
      require: { use: s.require?.use !== false, save: s.require?.save !== false, newChat: s.require?.newChat !== false },
      ttlMinutes: Number.isInteger(s.ttlMinutes) && s.ttlMinutes! >= 5 && s.ttlMinutes! <= 1440 ? s.ttlMinutes! : 120,
      isDefault: !s.hash,
      updatedAt: s.updatedAt ?? null,
    };
  }

  private async matches(code: string): Promise<boolean> {
    const s = await this.stored();
    if (!s.hash || !s.salt) {
      const a = Buffer.from(code);
      const b = Buffer.from(DEFAULT_CODE);
      return a.length === b.length && timingSafeEqual(a, b);
    }
    const got = await scrypt(code, Buffer.from(s.salt, 'hex'), 32);
    const want = Buffer.from(s.hash, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  }

  /** Kodni tekshirish (noto'g'ri bo'lsa — xato, 5 martadan keyin kutish) */
  async verify(code: unknown, userId: string, what = 'Chat', allowDefault = false): Promise<void> {
    const now = Date.now();
    const f = this.fails.get(userId);
    if (f && f.until > now) throw new ForbiddenException(`Kod ${MAX_ATTEMPTS} marta noto'g'ri kiritildi — ${Math.ceil((f.until - now) / 60_000)} daqiqadan keyin urinib ko'ring`);
    if (typeof code !== 'string' || !code) throw new ForbiddenException(`CHAT_CODE: ${what} uchun kod kerak`);
    if (!CODE_RE.test(code) || !(await this.matches(code))) {
      const count = (f && f.until && f.until <= now ? 0 : (f?.count ?? 0)) + 1;
      this.fails.set(userId, { count, until: count >= MAX_ATTEMPTS ? now + LOCK_MS : 0 });
      await this.audit.log({ userId, action: 'UPDATE', entity: 'chat_pin', entityId: 'verify', summary: `Chat kodi noto'g'ri kiritildi (${count}/${MAX_ATTEMPTS})` }).catch(() => null);
      throw new ForbiddenException(count >= MAX_ATTEMPTS ? `Kod noto'g'ri — ${LOCK_MS / 60_000} daqiqa kuting` : `Kod noto'g'ri (${MAX_ATTEMPTS - count} ta urinish qoldi)`);
    }
    this.fails.delete(userId);
    // Standart kod to'g'ri bo'lsa ham — faqat yangi kod o'rnatish uchun
    if (!allowDefault && (await this.config()).isDefault) {
      throw new ForbiddenException("CHAT_SETUP: Standart kod bilan ishlash yopilgan — avval o'z chat kodingizni o'rnating (6–8 raqam)");
    }
  }

  // ─────────── Kirish tokeni ───────────

  private sign(userId: string, exp: number): string {
    return createHmac('sha256', signingKey()).update(`${userId}.${exp}`).digest('base64url');
  }

  /** Kod to'g'ri — kirish tokeni (ttl daqiqa) */
  async unlock(code: unknown, userId: string): Promise<{ token: string; expiresAt: string }> {
    await this.verify(code, userId, 'Chatga kirish');
    const { ttlMinutes } = await this.config();
    const exp = Date.now() + ttlMinutes * 60_000;
    return { token: `${exp}.${this.sign(userId, exp)}`, expiresAt: new Date(exp).toISOString() };
  }

  tokenValid(token: unknown, userId: string): boolean {
    if (typeof token !== 'string') return false;
    const [expS, sig] = token.split('.');
    const exp = Number(expS);
    if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
    const want = Buffer.from(this.sign(userId, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** Chatda ishlash: talab qilinsa — kirish tokeni kerak */
  async assertUse(token: unknown, userId: string): Promise<void> {
    if (!(await this.config()).require.use) return;
    if (!this.tokenValid(token, userId)) throw new ForbiddenException('CHAT_LOCKED: Chatga kirish uchun kod kiriting');
  }

  /** Saqlash / yangi suhbat: talab qilinsa — har safar kod */
  async assertAction(action: Exclude<ChatPinAction, 'use'>, code: unknown, userId: string): Promise<void> {
    const req = (await this.config()).require;
    if (!req[action]) return;
    await this.verify(code, userId, action === 'save' ? 'Saqlash' : 'Yangi suhbat');
  }

  async status(token: unknown, userId: string) {
    const c = await this.config();
    const any = c.require.use || c.require.save || c.require.newChat;
    return { require: c.require, ttlMinutes: c.ttlMinutes, unlocked: !c.require.use || this.tokenValid(token, userId), mustSetCode: any && c.isDefault };
  }

  // ─────────── Sozlamalar ───────────

  async update(body: { currentCode?: unknown; newCode?: unknown; require?: unknown; ttlMinutes?: unknown }, userId: string) {
    const s = await this.stored();
    const settingCode = body?.newCode !== undefined && body.newCode !== null && body.newCode !== '';
    // Standart kod bilan — faqat yangi kod o'rnatiladi (boshqa sozlamalar o'z kodingiz bilan)
    if (!s.hash && !settingCode) throw new BadRequestException("Avval standart koddan farqli o'z chat kodingizni o'rnating");
    await this.verify(body?.currentCode, userId, "Sozlamani o'zgartirish", true);
    const next: Stored = { ...s };
    const changes: string[] = [];
    if (body?.newCode !== undefined && body.newCode !== null && body.newCode !== '') {
      if (typeof body.newCode !== 'string' || !NEW_CODE_RE.test(body.newCode)) throw new BadRequestException("Yangi kod 6–8 ta raqam bo'lsin");
      if (body.newCode === DEFAULT_CODE || weakCode(body.newCode)) throw new BadRequestException("Kod juda oddiy (bir xil yoki ketma-ket raqamlar) — boshqasini tanlang");
      if (body.newCode === body.currentCode) throw new BadRequestException("Yangi kod joriy koddan farq qilsin");
      const salt = randomBytes(16);
      next.salt = salt.toString('hex');
      next.hash = (await scrypt(body.newCode, salt, 32)).toString('hex');
      changes.push('kod almashtirildi');
    }
    if (body?.require && typeof body.require === 'object') {
      const r = body.require as Partial<ChatPinRequire>;
      const cur = (await this.config()).require;
      next.require = {
        use: typeof r.use === 'boolean' ? r.use : cur.use,
        save: typeof r.save === 'boolean' ? r.save : cur.save,
        newChat: typeof r.newChat === 'boolean' ? r.newChat : cur.newChat,
      };
      changes.push(`so'raladi: ${[next.require.use ? 'kirish' : null, next.require.save ? 'saqlash' : null, next.require.newChat ? 'yangi suhbat' : null].filter(Boolean).join(', ') || 'hech qayerda'}`);
    }
    if (body?.ttlMinutes !== undefined) {
      const t = Number(body.ttlMinutes);
      if (!Number.isInteger(t) || t < 5 || t > 1440) throw new BadRequestException("Kirish muddati 5–1440 daqiqa bo'lsin");
      next.ttlMinutes = t;
      changes.push(`kirish muddati ${t} daqiqa`);
    }
    if (!changes.length) throw new BadRequestException("O'zgarish yo'q");
    next.updatedAt = new Date().toISOString();
    next.updatedBy = userId;
    const value = next as unknown as object;
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'chat_pin', entityId: 'settings', summary: `Chat kodi sozlamasi: ${changes.join('; ')}` });
    return this.config();
  }
}