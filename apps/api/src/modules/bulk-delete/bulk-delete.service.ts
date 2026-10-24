import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { CenterIncomeService } from '../cashbook/center-income.service';
import { DeletePasswordService, PASSWORD_THRESHOLD } from './delete-password.service';
import { FixedAssetsService } from '../fixed-assets/fixed-assets.service';
import { LeaseMonthsService } from '../leases/leases.months';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodCloseService } from '../regional-data/period-close.service';
import { monthName } from '../regional-data/rd.util';
import { ENTRY_UNIT_CODES, entryUnitLabel, entryUnitWhere } from '../../common/segments/segments';
import { SalaryCompositionService } from '../salary-composition/salary-composition.service';
import { monthSpan } from '../../common/period';

// ═══════════════════════════════════════════════════════════
// Yagona «O'chirish» — xato kiritilgan yoki yuklangan ma'lumotni o'chirish (hamma bo'lim va rollar uchun bir xil).
//
// Nimani: daromad, xarajat, ish haqi vedomostlari, xodimlar reja/tushumi (Natijalar).
// Qanday tanlanadi: belgilangan qatorlar · bitta kun · bitta oy · sana oralig'i (+ bo'lim doirasi: hudud, tuman, manba…).
// Avval «ko'rib chiqish» (preview) — nechta yozuv, qancha summa, qaysi oy/hudud/manbadan; keyin tasdiqlab o'chirish.
//
//   • Daromad va xarajat — savatga tushadi (15 kun ichida Sozlamalar › Savatdan tiklanadi).
//   • Ish haqi vedomosti — bekor qilinadi (vedomostdan yozilgan ish haqi xarajati ham o'chadi).
//   • Natijalar (reja/tushum) — shu oy(lar) va hudud(lar) natijasi o'chiriladi, ish haqi guruhlari qayta hisoblanadi.
//   • Ijara — belgilangan shartnomalar (yozilgan oylik xarajatlari bilan) yoki tanlangan oy(lar) hisobi bekor qilinadi.
//   • Ish haqi tarkibi — shu oy(lar) tarkib yuklamasi bekor qilinadi (bayram, choraklik ajratmasi ham qaytadi).
//   • Kunlik tushum (Markaz tushumi) — kun(lar) ma'lumotnomasi o'chadi, keyingi kunlar va Markaz daromadi qayta hisoblanadi.
//   • Asosiy vositalar — qo'lda kiritilgan va xarajatdan olingan vositalar (sarfi bilan); ombordagisi — Ombor orqali.
//   • Mashinalar xarajatlari — shu yerda o'chiriladi: Mashinalar bo'limidagi yozuvi ham birga o'chadi
//     (savatdan tiklansa — yozuv ham qaytadi).
//   • «Hammasi» — daromad/xarajatning barcha davrlari (sahifa doirasida).
//   • Parol: «Hammasi» yoki 50 tadan ortiq yozuv o'chirilsa — o'chirish paroli so'raladi (Sozlamalar › Xavfsizlik).
//   • Boshqa hujjatdan kelgan xarajatlar (Ombor kirimi, Ijara, Ish haqi) bu yerda o'chirilmaydi —
//     ular o'z hujjati orqali bekor qilinadi (aks holda qoldiq va hisoblar buziladi); ko'rib chiqishda alohida ko'rsatiladi.
//   • Yopilgan oy (Hududchi › Oyni yopish) — hudud ma'lumoti o'zgartirilmaydi.
//   • Hududchi faqat hududlar ma'lumotini o'chiradi (Markaznikini emas).
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;
const DAY_MS = 86_400_000;
const MAX_IDS = 5000;
const MAX_DAYS = 3 * 366;

export type DeleteTarget = 'INCOME' | 'EXPENSE' | 'PAYROLL' | 'RESULTS' | 'LEASE' | 'COMPOSITION' | 'CASHBOOK' | 'ASSET' | 'TAX';
const TARGETS: DeleteTarget[] = ['INCOME', 'EXPENSE', 'PAYROLL', 'RESULTS', 'LEASE', 'COMPOSITION', 'CASHBOOK', 'ASSET', 'TAX'];
/** Oylik ma'lumot — «kun» bo'yicha tanlanmaydi */
const MONTHLY: DeleteTarget[] = ['PAYROLL', 'RESULTS', 'LEASE', 'COMPOSITION'];
/** Faqat administrator */
const ADMIN_ONLY: DeleteTarget[] = ['LEASE', 'COMPOSITION', 'CASHBOOK', 'ASSET', 'TAX'];
export type DeleteMode = 'ids' | 'day' | 'month' | 'range' | 'all';
/** «Hammasi» (barcha davrlar) — faqat daromad va xarajat */
const ALL_TARGETS: DeleteTarget[] = ['INCOME', 'EXPENSE'];

export interface DeleteScope {
  /** Faqat hududlar (Markaz kodi 0 dan tashqari) */
  regional?: boolean;
  regionCode?: number;
  districtId?: string;
  /** Manbalar: MANUAL, IMPORT … (daromad/xarajat) */
  sources?: string[];
  section?: 'DOIMIY' | 'BOSHQA';
  categoryCode?: string;
  /** Kiritish bo'limi: CENTER, REGION, TAX_FREE … QOMITA (faqat daromad / xarajat) */
  unit?: string;
}

export interface DeleteRequest {
  target: DeleteTarget;
  mode: DeleteMode;
  ids?: string[];
  day?: string;
  month?: string;
  from?: string;
  to?: string;
  scope?: DeleteScope;
  /** O'chirish paroli («Hammasi» yoki 50 tadan ortiq yozuv) */
  password?: string;
}

export interface Actor {
  id: string;
  role: string;
}

interface Group {
  key: string;
  label: string;
  count: number;
  totalTiyin: string;
}

export interface DeletePreview {
  target: DeleteTarget;
  mode: DeleteMode;
  /** Ekranda: «Oktyabr 2026», «14.10.2026», «01.01 — 31.03.2026», «12 ta tanlangan» */
  periodLabel: string;
  count: number;
  totalTiyin: string;
  byMonth: Group[];
  byRegion: Group[];
  bySource: Group[];
  /** Boshqa hujjatdan kelgan, bu yerda o'chirilmaydigan yozuvlar */
  locked: (Group & { where: string })[];
  /** Yopilgan oylar — o'chirib bo'lmaydi */
  closedMonths: string[];
  sample: { id: string; date: string; label: string; region: string; amountTiyin: string }[];
  /** Savatdan tiklash mumkinmi */
  restorable: boolean;
  /** O'chirish mumkinmi (count > 0, yopilgan oy yo'q) */
  allowed: boolean;
  reason: string | null;
  /** O'chirishdan oldin parol so'raladi */
  needsPassword?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Qo'lda kiritilgan",
  IMPORT: 'Fayldan yuklangan',
  PAYROLL: 'Ish haqi vedomosti',
  LEASE: 'Ijara',
  VEHICLE: 'Mashinalar',
  WAREHOUSE: 'Ombor kirimi / pochta',
  ASSET: 'Asosiy vositalar sarfi (avtomatik)',
  TAX: 'Soliqlar',
  KASSA: "Markaz tushumi (kunlik ma'lumotnoma)",
};
/** Xarajat manbalari: o'z hujjati orqali bekor qilinadi */
const LOCKED_EXPENSE: Record<string, string> = {
  PAYROLL: "Ish haqi vedomostini bekor qiling (shu oynada «Ish haqi vedomostlari» turi yoki Ish haqi bo'limi)",
  WAREHOUSE: 'Ombor › Hujjatlar — kirim hujjatini bekor qiling (qoldiq ham qaytadi)',
  LEASE: "Xarajatlar › Ijara — oy hisobini bekor qiling",
  ASSET: "Xarajatlar › Asosiy vositalar — vositani hisobdan chiqaring yoki xarajat qilib qoldiring (sarf o'zi qayta hisoblanadi)",
  TAX: "Xarajatlar › Soliqlar — o'sha sahifadagi «O'chirish» (ish haqidan foizli soliq o'zi hisoblanadi)",
};
/** Daromad manbalari: o'z joyida tuzatiladi */
const LOCKED_INCOME: Record<string, string> = {
  KASSA: "Buxgalteriya › Kunlik tushum — kunni tuzating yoki o'chiring (Markaz tushumi o'zi qayta hisoblanadi)",
};
const TARGET_LABEL: Record<DeleteTarget, string> = {
  INCOME: 'daromad',
  EXPENSE: 'xarajat',
  PAYROLL: 'ish haqi vedomosti',
  RESULTS: 'xodim natijasi (reja/tushum)',
  LEASE: 'ijara (shartnoma yoki oy hisobi)',
  COMPOSITION: 'ish haqi tarkibi yuklamasi',
  CASHBOOK: "kunlik tushum ma'lumotnomasi",
  ASSET: 'asosiy vosita',
  TAX: "soliq (qo'lda kiritilgan)",
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function dayStart(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - TASHKENT_MS);
}
function validDay(iso: string | undefined): iso is string {
  if (!iso || !ISO_DAY.test(iso)) return false;
  const t = dayStart(iso).getTime() + TASHKENT_MS;
  return new Date(t).toISOString().slice(0, 10) === iso;
}
function dmy(iso: string): string {
  return iso.split('-').reverse().join('.');
}
function localDay(d: Date): string {
  return new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}
@Injectable()
export class BulkDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly closes: PeriodCloseService,
    private readonly audit: AuditService,
    private readonly leaseMonths: LeaseMonthsService,
    private readonly composition: SalaryCompositionService,
    private readonly cashbook: CashbookService,
    private readonly centerIncome: CenterIncomeService,
    private readonly assets: FixedAssetsService,
    private readonly passwords: DeletePasswordService,
  ) {}

  // ─────────── So'rovni tekshirish ───────────

  private normalize(raw: DeleteRequest, actor: Actor): DeleteRequest & { scope: DeleteScope } {
    const target = raw?.target;
    const mode = raw?.mode;
    if (!TARGETS.includes(target)) throw new BadRequestException("Nimani o'chirish noto'g'ri");
    if (!['ids', 'day', 'month', 'range', 'all'].includes(mode)) throw new BadRequestException("Tanlash usuli noto'g'ri");
    if (mode === 'all' && !ALL_TARGETS.includes(target)) throw new BadRequestException("«Hammasi» faqat daromad va xarajat uchun");
    if (actor.role !== 'ADMIN' && actor.role !== 'HUDUDCHI') throw new ForbiddenException("O'chirish huquqi yo'q");
    if (ADMIN_ONLY.includes(target) && actor.role !== 'ADMIN') throw new ForbiddenException("Bu ma'lumotni faqat administrator o'chiradi");
    const s = raw.scope ?? {};
    const scope: DeleteScope = {
      regional: s.regional === true || actor.role === 'HUDUDCHI',
      regionCode: Number.isInteger(s.regionCode) ? s.regionCode : undefined,
      districtId: typeof s.districtId === 'string' && s.districtId ? s.districtId : undefined,
      sources: Array.isArray(s.sources) ? s.sources.filter((x): x is string => typeof x === 'string' && x in SOURCE_LABEL) : undefined,
      section: s.section === 'DOIMIY' || s.section === 'BOSHQA' ? s.section : undefined,
      categoryCode: typeof s.categoryCode === 'string' && s.categoryCode ? s.categoryCode : undefined,
      unit: typeof s.unit === 'string' && ENTRY_UNIT_CODES.includes(s.unit) ? s.unit : undefined,
    };
    if (s.unit !== undefined && !scope.unit) throw new BadRequestException("Bo'lim noto'g'ri");
    if (actor.role === 'HUDUDCHI' && scope.unit && scope.unit !== 'REGION') throw new ForbiddenException("Hududchi faqat hududlar ma'lumotini o'chiradi");
    if (actor.role === 'HUDUDCHI' && scope.regionCode === 0) throw new ForbiddenException("Hududchi Markaz ma'lumotini o'chira olmaydi");
    const req: DeleteRequest & { scope: DeleteScope } = { target, mode, scope };
    if (mode === 'ids') {
      const ids = Array.isArray(raw.ids) ? [...new Set(raw.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64))] : [];
      if (!ids.length) throw new BadRequestException("O'chirish uchun qatorlar belgilanmagan");
      if (ids.length > MAX_IDS) throw new BadRequestException(`Bir martada ${MAX_IDS} tadan ko'p emas`);
      req.ids = ids;
    } else if (mode === 'day') {
      if (MONTHLY.includes(target)) throw new BadRequestException("Bu ma'lumot oylik — oy yoki oraliqni tanlang");
      if (!validDay(raw.day)) throw new BadRequestException("Kunni tanlang (sana noto'g'ri)");
      req.day = raw.day;
    } else if (mode === 'month') {
      if (!raw.month || !ISO_MONTH.test(raw.month)) throw new BadRequestException('Oyni tanlang');
      req.month = raw.month;
    } else if (mode === 'range') {
      if (!validDay(raw.from) || !validDay(raw.to)) throw new BadRequestException("Sana oralig'ini to'liq tanlang");
      if (raw.from > raw.to) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
      if ((dayStart(raw.to).getTime() - dayStart(raw.from).getTime()) / DAY_MS > MAX_DAYS) throw new BadRequestException('Oraliq 3 yildan oshmasin');
      req.from = raw.from;
      req.to = raw.to;
    }
    return req;
  }

  private periodLabel(req: DeleteRequest): string {
    if (req.mode === 'ids') return `${req.ids!.length} ta belgilangan`;
    if (req.mode === 'day') return dmy(req.day!);
    if (req.mode === 'month') return monthName(req.month!);
    if (req.mode === 'all') return 'Barcha davrlar';
    return `${dmy(req.from!)} — ${dmy(req.to!)}`;
  }

  /** Daromad/xarajat uchun umumiy shart */
  private moneyWhere(req: DeleteRequest & { scope: DeleteScope }): Record<string, unknown> {
    const s = req.scope;
    const and: Record<string, unknown>[] = [{ deletedAt: null }];
    if (req.mode === 'ids') and.push({ id: { in: req.ids } });
    if (req.mode === 'day') and.push({ date: { gte: dayStart(req.day!), lt: new Date(dayStart(req.day!).getTime() + DAY_MS) } });
    if (req.mode === 'month') and.push({ period: req.month });
    if (req.mode === 'range') and.push({ date: { gte: dayStart(req.from!), lt: new Date(dayStart(req.to!).getTime() + DAY_MS) } });
    if (s.regionCode !== undefined) and.push({ regionCode: s.regionCode });
    else if (s.regional) and.push({ regionCode: { not: null } }, { NOT: { regionCode: 0 } });
    if (s.districtId) and.push({ districtId: s.districtId });
    if (s.sources?.length) and.push({ source: { in: s.sources } });
    if (s.section) and.push({ section: s.section });
    if (s.categoryCode) and.push({ categoryCode: s.categoryCode });
    // Bo'lim sahifasi (Xarajatlar / Daromadlar › Tax free …) — faqat shu bo'lim yozuvlari
    if (s.unit) and.push(entryUnitWhere(s.unit));
    return { AND: and };
  }

  private periodsOf(req: DeleteRequest): string[] | null {
    if (req.mode === 'month') return [req.month!];
    if (req.mode === 'range') return monthSpan(req.from!.slice(0, 7), req.to!.slice(0, 7), 60);
    return null;
  }

  private async closedOf(periods: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of [...new Set(periods)].sort()) if (await this.closes.isClosed(p)) out.push(p);
    return out;
  }

  private async names() {
    const regions = await this.prisma.region.findMany({ select: { code: true, name: true } });
    return new Map(regions.map((r) => [r.code, r.name]));
  }

  private group(rows: { key: string; label: string; amount: bigint }[]): Group[] {
    const m = new Map<string, { label: string; count: number; total: bigint }>();
    for (const r of rows) {
      const g = m.get(r.key) ?? { label: r.label, count: 0, total: 0n };
      g.count += 1;
      g.total += r.amount;
      m.set(r.key, g);
    }
    return [...m.entries()]
      .sort((a, b) => (b[1].total > a[1].total ? 1 : b[1].total < a[1].total ? -1 : 0))
      .map(([key, g]) => ({ key, label: g.label, count: g.count, totalTiyin: g.total.toString() }));
  }

  // ─────────── Ko'rib chiqish ───────────

  async preview(raw: DeleteRequest, actor: Actor): Promise<DeletePreview> {
    const req = this.normalize(raw, actor);
    const p = await this.previewOf(req, actor);
    return { ...p, needsPassword: p.allowed && (req.mode === 'all' || p.count > PASSWORD_THRESHOLD) };
  }

  private async previewOf(req: DeleteRequest & { scope: DeleteScope }, actor: Actor): Promise<DeletePreview> {
    if (req.target === 'INCOME' || req.target === 'EXPENSE') return this.previewMoney(req);
    if (req.target === 'PAYROLL') return this.previewPayroll(req, actor);
    if (req.target === 'LEASE') return this.previewLease(req);
    if (req.target === 'COMPOSITION') return this.previewComposition(req);
    if (req.target === 'CASHBOOK') return this.previewCashbook(req);
    if (req.target === 'ASSET') return this.previewAssets(req);
    if (req.target === 'TAX') return this.previewTax(req);
    return this.previewResults(req);
  }

  /** Bo'sh natija qolipi */
  private result(req: DeleteRequest, part: Partial<DeletePreview> & { count: number; totalTiyin: string; empty: string }): DeletePreview {
    const { empty, ...rest } = part;
    const reason = part.reason !== undefined ? part.reason : part.count ? null : empty;
    return {
      target: req.target,
      mode: req.mode,
      periodLabel: this.periodLabel(req),
      byMonth: [],
      byRegion: [],
      bySource: [],
      locked: [],
      closedMonths: [],
      sample: [],
      restorable: false,
      ...rest,
      allowed: reason === null,
      reason,
    };
  }

  /** Sana oralig'i (kun / oy / oraliq) */
  private dateRange(req: DeleteRequest): { gte: Date; lt: Date } | null {
    if (req.mode === 'day') return { gte: dayStart(req.day!), lt: new Date(dayStart(req.day!).getTime() + DAY_MS) };
    if (req.mode === 'month') {
      const [y, m] = req.month!.split('-').map(Number) as [number, number];
      return { gte: new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS), lt: new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - TASHKENT_MS) };
    }
    if (req.mode === 'range') return { gte: dayStart(req.from!), lt: new Date(dayStart(req.to!).getTime() + DAY_MS) };
    return null;
  }

  // ─────────── Ijara ───────────

  private async leaseData(req: DeleteRequest & { scope: DeleteScope }) {
    if (req.mode === 'ids') {
      const leases = await this.prisma.lease.findMany({
        where: { id: { in: req.ids }, deletedAt: null },
        select: { id: true, number: true, title: true, regionCode: true, lessorName: true },
      });
      const accruals = leases.length
        ? await this.prisma.leaseAccrual.findMany({ where: { leaseId: { in: leases.map((l) => l.id) } }, select: { id: true, leaseId: true, period: true, amountTiyin: true, closeId: true, expenseId: true } })
        : [];
      return { leases, accruals, closes: [] as { id: string; period: string; leaseCount: number; totalTiyin: bigint }[] };
    }
    const closes = await this.prisma.leaseMonthClose.findMany({
      where: { cancelledAt: null, period: { in: this.periodsOf(req)! } },
      select: { id: true, period: true, leaseCount: true, totalTiyin: true },
      orderBy: { period: 'asc' },
    });
    return { leases: [], accruals: [], closes };
  }

  private async previewLease(req: DeleteRequest & { scope: DeleteScope }): Promise<DeletePreview> {
    const [d, regionName] = await Promise.all([this.leaseData(req), this.names()]);
    if (req.mode === 'ids') {
      const sumOf = (id: string) => d.accruals.filter((a) => a.leaseId === id).reduce((s, a) => s + a.amountTiyin, 0n);
      const total = d.accruals.reduce((s, a) => s + a.amountTiyin, 0n);
      return this.result(req, {
        count: d.leases.length,
        totalTiyin: total.toString(),
        empty: "Belgilangan shartnoma topilmadi",
        byMonth: this.group(d.accruals.map((a) => ({ key: a.period, label: monthName(a.period), amount: a.amountTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
        byRegion: this.group(d.leases.map((l) => ({ key: String(l.regionCode), label: l.regionCode === 0 ? 'Markaz' : (regionName.get(l.regionCode) ?? `Hudud ${l.regionCode}`), amount: sumOf(l.id) }))),
        sample: d.leases.slice(0, 8).map((l) => ({ id: l.id, date: `№ ${l.number}`, label: `${l.title} — ${l.lessorName}`.slice(0, 120), region: l.regionCode === 0 ? 'Markaz' : (regionName.get(l.regionCode) ?? ''), amountTiyin: sumOf(l.id).toString() })),
      });
    }
    const total = d.closes.reduce((s, c) => s + c.totalTiyin, 0n);
    return this.result(req, {
      count: d.closes.length,
      totalTiyin: total.toString(),
      empty: "Tanlangan oy(lar)da yopilgan ijara hisobi yo'q",
      byMonth: d.closes.map((c) => ({ key: c.period, label: monthName(c.period), count: c.leaseCount, totalTiyin: c.totalTiyin.toString() })),
      sample: d.closes.slice(0, 8).map((c) => ({ id: c.id, date: c.period, label: `${monthName(c.period)} — ijara hisobi (${c.leaseCount} ta shartnoma)`, region: 'Hammasi', amountTiyin: c.totalTiyin.toString() })),
    });
  }

  private async deleteLease(req: DeleteRequest & { scope: DeleteScope }): Promise<number> {
    const d = await this.leaseData(req);
    if (req.mode !== 'ids') {
      for (const c of d.closes) await this.leaseMonths.cancel(c.period);
      return d.closes.length;
    }
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const expenseIds = d.accruals.map((a) => a.expenseId).filter((x): x is string => Boolean(x));
        if (expenseIds.length) await tx.expense.updateMany({ where: { id: { in: expenseIds }, deletedAt: null }, data: { deletedAt: now } });
        if (d.accruals.length) await tx.leaseAccrual.deleteMany({ where: { id: { in: d.accruals.map((a) => a.id) } } });
        // Yopilgan oylar yig'indisi yangilanadi
        for (const closeId of [...new Set(d.accruals.map((a) => a.closeId))]) {
          const left = await tx.leaseAccrual.findMany({ where: { closeId }, select: { amountTiyin: true } });
          await tx.leaseMonthClose.update({ where: { id: closeId }, data: { leaseCount: left.length, totalTiyin: left.reduce((s, a) => s + a.amountTiyin, 0n) } });
        }
        await tx.lease.updateMany({ where: { id: { in: d.leases.map((l) => l.id) } }, data: { deletedAt: now } });
      },
      { timeout: 60_000 },
    );
    return d.leases.length;
  }

  // ─────────── Ish haqi tarkibi ───────────

  private async compositionBatches(req: DeleteRequest) {
    return this.prisma.salaryCompositionBatch.findMany({
      where: { cancelledAt: null, ...(req.mode === 'ids' ? { id: { in: req.ids } } : { period: { in: this.periodsOf(req)! } }) },
      select: { id: true, period: true, fileName: true, employeeCount: true, totalTiyin: true, createdAt: true },
      orderBy: { period: 'asc' },
    });
  }

  private async previewComposition(req: DeleteRequest): Promise<DeletePreview> {
    const list = await this.compositionBatches(req);
    return this.result(req, {
      count: list.length,
      totalTiyin: list.reduce((s, b) => s + b.totalTiyin, 0n).toString(),
      empty: "Tanlangan oy(lar)da ish haqi tarkibi yuklanmagan",
      byMonth: this.group(list.map((b) => ({ key: b.period, label: monthName(b.period), amount: b.totalTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
      sample: list.slice(0, 8).map((b) => ({ id: b.id, date: localDay(b.createdAt), label: `${monthName(b.period)} · ${b.fileName ?? 'tarkib'} · ${b.employeeCount} xodim`, region: '', amountTiyin: b.totalTiyin.toString() })),
    });
  }

  // ─────────── Kunlik tushum (Markaz tushumi) ───────────

  private async cashReports(req: DeleteRequest) {
    const range = this.dateRange(req);
    // Kun sanasi UTC yarim tunida saqlanadi (YYYY-MM-DDT00:00Z)
    const where =
      req.mode === 'ids'
        ? { id: { in: req.ids } }
        : { date: { gte: new Date(range!.gte.getTime() + TASHKENT_MS), lt: new Date(range!.lt.getTime() + TASHKENT_MS) } };
    return this.prisma.cashReport.findMany({ where: where as Prisma.CashReportWhereInput, select: { id: true, date: true }, orderBy: { date: 'asc' } });
  }

  private async previewCashbook(req: DeleteRequest): Promise<DeletePreview> {
    const reports = await this.cashReports(req);
    const accounts = await this.cashbook.accounts();
    const daily = new Set(accounts.filter((a) => !a.isHeader && a.inputs.includes('daily')).map((a) => a.id));
    const lines = reports.length ? await this.prisma.cashReportLine.findMany({ where: { reportId: { in: reports.map((r) => r.id) } }, select: { reportId: true, accountId: true, dailyTiyin: true } }) : [];
    const dayTotal = new Map<string, bigint>();
    for (const l of lines) if (daily.has(l.accountId)) dayTotal.set(l.reportId, (dayTotal.get(l.reportId) ?? 0n) + (l.dailyTiyin ?? 0n));
    const total = [...dayTotal.values()].reduce((s, v) => s + v, 0n);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return this.result(req, {
      count: reports.length,
      totalTiyin: total.toString(),
      empty: "Tanlangan kun(lar)da kunlik ma'lumotnoma yo'q",
      byMonth: this.group(reports.map((r) => ({ key: iso(r.date).slice(0, 7), label: monthName(iso(r.date).slice(0, 7)), amount: dayTotal.get(r.id) ?? 0n }))).sort((a, b) => a.key.localeCompare(b.key)),
      sample: reports.slice(-8).map((r) => ({ id: r.id, date: iso(r.date), label: "Kunlik tushum ma'lumotnomasi", region: 'Markaz', amountTiyin: (dayTotal.get(r.id) ?? 0n).toString() })),
    });
  }

  // ─────────── Soliqlar (qo'lda kiritilganlari; ish haqidan foizlilari — o'zi hisoblanadi) ───────────

  private async taxRows(req: DeleteRequest & { scope: DeleteScope }) {
    const range = this.dateRange(req);
    const s = req.scope;
    return this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        source: 'TAX',
        ...(req.mode === 'ids' ? { id: { in: req.ids } } : { date: { gte: range!.gte, lt: range!.lt } }),
        ...(s.regionCode !== undefined ? { regionCode: s.regionCode } : {}),
        ...(s.categoryCode ? { categoryCode: s.categoryCode } : {}),
      },
      select: { id: true, date: true, period: true, amountTiyin: true, regionCode: true, description: true, documentNo: true },
      orderBy: { date: 'desc' },
    });
  }

  private async previewTax(req: DeleteRequest & { scope: DeleteScope }): Promise<DeletePreview> {
    const [rows, regionName] = await Promise.all([this.taxRows(req), this.names()]);
    const ok = rows.filter((r) => r.documentNo !== 'TAX-AUTO');
    const auto = rows.filter((r) => r.documentNo === 'TAX-AUTO');
    const regionOf = (c: number | null) => (c === null || c === 0 ? 'Markaz' : (regionName.get(c) ?? `Hudud ${c}`));
    return this.result(req, {
      count: ok.length,
      totalTiyin: ok.reduce((s, r) => s + r.amountTiyin, 0n).toString(),
      empty: auto.length ? "Tanlanganlarning hammasi ish haqidan avtomatik hisoblangan soliq — u vedomost bilan birga o'zgaradi" : "Tanlanganiga mos soliq yozuvi yo'q",
      byMonth: this.group(ok.map((r) => ({ key: r.period, label: monthName(r.period), amount: r.amountTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
      byRegion: this.group(ok.map((r) => ({ key: String(r.regionCode ?? 0), label: regionOf(r.regionCode), amount: r.amountTiyin }))),
      locked: this.group(auto.map((r) => ({ key: 'AUTO', label: 'Ish haqidan avtomatik (foiz)', amount: r.amountTiyin }))).map((g) => ({ ...g, where: "Xarajatlar › Soliqlar — soliq turini «qo'lda» qiling yoki ish haqi vedomostini o'zgartiring" })),
      sample: ok.slice(0, 8).map((r) => ({ id: r.id, date: localDay(r.date), label: (r.description ?? '').slice(0, 120), region: regionOf(r.regionCode), amountTiyin: r.amountTiyin.toString() })),
      restorable: true,
    });
  }

  // ─────────── Asosiy vositalar ───────────

  private async assetRows(req: DeleteRequest) {
    const range = this.dateRange(req);
    return this.prisma.fixedAsset.findMany({
      where: { deletedAt: null, ...(req.mode === 'ids' ? { id: { in: req.ids } } : { acquiredAt: { gte: range!.gte, lt: range!.lt } }) },
      select: { id: true, name: true, source: true, costTiyin: true, acquiredAt: true, inventoryNo: true, regionCode: true },
      orderBy: { acquiredAt: 'desc' },
    });
  }

  private async previewAssets(req: DeleteRequest): Promise<DeletePreview> {
    const [rows, regionName] = await Promise.all([this.assetRows(req), this.names()]);
    const ok = rows.filter((r) => r.source !== 'WAREHOUSE');
    const locked = rows.filter((r) => r.source === 'WAREHOUSE');
    const srcLabel: Record<string, string> = { MANUAL: "Qo'lda kiritilgan", EXPENSE: 'Xarajatdan olingan', WAREHOUSE: 'Ombor kirimi', IMPORT: "Excel'dan yuklangan (inventar)" };
    return this.result(req, {
      count: ok.length,
      totalTiyin: ok.reduce((s, r) => s + r.costTiyin, 0n).toString(),
      empty: locked.length ? "Tanlanganlarning hammasi Ombor vositasi — Ombor › Hujjatlar orqali bekor qilinadi" : "Tanlanganiga mos asosiy vosita yo'q",
      bySource: this.group(ok.map((r) => ({ key: r.source, label: srcLabel[r.source] ?? r.source, amount: r.costTiyin }))),
      locked: this.group(locked.map((r) => ({ key: 'WAREHOUSE', label: 'Ombor kirimi', amount: r.costTiyin }))).map((g) => ({ ...g, where: 'Ombor › Hujjatlar — kirim hujjatini bekor qiling yoki «Hisobdan chiqarish» qiling' })),
      sample: ok.slice(0, 8).map((r) => ({ id: r.id, date: localDay(r.acquiredAt), label: `${r.inventoryNo ? `${r.inventoryNo} · ` : ''}${r.name}`.slice(0, 120), region: r.regionCode && r.regionCode !== 0 ? (regionName.get(r.regionCode) ?? '') : 'Markaz', amountTiyin: r.costTiyin.toString() })),
    });
  }

  private async moneyRows(req: DeleteRequest & { scope: DeleteScope }) {
    const where = this.moneyWhere(req);
    const select = { id: true, date: true, period: true, amountTiyin: true, regionCode: true, source: true, description: true, categoryCode: true } as const;
    if (req.target === 'INCOME') {
      const rows = await this.prisma.income.findMany({ where: where as Prisma.IncomeWhereInput, select: { ...select, importBatchId: true }, orderBy: { date: 'desc' } });
      // Markaz tushumi (kunlik ma'lumotnomadan) — «KASSA» manbasi: o'z joyida tuzatiladi
      return rows.map(({ importBatchId, ...r }) => ({ ...r, source: importBatchId?.startsWith('kassa:') ? 'KASSA' : String(r.source) }));
    }
    return (await this.prisma.expense.findMany({ where: where as Prisma.ExpenseWhereInput, select, orderBy: { date: 'desc' } })).map((r) => ({ ...r, source: String(r.source) }));
  }

  private async previewMoney(req: DeleteRequest & { scope: DeleteScope }): Promise<DeletePreview> {
    const [rows, regionName] = await Promise.all([this.moneyRows(req), this.names()]);
    const isExpense = req.target === 'EXPENSE';
    const isLocked = (r: { source: string }) => (isExpense ? r.source in LOCKED_EXPENSE : r.source in LOCKED_INCOME);
    const ok = rows.filter((r) => !isLocked(r));
    const locked = rows.filter(isLocked);
    const regionOf = (c: number | null) => (c === null ? 'Biriktirilmagan' : c === 0 ? 'Markaz' : (regionName.get(c) ?? `Hudud ${c}`));
    const closedMonths = await this.closedOf(ok.filter((r) => r.regionCode !== null && r.regionCode !== 0).map((r) => r.period));
    const total = ok.reduce((s, r) => s + r.amountTiyin, 0n);
    const lockedGroups = this.group(locked.map((r) => ({ key: r.source, label: SOURCE_LABEL[r.source] ?? r.source, amount: r.amountTiyin }))).map((g) => ({ ...g, where: (isExpense ? LOCKED_EXPENSE : LOCKED_INCOME)[g.key] ?? '' }));
    const reason = !ok.length
      ? locked.length
        ? "Tanlangan yozuvlarning hammasi boshqa hujjatdan kelgan — ular o'z joyida bekor qilinadi"
        : "Tanlanganiga mos yozuv yo'q"
      : closedMonths.length
        ? `Yopilgan oy: ${closedMonths.map(monthName).join(', ')} — avval administrator oyni qayta ochsin`
        : null;
    return {
      target: req.target,
      mode: req.mode,
      periodLabel: this.periodLabel(req),
      count: ok.length,
      totalTiyin: total.toString(),
      byMonth: this.group(ok.map((r) => ({ key: r.period, label: monthName(r.period), amount: r.amountTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
      byRegion: this.group(ok.map((r) => ({ key: String(r.regionCode ?? '-'), label: regionOf(r.regionCode), amount: r.amountTiyin }))),
      bySource: this.group(ok.map((r) => ({ key: r.source, label: SOURCE_LABEL[r.source] ?? r.source, amount: r.amountTiyin }))),
      locked: lockedGroups,
      closedMonths: closedMonths.map(monthName),
      sample: ok.slice(0, 8).map((r) => ({ id: r.id, date: localDay(r.date), label: (r.description ?? '').slice(0, 120) || r.categoryCode, region: regionOf(r.regionCode), amountTiyin: r.amountTiyin.toString() })),
      restorable: true,
      allowed: reason === null,
      reason,
    };
  }

  private async payrollBatches(req: DeleteRequest & { scope: DeleteScope }, actor: Actor) {
    const where: Record<string, unknown> = { status: 'COMMITTED' };
    if (req.mode === 'ids') where.id = { in: req.ids };
    else where.period = { in: this.periodsOf(req) };
    if (req.scope.regional || actor.role === 'HUDUDCHI') where.scope = 'REGIONS';
    return this.prisma.payrollBatch.findMany({ where: where as Prisma.PayrollBatchWhereInput, select: { id: true, period: true, scope: true, fileName: true, totalTiyin: true, matchedRows: true, committedAt: true }, orderBy: { period: 'asc' } });
  }

  private async previewPayroll(req: DeleteRequest & { scope: DeleteScope }, actor: Actor): Promise<DeletePreview> {
    const batches = await this.payrollBatches(req, actor);
    const regional = batches.filter((b) => b.scope === 'REGIONS');
    const closedMonths = await this.closedOf(regional.map((b) => b.period));
    const total = batches.reduce((s, b) => s + b.totalTiyin, 0n);
    const scopeLabel = (s: string) => (s === 'REGIONS' ? 'Hududlar vedomosti' : 'Umumiy vedomost');
    const reason = !batches.length ? "Tanlanganiga mos vedomost yo'q" : closedMonths.length ? `Yopilgan oy: ${closedMonths.map(monthName).join(', ')} — avval administrator oyni qayta ochsin` : null;
    return {
      target: 'PAYROLL',
      mode: req.mode,
      periodLabel: this.periodLabel(req),
      count: batches.length,
      totalTiyin: total.toString(),
      byMonth: this.group(batches.map((b) => ({ key: b.period, label: monthName(b.period), amount: b.totalTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
      byRegion: [],
      bySource: this.group(batches.map((b) => ({ key: b.scope, label: scopeLabel(b.scope), amount: b.totalTiyin }))),
      locked: [],
      closedMonths: closedMonths.map(monthName),
      sample: batches.slice(0, 8).map((b) => ({
        id: b.id,
        date: b.committedAt ? localDay(b.committedAt) : b.period,
        label: `${monthName(b.period)} · ${b.fileName} · ${b.matchedRows} xodim`,
        region: scopeLabel(b.scope),
        amountTiyin: b.totalTiyin.toString(),
      })),
      restorable: false,
      allowed: reason === null,
      reason,
    };
  }

  private async resultRows(req: DeleteRequest & { scope: DeleteScope }) {
    const where: Record<string, unknown> = { batch: { cancelledAt: null } };
    if (req.mode === 'ids') where.batchId = { in: req.ids };
    else where.period = { in: this.periodsOf(req) };
    if (req.scope.regionCode !== undefined) where.regionCode = req.scope.regionCode;
    if (req.scope.districtId) where.districtId = req.scope.districtId;
    return this.prisma.employeeResult.findMany({
      where: where as Prisma.EmployeeResultWhereInput,
      select: { id: true, batchId: true, period: true, employeePinfl: true, regionCode: true, factTiyin: true },
    });
  }

  private async previewResults(req: DeleteRequest & { scope: DeleteScope }): Promise<DeletePreview> {
    const [rows, regionName] = await Promise.all([this.resultRows(req), this.names()]);
    const closedMonths = await this.closedOf(rows.map((r) => r.period));
    const total = rows.reduce((s, r) => s + r.factTiyin, 0n);
    const reason = !rows.length ? "Tanlanganiga mos natija yo'q" : closedMonths.length ? `Yopilgan oy: ${closedMonths.map(monthName).join(', ')} — avval administrator oyni qayta ochsin` : null;
    return {
      target: 'RESULTS',
      mode: req.mode,
      periodLabel: this.periodLabel(req),
      count: rows.length,
      totalTiyin: total.toString(),
      byMonth: this.group(rows.map((r) => ({ key: r.period, label: monthName(r.period), amount: r.factTiyin }))).sort((a, b) => a.key.localeCompare(b.key)),
      byRegion: this.group(rows.map((r) => ({ key: String(r.regionCode), label: regionName.get(r.regionCode) ?? `Hudud ${r.regionCode}`, amount: r.factTiyin }))),
      bySource: [],
      locked: [],
      closedMonths: closedMonths.map(monthName),
      sample: [],
      restorable: false,
      allowed: reason === null,
      reason,
    };
  }

  // ─────────── O'chirish ───────────

  async execute(raw: DeleteRequest, actor: Actor) {
    const req = this.normalize(raw, actor);
    const p = await this.preview(req, actor);
    if (!p.allowed) throw new BadRequestException(p.reason ?? "O'chirib bo'lmaydi");
    if (p.needsPassword) await this.passwords.verify(raw?.password, actor.id);
    let count = 0;
    if (req.target === 'INCOME' || req.target === 'EXPENSE') {
      const rows = await this.moneyRows(req);
      const ids = rows.filter((r) => !(req.target === 'EXPENSE' ? r.source in LOCKED_EXPENSE : r.source in LOCKED_INCOME)).map((r) => r.id);
      const data = { deletedAt: new Date() };
      if (req.target === 'EXPENSE') {
        // Mashinalar: yozuvi ham o'chadi (savatdan tiklansa — qaytadi); import kaliti bo'shatiladi — qayta yuklash mumkin
        const vehicleIds = rows.filter((r) => r.source === 'VEHICLE').map((r) => r.id);
        for (let i = 0; i < vehicleIds.length; i += 1000) {
          await this.prisma.vehicleRecord.updateMany({ where: { expenseId: { in: vehicleIds.slice(i, i + 1000) }, deletedAt: null }, data: { deletedAt: data.deletedAt, importKey: null } });
        }
      }
      const res =
        req.target === 'INCOME'
          ? await this.prisma.income.updateMany({ where: { id: { in: ids }, deletedAt: null }, data })
          : await this.prisma.expense.updateMany({ where: { id: { in: ids }, deletedAt: null, source: { notIn: Object.keys(LOCKED_EXPENSE) as never[] } }, data });
      count = res.count;
    } else if (req.target === 'PAYROLL') {
      for (const b of await this.payrollBatches(req, actor)) {
        await this.payroll.cancel(b.id);
        count += 1;
      }
    } else if (req.target === 'LEASE') {
      count = await this.deleteLease(req);
    } else if (req.target === 'COMPOSITION') {
      for (const b of await this.compositionBatches(req)) {
        await this.composition.cancel(b.id);
        count += 1;
      }
    } else if (req.target === 'CASHBOOK') {
      // Oxiridan boshlab — har o'chirishda keyingi kunlar zanjiri qayta hisoblanadi
      const reports = (await this.cashReports(req)).reverse();
      const touched = new Set<string>();
      for (const r of reports) {
        const iso = r.date.toISOString().slice(0, 10);
        await this.cashbook.remove(iso, actor.id);
        touched.add(iso);
        count += 1;
      }
      for (const iso of [...touched].sort()) await this.centerIncome.afterDayChange(iso, actor.id).catch(() => null);
    } else if (req.target === 'TAX') {
      const ids = (await this.taxRows(req)).filter((r) => r.documentNo !== 'TAX-AUTO').map((r) => r.id);
      count = (await this.prisma.expense.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } })).count;
    } else if (req.target === 'ASSET') {
      const ids = (await this.assetRows(req)).filter((r) => r.source !== 'WAREHOUSE').map((r) => r.id);
      const res = await this.prisma.fixedAsset.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
      count = res.count;
      await this.assets.sync().catch(() => null);
    } else {
      count = await this.deleteResults(req);
    }
    await this.audit.log({
      userId: actor.id,
      action: 'DELETE',
      entity: `bulk_${req.target.toLowerCase()}`,
      entityId: req.month ?? req.day ?? (req.from ? `${req.from}_${req.to}` : 'ids'),
      summary: `O'chirildi: ${count} ta ${TARGET_LABEL[req.target]} — ${p.periodLabel}, ${(Number(p.totalTiyin) / 100).toLocaleString('ru-RU')} so'm${req.scope.unit ? ` (${entryUnitLabel(req.scope.unit)})` : req.scope.regional ? ' (hududlar)' : ''}`,
    });
    return { count, totalTiyin: p.totalTiyin, restorable: p.restorable, periodLabel: p.periodLabel };
  }

  /** Natijalar: qatorlar o'chadi, eski yuklashlar yig'indisi yangilanadi (bo'sh qolsa — bekor), joylashuv tozalanadi */
  private async deleteResults(req: DeleteRequest & { scope: DeleteScope }): Promise<number> {
    const rows = await this.resultRows(req);
    if (!rows.length) return 0;
    const periods = [...new Set(rows.map((r) => r.period))];
    await this.prisma.$transaction(
      async (tx) => {
        await tx.employeeResult.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        for (const batchId of [...new Set(rows.map((r) => r.batchId))]) {
          const left = await tx.employeeResult.findMany({ where: { batchId }, select: { planTiyin: true, factTiyin: true, bonusTiyin: true } });
          if (!left.length) await tx.resultBatch.update({ where: { id: batchId }, data: { cancelledAt: new Date() } });
          else
            await tx.resultBatch.update({
              where: { id: batchId },
              data: {
                totalRows: left.length,
                planTiyin: left.reduce((s, x) => s + x.planTiyin, 0n),
                factTiyin: left.reduce((s, x) => s + x.factTiyin, 0n),
                bonusTiyin: left.reduce((s, x) => s + x.bonusTiyin, 0n),
              },
            });
        }
        for (const period of periods) {
          const pins = rows.filter((r) => r.period === period).map((r) => r.employeePinfl);
          await tx.employeeLocation.deleteMany({ where: { period, source: 'RESULTS', employeePinfl: { in: pins } } });
        }
      },
      { timeout: 120_000 },
    );
    for (const period of periods) await this.payroll.regroup(period).catch(() => null);
    return rows.length;
  }
}