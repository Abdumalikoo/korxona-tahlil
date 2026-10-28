import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseVedomostWorkbook, VED_COMPONENT_LABEL, type VedComponent, type VedPeriod, type VedSection } from './vedomost-3802.parse';

// ═══════════════════════════════════════════════════════════
// 3802 › Har oylik real bajarilgan ishlar: «3802 dan olingan pullar» fayli.
//  • Yuklash: fayl to'liq o'qiladi — undagi hamma oylar (varaq nomi / sarlavha bo'yicha), har oy uchun qaysi varaqlar
//    olinishi va nega olinmasligi (nusxa, boshqa versiya) ko'rsatiladi; hech narsa saqlanmaydi.
//  • Qabul qilish: foydalanuvchi tanlagan yil-oy oralig'i (from … to) — faqat shu oylar saqlanadi (fayl qayta o'qiladi);
//    avval saqlangan oy — almashtiriladi.
// Saqlash: settings «3802.ved.<YYYY-MM>» (oy: bo'limlar → xodimlar) va «3802.ved.index» (oylar ro'yxati) — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const VED_INDEX_KEY = '3802.ved.index';
export const vedKey = (period: string) => `3802.ved.${period}`;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_FILE_MONTHS = 240;

export interface VedIndexEntry {
  fileName: string;
  sheets: string[];
  savedAt: string;
  savedBy: string;
  employees: number;
  totalTiyin: string;
  okladTiyin: string;
  ustamaTiyin: string;
  warnings: string[];
}

interface VedStore {
  period: string;
  fileName: string;
  sheets: string[];
  savedAt: string;
  savedBy: string;
  sections: VedSection[];
}

@Injectable()
export class Vedomost3802Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async index(): Promise<Record<string, VedIndexEntry>> {
    const v = (await this.prisma.setting.findUnique({ where: { key: VED_INDEX_KEY } }))?.value as { periods?: Record<string, VedIndexEntry> } | null;
    return v?.periods && typeof v.periods === 'object' ? v.periods : {};
  }

  private async parse(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }
    const r = parseVedomostWorkbook(wb);
    if (r.periods.length > MAX_FILE_MONTHS) throw new BadRequestException(`Faylda oylar juda ko'p — ${MAX_FILE_MONTHS} tagacha`);
    return r;
  }

  private brief(p: VedPeriod) {
    return { period: p.period, used: p.used, skipped: p.skipped, sections: p.sections.length, employees: p.employees, totalTiyin: p.totalTiyin, okladTiyin: p.okladTiyin, ustamaTiyin: p.ustamaTiyin, warnings: p.warnings };
  }

  /** Faylni o'qish — hamma oylar (hech narsa saqlanmaydi); avval saqlangan oy — belgilanadi */
  async analyze(file: Express.Multer.File | undefined) {
    const { periods, unknown } = await this.parse(file);
    const idx = await this.index();
    return {
      fileName: String(file?.originalname ?? '3802.xlsx').slice(0, 200),
      from: periods[0]!.period,
      to: periods[periods.length - 1]!.period,
      periods: periods.map((p) => ({ ...this.brief(p), saved: idx[p.period] ? { fileName: idx[p.period]!.fileName, savedAt: idx[p.period]!.savedAt } : null })),
      unknown,
    };
  }

  /** Qabul qilish: from … to oralig'idagi oylar saqlanadi (fayl qayta o'qiladi); shu oylar avval bo'lsa — almashtiriladi */
  async commit(file: Express.Multer.File | undefined, fromRaw: unknown, toRaw: unknown, userId: string) {
    const from = typeof fromRaw === 'string' && PERIOD_RE.test(fromRaw) ? fromRaw : null;
    const to = typeof toRaw === 'string' && PERIOD_RE.test(toRaw) ? toRaw : null;
    if (!from || !to) throw new BadRequestException("Oraliqni tanlang: dan va gacha (yil-oy)");
    if (from > to) throw new BadRequestException("«Dan» oyi «Gacha»dan keyin bo'lmasin");
    const { periods } = await this.parse(file);
    const pick = periods.filter((p) => p.period >= from && p.period <= to);
    if (!pick.length) throw new BadRequestException(`Faylda ${from} … ${to} oralig'ida oy yo'q (faylda: ${periods[0]!.period} … ${periods[periods.length - 1]!.period})`);
    const fileName = String(file?.originalname ?? '3802.xlsx').slice(0, 200);
    const savedBy = (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
    const savedAt = new Date().toISOString();
    const replaced = await runExclusive(`setting:${VED_INDEX_KEY}`, async () => {
      const idx = await this.index();
      const was = pick.filter((p) => idx[p.period]).map((p) => p.period);
      await this.prisma.$transaction(async (tx) => {
        for (const p of pick) {
          const store: VedStore = { period: p.period, fileName, sheets: p.used, savedAt, savedBy, sections: p.sections };
          const value = store as unknown as object;
          await tx.setting.upsert({ where: { key: vedKey(p.period) }, create: { key: vedKey(p.period), value }, update: { value } });
          idx[p.period] = { fileName, sheets: p.used, savedAt, savedBy, employees: p.employees, totalTiyin: p.totalTiyin, okladTiyin: p.okladTiyin, ustamaTiyin: p.ustamaTiyin, warnings: p.warnings.slice(0, 20) };
        }
        const value = { periods: idx } as unknown as object;
        await tx.setting.upsert({ where: { key: VED_INDEX_KEY }, create: { key: VED_INDEX_KEY, value }, update: { value } });
      });
      return was;
    });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'vedomost_3802',
      entityId: `${from}..${to}`,
      summary: `3802 oylik vedomost qabul qilindi: ${fileName} — ${pick.length} oy (${pick[0]!.period} … ${pick[pick.length - 1]!.period})${replaced.length ? `, ${replaced.length} oy almashtirildi` : ''}`,
    });
    return { success: true as const, saved: pick.length, replaced: replaced.length, periods: pick.map((p) => p.period) };
  }

  /** Qabul qilingan oy(lar)ni o'chirish: from … to (bitta oy — from = to) */
  async remove(from: string, to: string, userId: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '') || from > to) throw new BadRequestException("Oylar noto'g'ri (YYYY-MM)");
    const removed = await runExclusive(`setting:${VED_INDEX_KEY}`, async () => {
      const idx = await this.index();
      const periods = Object.keys(idx).filter((p) => p >= from && p <= to);
      if (!periods.length) throw new NotFoundException(`${from === to ? from : `${from} … ${to}`} — qabul qilingan oy yo'q`);
      await this.prisma.$transaction(async (tx) => {
        await tx.setting.deleteMany({ where: { key: { in: periods.map(vedKey) } } });
        for (const p of periods) delete idx[p];
        const value = { periods: idx } as unknown as object;
        await tx.setting.upsert({ where: { key: VED_INDEX_KEY }, create: { key: VED_INDEX_KEY, value }, update: { value } });
      });
      return periods.sort();
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'vedomost_3802', entityId: `${from}..${to}`, summary: `3802 oylik vedomost o'chirildi: ${removed.length} oy (${removed[0]} … ${removed[removed.length - 1]})` });
    return { removed: removed.length, periods: removed };
  }

  /** Saqlangan oylar (eng yangisi oldin) */
  async list() {
    const idx = await this.index();
    return {
      periods: Object.entries(idx)
        .map(([period, e]) => ({ period, ...e }))
        .sort((a, b) => b.period.localeCompare(a.period)),
    };
  }

  /** Bitta oy: bo'limlar → xodimlar (qismlar bilan) — xodimlar ro'yxati (shaxsiy ma'lumot) */
  async detail(period: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const s = (await this.prisma.setting.findUnique({ where: { key: vedKey(period) } }))?.value as VedStore | undefined;
    if (!s?.sections) throw new NotFoundException(`${period} — vedomost qabul qilinmagan`);
    const used = new Set<VedComponent>();
    for (const sec of s.sections) for (const e of sec.employees) for (const k of Object.keys(e.amounts) as VedComponent[]) used.add(k);
    const order = Object.keys(VED_COMPONENT_LABEL) as VedComponent[];
    return {
      period: s.period,
      fileName: s.fileName,
      sheets: s.sheets,
      savedAt: s.savedAt,
      savedBy: s.savedBy,
      /** Shu oyda bor qismlar (ustunlar) */
      components: order.filter((c) => used.has(c)).map((c) => ({ code: c, label: VED_COMPONENT_LABEL[c] })),
      sections: s.sections.map((sec) => ({
        ...sec,
        okladTiyin: sec.employees.reduce((t, e) => t + BigInt(e.amounts.OKLAD ?? '0'), 0n).toString(),
        ustamaTiyin: sec.employees.reduce((t, e) => t + BigInt(e.amounts.USTAMA_40 ?? '0'), 0n).toString(),
      })),
    };
  }
}
