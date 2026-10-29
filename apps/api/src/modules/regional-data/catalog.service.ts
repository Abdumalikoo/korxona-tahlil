import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRAL_REGION, cleanText, parseDay, parseTiyin, periodDays, shiftPeriod, currentPeriod, ymd } from './rd.util';
import { REGION_GENERAL } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Ma'lumotnomalar:
//  • Voqealar jurnali — tarif o'zgarishi, qayta tuzilish, yangi xizmat… Prognoz va salohiyat
//    «uzilish» belgilangan voqea sanasidan oldingi oylarni hisobga olmaydi.
//  • Xizmat tariflari — Hududchi taklif qiladi, administrator tasdiqlaydi; amal qilish sanasi bilan.
//    Yonida — yuklangan ma'lumotdan haqiqiy o'rtacha narx (summa / soni), solishtirish uchun.
// ═══════════════════════════════════════════════════════════

export const EVENT_KINDS: Record<string, string> = {
  TARIFF: "Tarif o'zgarishi",
  RESTRUCTURE: 'Qayta tuzilish',
  NEW_SERVICE: 'Yangi xizmat',
  STAFF: "Xodimlar o'zgarishi",
  OTHER: 'Boshqa',
};

export interface EventInput {
  date?: string;
  kind?: string;
  regionCode?: number | null;
  categoryCode?: string | null;
  title?: string;
  description?: string | null;
  isBreak?: boolean;
}

export interface TariffInput {
  categoryCode?: string;
  regionCode?: number | null;
  priceTiyin?: string | number;
  validFrom?: string;
  note?: string | null;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async names() {
    const [regions, services] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: 'SRV_' } }, select: { code: true, label: true, order: true }, orderBy: { order: 'asc' } }),
    ]);
    return { regions: new Map(regions.map((r) => [r.code, r.name])), services: new Map(services.map((s) => [s.code, s.label])), serviceList: services };
  }

  private async checkRefs(regionCode: number | null, categoryCode: string | null) {
    if (regionCode !== null) {
      const r = await this.prisma.region.findUnique({ where: { code: regionCode } });
      if (!r || regionCode === CENTRAL_REGION || regionCode === REGION_GENERAL) throw new BadRequestException('Hudud topilmadi');
    }
    if (categoryCode !== null) {
      const c = await this.prisma.incomeCategory.findUnique({ where: { code: categoryCode } });
      if (!c || !categoryCode.startsWith('SRV_')) throw new BadRequestException('Xizmat turi topilmadi');
    }
  }

  // ─────────── Voqealar ───────────

  async events() {
    const [rows, n] = await Promise.all([this.prisma.analysisEvent.findMany({ where: { deletedAt: null }, orderBy: { date: 'desc' }, take: 500 }), this.names()]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    const un = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      date: ymd(r.date),
      kind: r.kind,
      kindLabel: EVENT_KINDS[r.kind] ?? r.kind,
      regionCode: r.regionCode,
      regionName: r.regionCode === null ? 'Barcha hududlar' : (n.regions.get(r.regionCode) ?? String(r.regionCode)),
      categoryCode: r.categoryCode,
      categoryLabel: r.categoryCode ? (n.services.get(r.categoryCode) ?? r.categoryCode) : 'Barcha xizmatlar',
      title: r.title,
      description: r.description,
      isBreak: r.isBreak,
      by: un.get(r.createdById) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private cleanEvent(input: EventInput) {
    const date = parseDay(input.date, 'Voqea sanasi');
    const kind = String(input.kind ?? '');
    if (!EVENT_KINDS[kind]) throw new BadRequestException('Voqea turini tanlang');
    const title = cleanText(input.title, 200, 'Sarlavha');
    if (!title || title.length < 3) throw new BadRequestException('Voqeani qisqa yozing (sarlavha)');
    const regionCode = input.regionCode === null || input.regionCode === undefined || (input.regionCode as unknown) === '' ? null : Number(input.regionCode);
    if (regionCode !== null && !Number.isInteger(regionCode)) throw new BadRequestException('Hudud noto‘g‘ri');
    const categoryCode = input.categoryCode ? String(input.categoryCode) : null;
    return { date, kind, title, description: cleanText(input.description, 1000, 'Izoh'), regionCode, categoryCode, isBreak: input.isBreak !== false };
  }

  async createEvent(input: EventInput, userId: string) {
    const d = this.cleanEvent(input);
    await this.checkRefs(d.regionCode, d.categoryCode);
    const row = await this.prisma.analysisEvent.create({ data: { ...d, createdById: userId } });
    await this.audit.log({ userId, action: 'CREATE', entity: 'analysis_event', entityId: row.id, summary: `Voqea: ${ymd(d.date)} — ${d.title}` });
    return (await this.events()).find((e) => e.id === row.id)!;
  }

  async updateEvent(id: string, input: EventInput, userId: string) {
    const row = await this.prisma.analysisEvent.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('Voqea topilmadi');
    const d = this.cleanEvent(input);
    await this.checkRefs(d.regionCode, d.categoryCode);
    await this.prisma.analysisEvent.update({ where: { id }, data: d });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'analysis_event', entityId: id, summary: `Voqea o'zgartirildi: ${d.title}` });
    return (await this.events()).find((e) => e.id === id)!;
  }

  async deleteEvent(id: string, userId: string) {
    const row = await this.prisma.analysisEvent.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('Voqea topilmadi');
    await this.prisma.analysisEvent.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'analysis_event', entityId: id, summary: `Voqea o'chirildi: ${row.title}` });
    return { ok: true as const };
  }

  // ─────────── Tariflar ───────────

  /** Xizmatlar: amaldagi tasdiqlangan tarif, kutilayotgan takliflar, oxirgi oy haqiqiy o'rtacha narxi */
  async tariffs() {
    const n = await this.names();
    const services = n.serviceList.filter((s) => /^SRV_\d{2}$/.test(s.code));
    const rows = await this.prisma.serviceTariff.findMany({ orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }] });
    const today = new Date();
    // Haqiqiy narx: oxirgi ma'lumotli oy (joriy oydan oldingi 3 oy ichida), summa / soni
    const months = [1, 2, 3].map((k) => shiftPeriod(currentPeriod(), -k));
    const incomes = await this.prisma.income.findMany({
      where: { deletedAt: null, source: 'IMPORT', regionCode: { not: null }, period: { in: months } },
      select: { period: true, categoryCode: true, amountTiyin: true, quantity: true },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.createdById, r.decidedById].filter((x): x is string => Boolean(x))))] } }, select: { id: true, fullName: true } });
    const un = new Map(users.map((u) => [u.id, u.fullName]));
    const view = (r: (typeof rows)[number]) => ({
      id: r.id,
      categoryCode: r.categoryCode,
      regionCode: r.regionCode,
      regionName: r.regionCode === null ? 'Barcha hududlar' : (n.regions.get(r.regionCode) ?? String(r.regionCode)),
      priceTiyin: r.priceTiyin.toString(),
      validFrom: ymd(r.validFrom),
      status: r.status,
      note: r.note,
      by: un.get(r.createdById) ?? null,
      decidedBy: r.decidedById ? (un.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
    });
    return services.map((s) => {
      const mine = rows.filter((r) => r.categoryCode === s.code);
      const current = mine.find((r) => r.status === 'APPROVED' && r.regionCode === null && r.validFrom <= today) ?? null;
      let actual: { period: string; priceTiyin: string; quantity: number } | null = null;
      for (const m of months) {
        const xs = incomes.filter((i) => i.period === m && i.categoryCode === s.code);
        const q = xs.reduce((a, i) => a + (i.quantity ?? 0), 0);
        const amt = xs.reduce((a, i) => a + i.amountTiyin, 0n);
        if (q > 0) {
          actual = { period: m, priceTiyin: (amt / BigInt(q)).toString(), quantity: q };
          break;
        }
      }
      return {
        code: s.code,
        label: s.label,
        current: current ? view(current) : null,
        pending: mine.filter((r) => r.status === 'PROPOSED').map(view),
        history: mine.filter((r) => r.status !== 'PROPOSED').slice(0, 10).map(view),
        actual,
      };
    });
  }

  async proposeTariff(input: TariffInput, userId: string) {
    const categoryCode = String(input.categoryCode ?? '');
    const regionCode = input.regionCode === null || input.regionCode === undefined || (input.regionCode as unknown) === '' ? null : Number(input.regionCode);
    await this.checkRefs(regionCode, categoryCode || '-');
    const priceTiyin = parseTiyin(input.priceTiyin, 'Tarif');
    const validFrom = parseDay(input.validFrom, 'Amal qilish sanasi');
    const row = await this.prisma.serviceTariff.create({ data: { categoryCode, regionCode, priceTiyin, validFrom, note: cleanText(input.note, 300, 'Izoh'), status: 'PROPOSED', createdById: userId } });
    await this.audit.log({ userId, action: 'CREATE', entity: 'service_tariff', entityId: row.id, summary: `Tarif taklifi: ${categoryCode} — ${(Number(priceTiyin) / 100).toLocaleString('ru-RU')} so'm, ${ymd(validFrom)} dan` });
    return { id: row.id };
  }

  /** Administrator: tasdiqlash yoki rad etish */
  async decideTariff(id: string, approve: boolean, userId: string, role: string) {
    if (role !== 'ADMIN') throw new ForbiddenException('Tarifni faqat administrator tasdiqlaydi');
    const row = await this.prisma.serviceTariff.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Taklif topilmadi');
    if (row.status !== 'PROPOSED') throw new BadRequestException("Bu taklif allaqachon ko'rib chiqilgan");
    await this.prisma.serviceTariff.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: userId, decidedAt: new Date() } });
    if (approve) {
      // Tasdiqlangan tarif — voqealar jurnaliga ham yoziladi (prognozda uzilish nuqtasi)
      const exists = await this.prisma.analysisEvent.findFirst({ where: { kind: 'TARIFF', categoryCode: row.categoryCode, date: row.validFrom, deletedAt: null } });
      if (!exists) {
        await this.prisma.analysisEvent.create({
          data: { date: row.validFrom, kind: 'TARIFF', regionCode: row.regionCode, categoryCode: row.categoryCode, title: `Yangi tarif: ${(Number(row.priceTiyin) / 100).toLocaleString('ru-RU')} so'm`, isBreak: true, createdById: userId },
        });
      }
    }
    await this.audit.log({ userId, action: 'UPDATE', entity: 'service_tariff', entityId: id, summary: `Tarif ${approve ? 'tasdiqlandi' : 'rad etildi'}: ${row.categoryCode}` });
    return { ok: true as const };
  }

  async deleteTariff(id: string, userId: string, role: string) {
    const row = await this.prisma.serviceTariff.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Taklif topilmadi');
    if (row.status !== 'PROPOSED' && role !== 'ADMIN') throw new ForbiddenException("Tasdiqlangan tarifni faqat administrator o'chiradi");
    await this.prisma.serviceTariff.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'service_tariff', entityId: id, summary: `Tarif yozuvi o'chirildi: ${row.categoryCode}` });
    return { ok: true as const };
  }

  /** Shu oyga tegishli uzilish voqealari (sifat tekshiruvi va prognoz uchun) */
  async eventsIn(period: string) {
    const { first, last } = periodDays(period);
    return this.prisma.analysisEvent.findMany({ where: { deletedAt: null, date: { gte: first, lte: last } } });
  }
}