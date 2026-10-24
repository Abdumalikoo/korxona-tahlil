import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
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
  /** Almashtirilishi kerak bo'lgan standart qiymatlar (ekranda ogohlantirish uchun) */
  warnings: string[];
}

@Injectable()
export class SecurityService {
  private cache: { value: boolean; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    return { viewerPersonal: await this.viewerPersonal(), deletePasswordDefault, chatCodeDefault, warnings };
  }
}