import { BadRequestException, Injectable } from '@nestjs/common';
import { secretBoxReady } from '../../common/crypto/secret-box';
import { AuditService } from '../audit/audit.service';
import { BackupService } from '../backup/backup.service';
import { DeletePasswordService } from '../bulk-delete/delete-password.service';
import { hrCryptoStatus, sealAllHr, unsealAllHr, type HrCryptoStatus } from '../hr-sheets/hr-sheets.crypto';
import { clearHrCache } from '../hr-sheets/hr-sheets.store';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Xavfsizlik holati va sozlamasi:
//  • Kuzatuvchi shaxsiy ma'lumotlarni ko'radimi (standart — yo'q);
//  • standart (hammaga ma'lum) parol/kodlar hali almashtirilmaganmi — administratorga ogohlantirish.
// ═══════════════════════════════════════════════════════════

const VIEWER_KEY = 'security.viewerPersonal';
const CACHE_MS = 30_000;

export interface SecurityStatus {
  viewerPersonal: boolean;
  deletePasswordDefault: boolean;
  chatCodeDefault: boolean;
  /** Zaxira shifrlanadimi (BACKUP_ENCRYPTION_KEY) */
  backupEncrypted: boolean;
  /** Zaxira ikkinchi joyga nusxalanadimi (BACKUP_MIRROR_DIR) */
  backupMirror: boolean;
  /** Bazadagi maxfiy qiymatlar shifrlanadimi (APP_ENCRYPTION_KEY) */
  secretsEncrypted: boolean;
  /** Ma'lumotnomalarda hali ochiq shaxsiy qiymatlar soni */
  hrPlain: number;
  /** Shifrlangan, lekin kalit yo'qligi sababli ochib bo'lmaydiganlar */
  hrLocked: number;
  /** Almashtirilishi kerak bo'lgan standart qiymatlar (ekranda ogohlantirish uchun) */
  warnings: string[];
}

@Injectable()
export class SecurityService {
  private cache: { value: boolean; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly backup: BackupService,
    private readonly passwords: DeletePasswordService,
  ) {}

  // ─────────── Ma'lumotnomalardagi shaxsiy maydonlar (pasport, telefon, manzil …) ───────────

  hrCrypto(): Promise<HrCryptoStatus> {
    return hrCryptoStatus(this.prisma);
  }

  /** Avval zaxira olinadi (olinmasa — to'xtaydi), keyin hammasi shifrlanadi */
  async sealHr(userId: string): Promise<HrCryptoStatus & { done: number; backup: string }> {
    if (!secretBoxReady()) throw new BadRequestException("Serverda APP_ENCRYPTION_KEY sozlanmagan (kamida 32 belgi) — .env ga qo'shib, API'ni qayta ishga tushiring");
    let backupName: string;
    try {
      backupName = (await this.backup.create()).name;
    } catch (e) {
      throw new BadRequestException(`Shifrlashdan oldin zaxira olib bo'lmadi — hech narsa o'zgartirilmadi. ${(e as Error).message}`.slice(0, 400));
    }
    const r = await sealAllHr(this.prisma);
    clearHrCache();
    await this.audit
      .log({ userId, action: 'UPDATE', entity: 'security', entityId: 'hr-seal', summary: `Ma'lumotnomalardagi shaxsiy maydonlar shifrlandi: ${r.sealed} ta qiymat (${r.sheets} ta nusxa). Oldin zaxira: ${backupName}` })
      .catch(() => null);
    return { ...(await this.hrCrypto()), done: r.sealed, backup: backupName };
  }

  /** Orqaga qaytarish (ochiq holga) — o'chirish paroli bilan */
  async unsealHr(password: unknown, userId: string): Promise<HrCryptoStatus & { done: number }> {
    await this.passwords.verify(password, userId);
    if (!secretBoxReady()) throw new BadRequestException("Serverda APP_ENCRYPTION_KEY sozlanmagan — ochib bo'lmaydi");
    let r: { opened: number; sheets: number };
    try {
      r = await unsealAllHr(this.prisma);
    } catch (e) {
      throw new BadRequestException(`Ochib bo'lmadi — hech narsa o'zgartirilmadi: ${(e as Error).message}`);
    }
    clearHrCache();
    await this.audit
      .log({ userId, action: 'UPDATE', entity: 'security', entityId: 'hr-unseal', summary: `Ma'lumotnomalardagi shaxsiy maydonlar shifrdan chiqarildi: ${r.opened} ta qiymat` })
      .catch(() => null);
    return { ...(await this.hrCrypto()), done: r.opened };
  }

  /** Kuzatuvchiga shaxsiy ma'lumotlar ochiqmi (30 soniya keshlanadi) */
  async viewerPersonal(): Promise<boolean> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.setting.findUnique({ where: { key: VIEWER_KEY } }).catch(() => null);
    const value = (row?.value as { enabled?: unknown } | null)?.enabled === true;
    this.cache = { value, at: now };
    return value;
  }

  async setViewerPersonal(enabled: unknown, userId: string): Promise<SecurityStatus> {
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled: true yoki false bo‘lsin');
    const value = { enabled, updatedAt: new Date().toISOString(), updatedBy: userId };
    await this.prisma.setting.upsert({ where: { key: VIEWER_KEY }, create: { key: VIEWER_KEY, value }, update: { value } });
    this.cache = { value: enabled, at: Date.now() };
    await this.audit
      .log({ userId, action: 'UPDATE', entity: 'security', entityId: 'viewer-personal', summary: enabled ? "Kuzatuvchiga shaxsiy ma'lumotlar ochildi" : "Kuzatuvchiga shaxsiy ma'lumotlar yopildi" })
      .catch(() => null);
    return this.status();
  }

  async status(): Promise<SecurityStatus> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: ['delete.password', 'chat.pin'] } } }).catch(() => []);
    const hasHash = (key: string) => {
      const v = rows.find((r) => r.key === key)?.value as { hash?: unknown } | undefined;
      return typeof v?.hash === 'string' && v.hash.length > 0;
    };
    const deletePasswordDefault = !hasHash('delete.password');
    const chatCodeDefault = !hasHash('chat.pin');
    const warnings: string[] = [];
    if (deletePasswordDefault) warnings.push("O'chirish paroli standart — Sozlamalar › Xavfsizlik'da almashtiring (almashtirilmaguncha ko'p yozuvni o'chirish yopiq)");
    if (chatCodeDefault) warnings.push("Chat kodi standart — Sozlamalar › Chat kodi'da almashtiring (almashtirilmaguncha chat yopiq)");
    const bk = process.env.BACKUP_ENCRYPTION_KEY ?? '';
    const backupEncrypted = bk.length >= 16;
    const backupMirror = Boolean((process.env.BACKUP_MIRROR_DIR ?? '').trim());
    const secretsEncrypted = secretBoxReady();
    if (!backupEncrypted) warnings.push("Zaxira shifrlanmagan — serverdagi .env ga BACKUP_ENCRYPTION_KEY qo'shing (kamida 16 belgi)");
    if (!backupMirror) warnings.push("Zaxira faqat bitta joyda — .env ga BACKUP_MIRROR_DIR (boshqa disk yoki tarmoq papkasi) qo'shing");
    if (!secretsEncrypted) warnings.push("Bazadagi maxfiy ma'lumotlar (pasport, telefon, Telegram bot kaliti) shifrlanmagan — .env ga APP_ENCRYPTION_KEY qo'shing (kamida 32 belgi)");
    const hr = await hrCryptoStatus(this.prisma, false).catch(() => null);
    const hrPlain = hr?.plain ?? 0;
    const hrLocked = hr && !hr.ready ? hr.sealed : 0;
    if (secretsEncrypted && hrPlain > 0) warnings.push(`Ma'lumotnomalarda ${hrPlain} ta shaxsiy qiymat hali ochiq — Sozlamalar › Xavfsizlik › «Hozir shifrlash»`);
    if (hrLocked > 0) warnings.push(`Ma'lumotnomalardagi ${hrLocked} ta shifrlangan qiymatni ochib bo'lmaydi — serverda APP_ENCRYPTION_KEY yo'q`);
    return { viewerPersonal: await this.viewerPersonal(), deletePasswordDefault, chatCodeDefault, backupEncrypted, backupMirror, secretsEncrypted, hrPlain, hrLocked, warnings };
  }
}