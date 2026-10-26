import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Soliqlar — hamma soliqlar bir joyda (turlarini o'zingiz qo'shasiz).
//
//   • Soliq turi: nomi, hisoblash usuli, «Markaz hisobidan»mi, faolmi. Turlar «settings»da (kalit: tax.types),
//     har tur — o'z xarajat moddasi (SOLIQ_<KOD>, ota modda «Soliqlar»).
//   • Usullar:
//       MANUAL           — har oy summa kiritiladi (jadval: hudud/Markaz × soliq turi; Excel shablon ham bor);
//       PAYROLL_PERCENT  — ish haqidan foiz (masalan ijtimoiy soliq 12%): har oy vedomostdan avtomatik,
//                          xodim ishlagan hudud (Markazda — bo'lim) bo'yicha.
//       Daromaddan foiz (har qanday turga, faqat belgilangan oylar uchun) — masalan QQS 2026-04: Markaz va har hudud
//                          daromadining 12% i; shu oylarda katak avtomatik (qo'lda kiritilmaydi), boshqa oylarda — o'z usuli.
//   • Yozuvlar — Xarajatlar jadvalida (source = TAX): Tahlil, Solishtirma, hisobotlar o'zi ko'radi.
//     documentNo: «TAX» — qo'lda, «TAX-AUTO» — avtomatik (qayta hisoblanadi). Xarajatlar ro'yxatidan tahrirlanmaydi.
//   • «Markaz hisobidan» belgilangan tur — qaysi hududda yozilsa ham Markaz xarajati (Xarajatlar siyosati bilan bir xil).
// ═══════════════════════════════════════════════════════════

export const TAX_TYPES_KEY = 'tax.types';
export const TAX_PARENT = { code: 'SOLIQLAR', label: 'Soliqlar' };
const CENTRAL = 0;
const TASHKENT_MS = 5 * 3600_000;
const MANUAL_TAG = 'TAX';
const AUTO_TAG = 'TAX-AUTO';
const XLSX_UNIT_COL = 'Hudud / Markaz';

export type TaxMethod = 'MANUAL' | 'PAYROLL_PERCENT';

export interface TaxType {
  code: string;
  name: string;
  method: TaxMethod;
  /** Foiz (PAYROLL_PERCENT uchun), masalan 12 */
  rate: number | null;
  /** Qaysi hududda yozilsa ham Markaz xarajati */
  center: boolean;
  active: boolean;
  order: number;
  /** Daromaddan foiz: shu oylarda (incomePeriods) summa = hudud / Markaz daromadi × foiz */
  incomeRate?: number | null;
  incomePeriods?: string[];
}

/** Bir martalik sozlama: QQS 2026-04 — daromadning 12% i (foydalanuvchi so'rovi) */
const QQS_APRIL_KEY = 'tax.qqs-2026-04.applied';

export const DEFAULT_TAX_TYPES: TaxType[] = [
  { code: 'IJTIMOIY', name: 'Ijtimoiy soliq', method: 'PAYROLL_PERCENT', rate: 12, center: false, active: true, order: 10 },
  { code: 'QQS', name: "Qo'shilgan qiymat solig'i (QQS)", method: 'MANUAL', rate: null, center: true, active: true, order: 20, incomeRate: 12, incomePeriods: ['2026-04'] },
  { code: 'FOYDA', name: "Foyda solig'i", method: 'MANUAL', rate: null, center: true, active: true, order: 30 },
  { code: 'MOLMULK', name: "Mol-mulk solig'i", method: 'MANUAL', rate: null, center: false, active: true, order: 40 },
  { code: 'YER', name: "Yer solig'i", method: 'MANUAL', rate: null, center: false, active: true, order: 50 },
  { code: 'SUV', name: "Suv resurslaridan foydalanganlik uchun soliq", method: 'MANUAL', rate: null, center: false, active: true, order: 60 },
  { code: 'BOSHQA', name: "Boshqa soliq va yig'imlar", method: 'MANUAL', rate: null, center: false, active: true, order: 90 },
];

export const taxCategory = (code: string) => `SOLIQ_${code}`;

export interface TaxUnit {
  key: string;
  regionCode: number;
  departmentId: string | null;
  name: string;
}

export interface TaxCell {
  amountTiyin: string;
  /** Avtomatik: hisob asosi (ish haqi fondi yoki daromad) */
  baseTiyin?: string;
}

/** Shu oyda daromaddan hisoblanadimi */
export function incomeAuto(t: TaxType, period: string): boolean {
  return Boolean(t.active && t.incomeRate && t.incomeRate > 0 && t.incomePeriods?.includes(period));
}

function cleanPeriods(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim()).filter((x) => /^\d{4}-(0[1-9]|1[0-2])$/.test(x)))].sort();
}

export interface TaxMonth {
  period: string;
  types: (TaxType & { categoryCode: string; totalTiyin: string; previousTiyin: string; incomeAuto: boolean })[];
  units: TaxUnit[];
  /** tur → birlik → qiymat */
  cells: Record<string, Record<string, TaxCell>>;
  totals: { totalTiyin: string; previousTiyin: string; autoTiyin: string; manualTiyin: string; centerTiyin: string; payrollTiyin: string; incomeTiyin: string };
  months: string[];
  /** tur → 12 oy */
  trend: Record<string, string[]>;
  hasPayroll: boolean;
}

export interface CellInput {
  type: string;
  unit: string;
  amountTiyin: string | number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const shift = (p: string, d: number) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + d;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
};
const periodEnd = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - TASHKENT_MS - 86_400_000);
};
const assertPeriod = (p: unknown): string => {
  if (typeof p !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
  return p;
};
const unitKey = (regionCode: number, departmentId: string | null) => (regionCode === CENTRAL ? (departmentId ? `d:${departmentId}` : 'center') : `r:${regionCode}`);
function parseTiyin(v: unknown): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'bigint') return v;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) throw new BadRequestException(`Summa noto'g'ri: ${s}`);
  return BigInt(s);
}

@Injectable()
export class TaxesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaxesService.name);
  private syncing: Promise<unknown> | null = null;
  /** Bir oy uchun bir vaqtda bitta hisob (ikki marta yozilmasin) */
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    setTimeout(
      () =>
        void this.applyQqsApril()
          .then(() => this.syncAll())
          .catch((e: unknown) => this.logger.warn(`Soliqlar: ${(e as Error).message}`)),
      10_000,
    );
  }

  /**
   * Bir marta: saqlangan soliq turlarida QQS ga «2026-04 — daromaddan 12%» qo'shiladi
   * (keyin foydalanuvchi o'zgartirsa yoki olib tashlasa — qayta qo'shilmaydi).
   */
  async applyQqsApril(): Promise<boolean> {
    const flag = await this.prisma.setting.findUnique({ where: { key: QQS_APRIL_KEY } });
    if (flag) return false;
    const row = await this.prisma.setting.findUnique({ where: { key: TAX_TYPES_KEY } });
    if (Array.isArray(row?.value)) {
      const list = (row!.value as unknown[]).map((x) => ({ ...(x as Record<string, unknown>) }));
      const qqs = list.find((x) => x.code === 'QQS') ?? list.find((x) => /qqs|qo.?shilgan qiymat/i.test(String(x.name ?? '')));
      if (qqs) {
        qqs.incomeRate = typeof qqs.incomeRate === 'number' && qqs.incomeRate > 0 ? qqs.incomeRate : 12;
        qqs.incomePeriods = cleanPeriods([...(Array.isArray(qqs.incomePeriods) ? qqs.incomePeriods : []), '2026-04']);
        await this.prisma.setting.update({ where: { key: TAX_TYPES_KEY }, data: { value: list as unknown as object } });
      }
    }
    await this.prisma.setting.upsert({ where: { key: QQS_APRIL_KEY }, create: { key: QQS_APRIL_KEY, value: { at: new Date().toISOString() } }, update: {} });
    this.logger.log("Soliqlar: QQS 2026-04 — daromadning 12% i (avtomatik) yoqildi");
    return true;
  }

  /** Yarim soatda bir: ish haqi o'zgargan bo'lsa — avtomatik soliqlar yangilanadi */
  @Interval(30 * 60_000)
  async tick(): Promise<void> {
    await this.syncAll().catch((e: unknown) => this.logger.warn(`Soliqlar: ${(e as Error).message}`));
  }

  // ═══════════ Turlar ═══════════

  async types(): Promise<TaxType[]> {
    const row = await this.prisma.setting.findUnique({ where: { key: TAX_TYPES_KEY } });
    const v = row?.value;
    if (!Array.isArray(v)) return DEFAULT_TAX_TYPES.map((t) => ({ ...t }));
    return (v as unknown[])
      .map((x) => x as Partial<TaxType>)
      .filter((x) => typeof x.code === 'string' && typeof x.name === 'string')
      .map((x, i) => ({
        code: x.code!,
        name: x.name!,
        method: (x.method === 'PAYROLL_PERCENT' ? 'PAYROLL_PERCENT' : 'MANUAL') as TaxMethod,
        rate: typeof x.rate === 'number' ? x.rate : null,
        center: x.center === true,
        active: x.active !== false,
        order: typeof x.order === 'number' ? x.order : (i + 1) * 10,
        incomeRate: typeof x.incomeRate === 'number' && x.incomeRate > 0 ? x.incomeRate : null,
        incomePeriods: cleanPeriods(x.incomePeriods),
      }))
      .sort((a, b) => a.order - b.order);
  }

  /** Soliq moddalari bazada bo'lsin (xarajat yozuvi moddaga bog'langan) */
  private async ensureCategories(types: TaxType[]): Promise<void> {
    const need = [TAX_PARENT.code, ...types.map((t) => taxCategory(t.code))];
    const have = new Map((await this.prisma.category.findMany({ where: { code: { in: need } }, select: { code: true, label: true, isActive: true } })).map((c) => [c.code, c]));
    if (!have.has(TAX_PARENT.code)) await this.prisma.category.create({ data: { code: TAX_PARENT.code, label: TAX_PARENT.label, isLeaf: false, isActive: true, behavior: 'FIXED', order: 780 } }).catch(() => null);
    for (const t of types) {
      const code = taxCategory(t.code);
      const c = have.get(code);
      if (!c) await this.prisma.category.create({ data: { code, label: t.name, parentCode: TAX_PARENT.code, isLeaf: true, isActive: true, behavior: 'FIXED', order: 780 + Math.round(t.order / 10) } }).catch(() => null);
      else if (c.label !== t.name) await this.prisma.category.update({ where: { code }, data: { label: t.name } }).catch(() => null);
    }
  }

  async saveTypes(input: unknown, userId: string): Promise<TaxType[]> {
    if (!Array.isArray(input)) throw new BadRequestException("Soliq turlari ro'yxati kerak");
    const before = await this.types();
    const seen = new Set<string>();
    const list: TaxType[] = input.map((raw, i) => {
      const x = (raw ?? {}) as Record<string, unknown>;
      const name = String(x.name ?? '').replace(/\s+/g, ' ').trim();
      if (name.length < 2) throw new BadRequestException(`${i + 1}-qator: soliq nomini yozing`);
      let code = String(x.code ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
      if (!code) {
        const base = name.toUpperCase().replace(/[ʼ‘’`']/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'SOLIQ';
        code = base;
        for (let k = 2; seen.has(code) || before.some((b) => b.code === code && b.name !== name); k += 1) code = `${base}_${k}`;
      }
      if (code.length > 24) throw new BadRequestException(`${name}: kod juda uzun`);
      if (seen.has(code)) throw new BadRequestException(`Kod takrorlangan: ${code}`);
      seen.add(code);
      const method: TaxMethod = x.method === 'PAYROLL_PERCENT' ? 'PAYROLL_PERCENT' : 'MANUAL';
      const rate = method === 'PAYROLL_PERCENT' ? Number(x.rate) : null;
      if (method === 'PAYROLL_PERCENT' && (!Number.isFinite(rate) || rate! <= 0 || rate! > 100)) throw new BadRequestException(`${name}: foiz 0 dan katta, 100 dan kichik bo'lsin`);
      const irRaw = x.incomeRate === null || x.incomeRate === undefined || x.incomeRate === '' ? null : Number(x.incomeRate);
      if (irRaw !== null && (!Number.isFinite(irRaw) || irRaw <= 0 || irRaw > 100)) throw new BadRequestException(`${name}: daromaddan foiz 0 dan katta, 100 dan kichik bo'lsin`);
      const incomePeriods = cleanPeriods(x.incomePeriods);
      if (irRaw !== null && !incomePeriods.length) throw new BadRequestException(`${name}: daromaddan foiz qaysi oylar uchun — oyni kiriting (masalan 2026-04)`);
      return {
        code,
        name: name.slice(0, 120),
        method,
        rate: rate === null ? null : Math.round(rate * 100) / 100,
        center: x.center === true,
        active: x.active !== false,
        order: (i + 1) * 10,
        incomeRate: irRaw === null ? null : Math.round(irRaw * 100) / 100,
        incomePeriods: irRaw === null ? [] : incomePeriods,
      };
    });
    // O'chirilgan tur: yozuvi bo'lsa — o'chirilmaydi, faqat nofaol qilinadi
    for (const b of before) {
      if (list.some((t) => t.code === b.code)) continue;
      const used = await this.prisma.expense.count({ where: { categoryCode: taxCategory(b.code), deletedAt: null, documentNo: MANUAL_TAG } });
      if (used > 0) list.push({ ...b, active: false, order: 1000 + b.order });
    }
    await this.ensureCategories(list);
    await this.prisma.setting.upsert({ where: { key: TAX_TYPES_KEY }, create: { key: TAX_TYPES_KEY, value: list as unknown as object }, update: { value: list as unknown as object } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'tax_types', entityId: TAX_TYPES_KEY, summary: `Soliq turlari: ${list.filter((t) => t.active).map((t) => t.name).join(', ')}` });
    await this.syncAll();
    return this.types();
  }

  // ═══════════ Birliklar ═══════════

  private async units(): Promise<TaxUnit[]> {
    const regions = await this.prisma.region.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: 'asc' } });
    return [
      { key: 'center', regionCode: CENTRAL, departmentId: null, name: 'Markaz' },
      ...regions.filter((r) => r.code !== CENTRAL).map((r) => ({ key: `r:${r.code}`, regionCode: r.code, departmentId: null, name: r.name })),
    ];
  }

  // ═══════════ Avtomatik (ish haqidan foiz) ═══════════

  /** Oy ish haqi fondi: birlik (hudud / Markaz bo'limi) → to'liq ish haqi */
  private async payrollBase(period: string): Promise<Map<string, { regionCode: number; departmentId: string | null; base: bigint }>> {
    const out = new Map<string, { regionCode: number; departmentId: string | null; base: bigint }>();
    const entries = await this.prisma.payrollEntry.findMany({
      where: { period, deletedAt: null, batch: { status: 'COMMITTED' } },
      select: { employeePinfl: true, baseTiyin: true, bonusTiyin: true, totalTiyin: true },
    });
    if (!entries.length) return out;
    const pins = [...new Set(entries.map((e) => e.employeePinfl))];
    const [employees, locations] = await Promise.all([
      this.prisma.employee.findMany({ where: { pinfl: { in: pins } }, select: { pinfl: true, regionCode: true, departmentId: true } }),
      this.prisma.employeeLocation.findMany({ where: { period, employeePinfl: { in: pins } }, select: { employeePinfl: true, regionCode: true } }),
    ]);
    const emp = new Map(employees.map((e) => [e.pinfl, e]));
    const loc = new Map(locations.map((l) => [l.employeePinfl, l.regionCode]));
    // Shu oy joy o'zgarishlari (ish haqi tarkibi bo'yicha yoki bo'lim sahifasidan) — ish haqi xarajati qayerga
    // yozilgan bo'lsa, soliq ham o'sha yerga (ish haqi bilan bir xil qoida)
    const fixes = (((await this.prisma.setting.findUnique({ where: { key: `salary.composition.place.${period}` } }).catch(() => null))?.value as { fixes?: Record<string, { unit?: string; departmentId?: string | null; regionCode?: number | null }> } | null)?.fixes ?? {});
    for (const e of entries) {
      const full = e.baseTiyin === 0n ? e.totalTiyin + e.bonusTiyin : e.baseTiyin;
      if (full <= 0n) continue;
      const fx = fixes[e.employeePinfl];
      const fixedRegion = fx?.unit === 'REGION' && typeof fx.regionCode === 'number' && fx.regionCode > 0 ? fx.regionCode : fx?.unit === 'CENTER' ? CENTRAL : null;
      const regionCode = fixedRegion ?? loc.get(e.employeePinfl) ?? emp.get(e.employeePinfl)?.regionCode ?? CENTRAL;
      const departmentId = regionCode === CENTRAL ? ((fx?.unit === 'CENTER' ? fx.departmentId : null) ?? emp.get(e.employeePinfl)?.departmentId ?? null) : null;
      const key = unitKey(regionCode, departmentId);
      const u = out.get(key) ?? { regionCode, departmentId, base: 0n };
      u.base += full;
      out.set(key, u);
    }
    return out;
  }

  /** Oy daromadi: Markaz (bitta) va har hudud */
  private async incomeBase(period: string): Promise<Map<string, { regionCode: number; base: bigint }>> {
    const rows = await this.prisma.income.groupBy({ by: ['regionCode'], where: { period, deletedAt: null }, _sum: { amountTiyin: true } });
    const out = new Map<string, { regionCode: number; base: bigint }>();
    for (const r of rows) {
      const rc = r.regionCode ?? CENTRAL;
      const key = rc === CENTRAL ? 'center' : `r:${rc}`;
      const u = out.get(key) ?? { regionCode: rc, base: 0n };
      u.base += r._sum.amountTiyin ?? 0n;
      out.set(key, u);
    }
    for (const [k, u] of out) if (u.base <= 0n) out.delete(k);
    return out;
  }

  private async systemUserId(): Promise<string | null> {
    return (await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? (await this.prisma.user.findFirst({ select: { id: true } }))?.id ?? null;
  }

  /** Bir oy: avtomatik soliqlar qayta yoziladi (o'zgarmagan bo'lsa — tegilmaydi); shu oy uchun navbat bilan */
  async syncPeriod(period: string): Promise<number> {
    assertPeriod(period);
    const prev = this.locks.get(period) ?? Promise.resolve();
    const run = prev.catch(() => null).then(() => this.syncPeriodNow(period));
    this.locks.set(period, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(period) === run) this.locks.delete(period);
    }
  }

  private async syncPeriodNow(period: string): Promise<number> {
    const all = await this.types();
    const byIncome = all.filter((t) => incomeAuto(t, period));
    const types = all.filter((t) => t.method === 'PAYROLL_PERCENT' && t.active && t.rate && !byIncome.includes(t));
    const base = types.length ? await this.payrollBase(period) : new Map();
    const income = byIncome.length ? await this.incomeBase(period) : new Map<string, { regionCode: number; base: bigint }>();
    const want: { categoryCode: string; regionCode: number; departmentId: string | null; amount: bigint; base: bigint; name: string; rate: number; from: 'payroll' | 'income' }[] = [];
    for (const t of types) {
      const bp = BigInt(Math.round(t.rate! * 100));
      for (const u of base.values()) {
        const amount = (u.base * bp + 5000n) / 10000n;
        if (amount > 0n) want.push({ categoryCode: taxCategory(t.code), regionCode: u.regionCode, departmentId: u.departmentId, amount, base: u.base, name: t.name, rate: t.rate!, from: 'payroll' });
      }
    }
    for (const t of byIncome) {
      const bp = BigInt(Math.round(t.incomeRate! * 100));
      for (const u of income.values()) {
        const amount = (u.base * bp + 5000n) / 10000n;
        if (amount > 0n) want.push({ categoryCode: taxCategory(t.code), regionCode: u.regionCode, departmentId: null, amount, base: u.base, name: t.name, rate: t.incomeRate!, from: 'income' });
      }
    }
    // Daromaddan hisoblanadigan oyda shu turning qo'lda yozuvlari ikki marta sanalmasin — savatga
    if (byIncome.length) {
      const cats = byIncome.map((t) => taxCategory(t.code));
      const manual = await this.prisma.expense.findMany({ where: { period, source: 'TAX', documentNo: MANUAL_TAG, deletedAt: null, categoryCode: { in: cats } }, select: { id: true } });
      if (manual.length) {
        await this.prisma.expense.updateMany({ where: { id: { in: manual.map((x) => x.id) } }, data: { deletedAt: new Date() } });
        this.logger.log(`Soliqlar ${period}: daromaddan hisoblanadigan turlarning ${manual.length} ta qo'lda yozuvi savatga o'tkazildi`);
      }
    }
    const have = await this.prisma.expense.findMany({
      where: { period, source: 'TAX', documentNo: AUTO_TAG, deletedAt: null },
      select: { id: true, categoryCode: true, regionCode: true, departmentId: true, amountTiyin: true },
    });
    const sig = (l: { categoryCode: string; regionCode: number | null; departmentId: string | null; amount: bigint }[]) => l.map((x) => `${x.categoryCode}|${x.regionCode}|${x.departmentId ?? ''}|${x.amount}`).sort().join(';');
    if (sig(want) === sig(have.map((h) => ({ ...h, amount: h.amountTiyin })))) return 0;
    const userId = await this.systemUserId();
    if (want.length && !userId) return 0;
    if (want.length) await this.ensureCategories(await this.types());
    const [regions, depts] = await Promise.all([this.prisma.region.findMany({ select: { code: true, name: true } }), this.prisma.department.findMany({ select: { id: true, name: true } })]);
    const rn = new Map(regions.map((r) => [r.code, r.name]));
    const dn = new Map(depts.map((d) => [d.id, d.name]));
    const date = periodEnd(period);
    await this.prisma.$transaction([
      this.prisma.expense.deleteMany({ where: { id: { in: have.map((h) => h.id) } } }),
      ...(want.length
        ? [
            this.prisma.expense.createMany({
              data: want.map((w) => ({
                date,
                period,
                amountTiyin: w.amount,
                categoryCode: w.categoryCode,
                regionCode: w.regionCode,
                departmentId: w.departmentId,
                description: `${w.name} ${String(w.rate).replace('.', ',')}% — ${w.regionCode === CENTRAL ? `Markaz${w.departmentId ? `: ${dn.get(w.departmentId) ?? "bo'lim"}` : ''}` : (rn.get(w.regionCode) ?? `Hudud ${w.regionCode}`)} ${w.from === 'income' ? 'daromadidan' : 'ish haqi fondidan'} (${(Number(w.base) / 100).toLocaleString('ru-RU')} so'm)`.slice(0, 500),
                documentNo: AUTO_TAG,
                paymentMethod: 'BANK' as const,
                paymentStatus: 'PAID' as const,
                source: 'TAX' as const,
                section: 'DOIMIY' as const,
                recurrence: 'RECURRING',
                createdById: userId!,
              })),
            }),
          ]
        : []),
    ]);
    return want.length;
  }

  /** Hamma oylar (ish haqi yoki avtomatik soliq bor) */
  async syncAll(): Promise<{ periods: number }> {
    if (this.syncing) return this.syncing as Promise<{ periods: number }>;
    const run = (async () => {
      const [batches, autos] = await Promise.all([
        this.prisma.payrollBatch.findMany({ where: { status: 'COMMITTED' }, select: { period: true }, distinct: ['period'] }),
        this.prisma.expense.findMany({ where: { source: 'TAX', documentNo: AUTO_TAG, deletedAt: null }, select: { period: true }, distinct: ['period'] }),
      ]);
      const incomeMonths = (await this.types()).flatMap((t) => (t.incomeRate ? (t.incomePeriods ?? []) : []));
      const periods = [...new Set([...batches.map((b) => b.period), ...autos.map((a) => a.period), ...incomeMonths])].sort();
      for (const p of periods) await this.syncPeriod(p);
      return { periods: periods.length };
    })();
    this.syncing = run;
    try {
      return await run;
    } finally {
      this.syncing = null;
    }
  }

  // ═══════════ Oy ko'rinishi ═══════════

  async month(periodInput: unknown): Promise<TaxMonth> {
    const period = assertPeriod(periodInput);
    await this.syncPeriod(period).catch(() => null);
    const [types, units] = await Promise.all([this.types(), this.units()]);
    const cats = new Map(types.map((t) => [taxCategory(t.code), t]));
    const months = Array.from({ length: 12 }, (_, i) => shift(period, i - 11));
    const prev = shift(period, -1);
    const rows = await this.prisma.expense.findMany({
      where: { deletedAt: null, categoryCode: { in: [...cats.keys()] }, period: { in: months } },
      select: { period: true, categoryCode: true, regionCode: true, departmentId: true, amountTiyin: true, documentNo: true, source: true },
    });
    const base = await this.payrollBase(period);
    const income = types.some((t) => incomeAuto(t, period)) ? await this.incomeBase(period) : new Map<string, { regionCode: number; base: bigint }>();
    const cells: Record<string, Record<string, TaxCell>> = {};
    const trend: Record<string, string[]> = {};
    const byType = new Map<string, { cur: bigint; prev: bigint }>();
    let auto = 0n;
    let manual = 0n;
    let center = 0n;
    const trendN: Record<string, bigint[]> = {};
    for (const t of types) trendN[t.code] = months.map(() => 0n);
    for (const r of rows) {
      const t = cats.get(r.categoryCode);
      if (!t) continue;
      const i = months.indexOf(r.period);
      if (i >= 0) trendN[t.code]![i]! += r.amountTiyin;
      const s = byType.get(t.code) ?? { cur: 0n, prev: 0n };
      if (r.period === period) s.cur += r.amountTiyin;
      if (r.period === prev) s.prev += r.amountTiyin;
      byType.set(t.code, s);
      if (r.period !== period) continue;
      const isAuto = r.documentNo === AUTO_TAG;
      if (isAuto) auto += r.amountTiyin;
      else manual += r.amountTiyin;
      const rc = r.regionCode ?? CENTRAL;
      if (t.center || rc === CENTRAL) center += r.amountTiyin;
      // Jadvalda Markaz bitta qator (bo'limlar yig'iladi)
      const key = rc === CENTRAL ? 'center' : `r:${rc}`;
      const byUnit = (cells[t.code] ??= {});
      const c = byUnit[key] ?? { amountTiyin: '0' };
      c.amountTiyin = (BigInt(c.amountTiyin) + r.amountTiyin).toString();
      byUnit[key] = c;
    }
    for (const t of types.filter((x) => incomeAuto(x, period))) {
      const byUnit = (cells[t.code] ??= {});
      for (const [key, u] of income) {
        const c = byUnit[key] ?? { amountTiyin: '0' };
        c.baseTiyin = (BigInt(c.baseTiyin ?? '0') + u.base).toString();
        byUnit[key] = c;
      }
    }
    for (const t of types.filter((x) => x.method === 'PAYROLL_PERCENT' && !incomeAuto(x, period))) {
      const byUnit = (cells[t.code] ??= {});
      for (const u of base.values()) {
        const key = u.regionCode === CENTRAL ? 'center' : `r:${u.regionCode}`;
        const c = byUnit[key] ?? { amountTiyin: '0' };
        c.baseTiyin = (BigInt(c.baseTiyin ?? '0') + u.base).toString();
        byUnit[key] = c;
      }
    }
    for (const t of types) trend[t.code] = trendN[t.code]!.map(String);
    const total = [...byType.values()].reduce((s, x) => s + x.cur, 0n);
    const previous = [...byType.values()].reduce((s, x) => s + x.prev, 0n);
    // Hududlar ro'yxatida bo'lmagan hudud yozuvi bo'lsa — qo'shiladi
    const unitKeys = new Set(units.map((u) => u.key));
    for (const byUnit of Object.values(cells)) for (const k of Object.keys(byUnit)) if (!unitKeys.has(k)) {
      unitKeys.add(k);
      units.push({ key: k, regionCode: Number(k.slice(2)), departmentId: null, name: `Hudud ${k.slice(2)}` });
    }
    return {
      period,
      types: types.map((t) => ({ ...t, categoryCode: taxCategory(t.code), totalTiyin: (byType.get(t.code)?.cur ?? 0n).toString(), previousTiyin: (byType.get(t.code)?.prev ?? 0n).toString(), incomeAuto: incomeAuto(t, period) })),
      units,
      cells,
      totals: {
        totalTiyin: total.toString(),
        previousTiyin: previous.toString(),
        autoTiyin: auto.toString(),
        manualTiyin: manual.toString(),
        centerTiyin: center.toString(),
        payrollTiyin: [...base.values()].reduce((s, u) => s + u.base, 0n).toString(),
        incomeTiyin: [...income.values()].reduce((s, u) => s + u.base, 0n).toString(),
      },
      months,
      trend,
      hasPayroll: base.size > 0,
    };
  }

  /** Qo'lda kiritiladigan soliqlar: berilgan kataklar yoziladi (0 yoki bo'sh — o'chiriladi) */
  async saveMonth(periodInput: unknown, input: unknown, userId: string): Promise<TaxMonth> {
    const period = assertPeriod(periodInput);
    const body = (input ?? {}) as { cells?: unknown };
    if (!Array.isArray(body.cells)) throw new BadRequestException("Kataklar ro'yxati kerak");
    const types = await this.types();
    const byCode = new Map(types.map((t) => [t.code, t]));
    const units = await this.units();
    const unitBy = new Map(units.map((u) => [u.key, u]));
    const cells = (body.cells as CellInput[]).map((c, i) => {
      const t = byCode.get(String(c?.type ?? ''));
      if (!t) throw new BadRequestException(`${i + 1}: soliq turi topilmadi`);
      if (t.method !== 'MANUAL') throw new BadRequestException(`${t.name} — ish haqidan avtomatik hisoblanadi, qo'lda kiritilmaydi`);
      if (incomeAuto(t, period)) throw new BadRequestException(`${t.name} — ${period} da daromaddan ${t.incomeRate}% avtomatik hisoblanadi, qo'lda kiritilmaydi`);
      const u = unitBy.get(String(c?.unit ?? ''));
      if (!u) throw new BadRequestException(`${i + 1}: hudud topilmadi`);
      const amount = parseTiyin(c.amountTiyin);
      if (amount !== null && amount < 0n) throw new BadRequestException(`${t.name}, ${u.name}: summa manfiy bo'lmasin`);
      return { t, u, amount: amount ?? 0n };
    });
    await this.ensureCategories(types);
    const date = periodEnd(period);
    let changed = 0;
    let total = 0n;
    await this.prisma.$transaction(
      async (tx) => {
        for (const c of cells) {
          const where = { period, categoryCode: taxCategory(c.t.code), regionCode: c.u.regionCode, departmentId: null, source: 'TAX' as const, documentNo: MANUAL_TAG, deletedAt: null };
          const existing = await tx.expense.findMany({ where, select: { id: true, amountTiyin: true } });
          const sum = existing.reduce((s, e) => s + e.amountTiyin, 0n);
          if (sum === c.amount && existing.length <= 1) continue;
          if (existing.length) await tx.expense.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
          if (c.amount > 0n) {
            await tx.expense.create({
              data: {
                date,
                period,
                amountTiyin: c.amount,
                categoryCode: taxCategory(c.t.code),
                regionCode: c.u.regionCode,
                departmentId: null,
                description: `${c.t.name} — ${c.u.name}`.slice(0, 500),
                documentNo: MANUAL_TAG,
                paymentMethod: 'BANK',
                paymentStatus: 'PAID',
                source: 'TAX',
                section: 'DOIMIY',
                recurrence: 'RECURRING',
                createdById: userId,
              },
            });
          }
          changed += 1;
          total += c.amount;
        }
      },
      { timeout: 60_000 },
    );
    if (changed) await this.audit.log({ userId, action: 'UPDATE', entity: 'taxes', entityId: period, summary: `Soliqlar ${period}: ${changed} ta katak o'zgardi (${(Number(total) / 100).toLocaleString('ru-RU')} so'm)` });
    return this.month(period);
  }

  /** Oldingi oy summalarini shu oyga ko'chirish (qo'lda kiritiladiganlar, shu oyda bo'sh kataklar) */
  async copyPrevious(periodInput: unknown, userId: string): Promise<TaxMonth> {
    const period = assertPeriod(periodInput);
    const prev = await this.month(shift(period, -1));
    const cur = await this.month(period);
    const cells: CellInput[] = [];
    for (const t of prev.types.filter((x) => x.method === 'MANUAL' && x.active && !incomeAuto(x, period))) {
      for (const [unit, c] of Object.entries(prev.cells[t.code] ?? {})) {
        if (BigInt(c.amountTiyin) <= 0n || BigInt(cur.cells[t.code]?.[unit]?.amountTiyin ?? '0') > 0n) continue;
        if (!cur.units.some((u) => u.key === unit)) continue;
        cells.push({ type: t.code, unit, amountTiyin: c.amountTiyin });
      }
    }
    if (!cells.length) throw new BadRequestException("O'tgan oyda ko'chiriladigan summa yo'q (yoki bu oy allaqachon to'ldirilgan)");
    return this.saveMonth(period, { cells }, userId);
  }

  // ═══════════ Excel ═══════════

  async template(periodInput: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const period = assertPeriod(periodInput);
    const m = await this.month(period);
    const manual = m.types.filter((t) => t.method === 'MANUAL' && t.active && !t.incomeAuto);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Soliqlar', { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
    ws.getCell(1, 1).value = `Soliqlar · ${period} · so'mda (kod: ${manual.map((t) => t.code).join(', ')})`;
    ws.getCell(1, 1).font = { bold: true };
    ws.getRow(2).values = [XLSX_UNIT_COL, ...manual.map((t) => t.name)];
    ws.getRow(2).font = { bold: true };
    ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
    // Kodlar — yashirin 3-qatorda (ustunlarni aniq topish uchun)
    ws.getRow(3).values = ['#', ...manual.map((t) => t.code)];
    ws.getRow(3).hidden = true;
    ws.getColumn(1).width = 34;
    manual.forEach((_, i) => {
      ws.getColumn(i + 2).width = 22;
      ws.getColumn(i + 2).numFmt = '#,##0.00';
    });
    m.units.forEach((u, r) => {
      const row = ws.getRow(4 + r);
      row.getCell(1).value = u.name;
      manual.forEach((t, i) => {
        const v = BigInt(m.cells[t.code]?.[u.key]?.amountTiyin ?? '0');
        row.getCell(i + 2).value = v ? Number(v) / 100 : null;
      });
    });
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Soliqlar-${period}.xlsx` };
  }

  /** Excel o'qiladi (saqlanmaydi): kataklar ro'yxati — sahifada ko'rib, saqlanadi */
  async parse(periodInput: unknown, file: Express.Multer.File | undefined): Promise<{ period: string; cells: CellInput[]; unknownUnits: string[]; unknownColumns: string[] }> {
    const period = assertPeriod(periodInput);
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx bo'lsin");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Faylda varaq yo'q");
    const types = (await this.types()).filter((t) => t.method === 'MANUAL' && !incomeAuto(t, period));
    const units = await this.units();
    const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[ʼ‘’`']/g, '').replace(/\s+/g, ' ').trim();
    const text = (v: ExcelJS.CellValue): string => (v && typeof v === 'object' ? ('result' in v ? String(v.result ?? '') : 'richText' in v ? v.richText.map((p) => p.text).join('') : 'text' in v ? String(v.text) : '') : String(v ?? ''));
    // Sarlavha qatori: «Hudud / Markaz» yozilgan qator
    let headerRow = 0;
    ws.eachRow((row, i) => {
      if (!headerRow && norm(text(row.getCell(1).value)).startsWith('hudud')) headerRow = i;
    });
    if (!headerRow) throw new BadRequestException("Sarlavha topilmadi — «Soliqlar» shablonidan foydalaning");
    const header = ws.getRow(headerRow);
    const codeRow = ws.getRow(headerRow + 1);
    const cols: { col: number; type: TaxType }[] = [];
    const unknownColumns: string[] = [];
    for (let c = 2; c <= Math.max(header.cellCount, 2); c += 1) {
      const name = text(header.getCell(c).value).trim();
      if (!name) continue;
      const code = text(codeRow.getCell(c).value).trim().toUpperCase();
      const t = types.find((x) => x.code === code) ?? types.find((x) => norm(x.name) === norm(name));
      if (t) cols.push({ col: c, type: t });
      else unknownColumns.push(name);
    }
    if (!cols.length) throw new BadRequestException("Soliq ustunlari topilmadi — nomlar Soliq turlaridagidek bo'lsin");
    const cells: CellInput[] = [];
    const unknownUnits: string[] = [];
    const start = text(codeRow.getCell(1).value).trim() === '#' ? headerRow + 2 : headerRow + 1;
    for (let r = start; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const name = text(row.getCell(1).value).trim();
      if (!name) continue;
      const u = units.find((x) => norm(x.name) === norm(name)) ?? (/^markaz/.test(norm(name)) ? units[0] : undefined);
      if (!u) {
        unknownUnits.push(name);
        continue;
      }
      for (const { col, type } of cols) {
        const raw = row.getCell(col).value;
        const t = text(raw).replace(/[\s ]/g, '').replace(',', '.');
        if (raw === null || raw === undefined || t === '') {
          cells.push({ type: type.code, unit: u.key, amountTiyin: '0' });
          continue;
        }
        const n = typeof raw === 'number' ? raw : Number(t);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${name}, ${type.name}: summa noto'g'ri («${text(raw)}»)`);
        cells.push({ type: type.code, unit: u.key, amountTiyin: String(Math.round(n * 100)) });
      }
    }
    return { period, cells, unknownUnits, unknownColumns };
  }
}