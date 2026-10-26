import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { monthLabel } from '../../common/period';
import { entryUnitLabel } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { CENTER_PARENT, PAYROLL_CENTER_CATEGORY, PAYROLL_CENTER_OTHER, PAYROLL_PART_PREFIX } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { fullOf } from '../payroll-facts/payroll-facts.service';

// ═══════════════════════════════════════════════════════════
// Ish haqi nazorati: XARAJAT = SOLIQ HISOBOTI.
//
// Asosiy qoida: ish haqi xarajati — faqat soliq hisoboti (Xarajatlar › Ish haqi; bo'limlarda — o'sha bo'lim
// vedomosti). Ish haqi tarkibi, 23106 — ichki nazorat: xodimning puli to'g'rimi, qaysi komponent bo'yicha qancha —
// xarajatga hech narsa qo'shmaydi.
//
// Bu nazorat shu oy ish haqi xarajatlarining har birini manbasiga bog'laydi va ortiqchasini ko'rsatadi:
//  • bekor qilingan yuklashdan qolib ketgan xarajat;
//  • bir xodim ikki joyda (umumiy hisobot va bo'lim sahifasi) — ikki marta sanalgan;
//  • bo'limdan o'tkazilgan summa, xodimning o'zi yana yuklangan;
//  • demo ma'lumotlar; manbasiz (qo'lda) ish haqi yozuvlari.
// Tozalash — faqat foydalanuvchi tasdiqlaganda: xarajat Savatga o'tadi (qaytarish mumkin), tarixga yoziladi.
// ═══════════════════════════════════════════════════════════

const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const CENTER_CODES = [...Object.values(PAYROLL_CENTER_CATEGORY).map((c) => c.code), PAYROLL_CENTER_OTHER.code];
const DEMO = '[DEMO]';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ExpenseKind = 'GENERAL' | 'UNIT_GENERAL' | 'UNIT_MANUAL' | 'UNIT_SPLIT' | 'MOVED' | 'ORPHAN' | 'MOVED_DUP' | 'DEMO' | 'OTHER';
/** Tozalanadigan (ortiqcha) turlar */
export const CLEANABLE: ExpenseKind[] = ['ORPHAN', 'MOVED_DUP', 'DEMO'];

export const KIND_LABEL: Record<ExpenseKind, string> = {
  GENERAL: 'Umumiy soliq hisoboti (Markaz va hududlar)',
  UNIT_GENERAL: "Umumiy soliq hisobotidan bo'limlarga (Tax free …)",
  UNIT_MANUAL: "Bo'lim sahifasida yuklangan vedomost",
  UNIT_SPLIT: "Bo'lim ish haqi qismlari (siyosat bo'yicha ajratilgan)",
  MOVED: "Bo'limdan boshqa joyga o'tkazilgan",
  ORPHAN: "Bekor qilingan yuklashdan qolib ketgan",
  MOVED_DUP: "O'tkazilgan, lekin xodim yana yuklangan (ikki marta)",
  DEMO: "Demo ma'lumot",
  OTHER: "Manbasiz (qo'lda kiritilgan yoki boshqa)",
};

interface ExpenseRow {
  id: string;
  amountTiyin: bigint;
  categoryCode: string;
  payrollBatchId: string | null;
  segment: string | null;
  regionCode: number | null;
  description: string | null;
  documentNo: string | null;
  source: string;
}

@Injectable()
export class PayrollControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly units?: UnitPayrollService,
  ) {}

  private async categories(): Promise<string[]> {
    const parts = await this.prisma.category.findMany({ where: { OR: [{ code: { startsWith: PAYROLL_PART_PREFIX } }, { parentCode: CENTER_PARENT.code }] }, select: { code: true } }).catch(() => [] as { code: string }[]);
    return [...new Set([PAYROLL_CATEGORY, ...CENTER_CODES, ...parts.map((c) => c.code)])].filter((c) => c !== 'HM_SAFAR');
  }

  /** Shu oy: soliq hisoboti, ish haqi xarajatlari (manbasi bilan) va ortiqchalar */
  async control(period: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const cats = await this.categories();
    const [pbatches, expenses, unitBatches] = await Promise.all([
      this.prisma.payrollBatch.findMany({ where: { period }, select: { id: true, status: true, scope: true, fileName: true, totalTiyin: true, createdAt: true } }),
      this.prisma.expense.findMany({
        where: { period, deletedAt: null, OR: [{ categoryCode: { in: cats } }, { payrollBatchId: { not: null } }] },
        select: { id: true, amountTiyin: true, categoryCode: true, payrollBatchId: true, segment: true, regionCode: true, description: true, documentNo: true, source: true },
      }) as Promise<ExpenseRow[]>,
      this.units ? this.units.allBatches(period) : Promise.resolve([]),
    ]);
    const committedGeneral = pbatches.filter((b) => b.status === 'COMMITTED');
    const committedIds = new Set(committedGeneral.map((b) => b.id));

    // ── Soliq hisoboti (yuklangan fayllar) ──
    const entryRows = committedIds.size
      ? await this.prisma.payrollEntry.findMany({ where: { period, deletedAt: null, batchId: { in: [...committedIds] } }, select: { employeePinfl: true, baseTiyin: true, totalTiyin: true, bonusTiyin: true, batchId: true } })
      : [];
    const files = committedGeneral.map((b) => {
      const own = entryRows.filter((e) => e.batchId === b.id).reduce((s, e) => s + fullOf(e), 0n);
      const toUnits = unitBatches.filter((u) => u.batch.status === 'COMMITTED' && u.batch.origin === 'GENERAL' && u.batch.generalBatchId === b.id).reduce((s, u) => s + BigInt(u.batch.totalTiyin), 0n);
      return { id: b.id, kind: b.scope === 'REGIONS' ? 'REGIONS' : 'ALL', fileName: b.fileName, createdAt: b.createdAt, ownTiyin: own, toUnitsTiyin: toUnits, totalTiyin: own + toUnits };
    });
    // Umumiy vedomostdan yaratilgan, lekin hech qaysi saqlangan umumiy yuklashga bog'lanmagan bo'lim yuklashlari
    const strayGeneral = unitBatches.filter((u) => u.batch.status === 'COMMITTED' && u.batch.origin === 'GENERAL' && !(u.batch.generalBatchId && committedIds.has(u.batch.generalBatchId)));
    const manual = unitBatches.filter((u) => u.batch.status === 'COMMITTED' && u.batch.origin !== 'GENERAL');

    // ── Xodim qayerda sanalgan ──
    const sources = new Map<string, { where: string; tiyin: bigint; unit?: string; batchId: string; manual?: boolean }[]>();
    const add = (p: string, x: { where: string; tiyin: bigint; unit?: string; batchId: string; manual?: boolean }) => sources.set(p, [...(sources.get(p) ?? []), x]);
    for (const e of entryRows) {
      const b = committedGeneral.find((x) => x.id === e.batchId);
      add(e.employeePinfl, { where: b?.scope === 'REGIONS' ? 'Hududlar vedomosti' : 'Umumiy soliq hisoboti', tiyin: fullOf(e), batchId: e.batchId! });
    }
    for (const u of unitBatches) {
      if (u.batch.status !== 'COMMITTED') continue;
      for (const r of u.batch.rows ?? []) add(r.pinfl, { where: `${entryUnitLabel(u.unit)} — ${u.batch.origin === 'GENERAL' ? 'umumiy hisobotdan' : 'shu sahifada yuklangan'}`, tiyin: BigInt(r.amountTiyin), unit: u.unit, batchId: u.batch.id, manual: u.batch.origin !== 'GENERAL' });
    }

    // ── Xarajatlarni manbasiga bog'lash ──
    const unitExp = new Map<string, { unit: string; batch: (typeof unitBatches)[number]['batch'] }>();
    for (const u of unitBatches) if (u.batch.expenseId) unitExp.set(u.batch.expenseId, u);
    const splitIds = new Set<string>();
    if (this.units) {
      const splits = await this.prisma.setting.findMany({ where: { key: { startsWith: 'unit.payroll.split.' } }, select: { key: true, value: true } });
      for (const s of splits) if (s.key.endsWith(`.${period}`)) for (const id of ((s.value as { expenseIds?: string[] } | null)?.expenseIds ?? [])) splitIds.add(id);
    }
    const classified = expenses.map((e) => {
      let kind: ExpenseKind;
      let note = '';
      const u = unitExp.get(e.id);
      if (e.description?.startsWith(DEMO)) kind = 'DEMO';
      else if (e.payrollBatchId) {
        kind = committedIds.has(e.payrollBatchId) ? 'GENERAL' : 'ORPHAN';
        if (kind === 'ORPHAN') note = `bekor qilingan umumiy yuklash (${pbatches.find((b) => b.id === e.payrollBatchId)?.fileName ?? 'noma’lum'})`;
      } else if (u) {
        if (u.batch.status !== 'COMMITTED') {
          kind = 'ORPHAN';
          note = `${entryUnitLabel(u.unit)}: bekor qilingan yuklash «${u.batch.fileName}»`;
        } else kind = u.batch.origin === 'GENERAL' ? 'UNIT_GENERAL' : 'UNIT_MANUAL';
      } else if (splitIds.has(e.id)) kind = 'UNIT_SPLIT';
      else if (e.documentNo && /^\d{14}$/.test(e.documentNo) && /dan o'tkazildi/.test(e.description ?? '')) {
        // Bo'limdan o'tkazilgan summa: xodim shu oy yana biror joyda yuklangan bo'lsa — ikki marta
        const again = sources.get(e.documentNo) ?? [];
        kind = again.length ? 'MOVED_DUP' : 'MOVED';
        if (again.length) note = `xodim yana: ${again.map((x) => x.where).join(', ')}`;
      } else kind = 'OTHER';
      return { ...e, kind, note };
    });

    const sum = (k: ExpenseKind) => classified.filter((x) => x.kind === k).reduce((s, x) => s + x.amountTiyin, 0n);
    const expenseTotal = classified.reduce((s, x) => s + x.amountTiyin, 0n);
    const fileTotal = files.reduce((s, f) => s + f.totalTiyin, 0n);
    const manualTotal = manual.reduce((s, u) => s + BigInt(u.batch.totalTiyin), 0n);
    const strayTotal = strayGeneral.reduce((s, u) => s + BigInt(u.batch.totalTiyin), 0n);

    // Ikki marta sanalgan xodimlar: umumiy hisobot + bo'lim sahifasi (yoki ikki bo'lim)
    const names = new Map<string, string>();
    const dupPins = [...sources.entries()].filter(([, list]) => list.length > 1).map(([p]) => p);
    if (dupPins.length) for (const e of await this.prisma.employee.findMany({ where: { pinfl: { in: dupPins } }, select: { pinfl: true, fullName: true } })) names.set(e.pinfl, e.fullName);
    const duplicates = dupPins.map((p) => {
      const list = sources.get(p)!;
      const total = list.reduce((s, x) => s + x.tiyin, 0n);
      // Ortiqchasi: bo'lim sahifasida qo'lda yuklangan qismi (soliq hisoboti asosiy); qo'lda yo'q bo'lsa — eng kattasidan tashqari
      const manualPart = list.filter((x) => x.manual).reduce((s, x) => s + x.tiyin, 0n);
      const extra = manualPart > 0n && manualPart < total ? manualPart : total - list.reduce((m, x) => (x.tiyin > m ? x.tiyin : m), 0n);
      return {
        pinfl: p,
        fullName: names.get(p) ?? p,
        sources: list.map((x) => ({ where: x.where, tiyin: x.tiyin.toString(), unit: x.unit ?? null, manual: Boolean(x.manual) })),
        totalTiyin: total.toString(),
        extraTiyin: extra.toString(),
        /** Tozalash: shu bo'lim(lar) sahifasidagi qo'lda yuklangan qatorini olib tashlash */
        removeFrom: [...new Set(list.filter((x) => x.manual).map((x) => x.unit!))],
      };
    });
    const dupExtra = duplicates.reduce((s, d) => s + BigInt(d.extraTiyin), 0n);
    // Umumiy hisobotda ham bor xodimlarning bo'lim sahifasida qo'lda yuklangan qismi — ortiqcha (soliq hisoboti asosiy)
    const dupManual = duplicates.reduce((s, d) => (d.sources.some((x) => !x.manual) ? s + d.sources.filter((x) => x.manual).reduce((t, x) => t + BigInt(x.tiyin), 0n) : s), 0n);
    // Kutilgan xarajat: yuklangan soliq hisoboti + bo'lim sahifalarida yuklangan (ikki marta sanalganisiz; + ulardan o'tkazilgan)
    const expected = fileTotal + manualTotal - dupManual + sum('MOVED');

    const byKind = (Object.keys(KIND_LABEL) as ExpenseKind[])
      .map((k) => ({ kind: k, label: KIND_LABEL[k], count: classified.filter((x) => x.kind === k).length, tiyin: sum(k).toString(), cleanable: CLEANABLE.includes(k) }))
      .filter((x) => x.count > 0);
    const issues = classified
      .filter((x) => CLEANABLE.includes(x.kind) || x.kind === 'OTHER')
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1))
      .slice(0, 500)
      .map((x) => ({ id: x.id, kind: x.kind, label: KIND_LABEL[x.kind], tiyin: x.amountTiyin.toString(), description: x.description, note: x.note, segment: x.segment, regionCode: x.regionCode, categoryCode: x.categoryCode, cleanable: CLEANABLE.includes(x.kind) }));
    const cleanable = classified.filter((x) => CLEANABLE.includes(x.kind)).reduce((s, x) => s + x.amountTiyin, 0n);

    return {
      period,
      monthLabel: monthLabel(period),
      /** Yuklangan soliq hisoboti (umumiy va hududlar vedomostlari — bo'limlarga yozilgan qismi bilan) */
      soliq: {
        files: files.map((f) => ({ ...f, ownTiyin: f.ownTiyin.toString(), toUnitsTiyin: f.toUnitsTiyin.toString(), totalTiyin: f.totalTiyin.toString() })),
        totalTiyin: fileTotal.toString(),
        manual: manual.map((u) => ({ unit: u.unit, label: entryUnitLabel(u.unit), fileName: u.batch.fileName, totalTiyin: u.batch.totalTiyin, count: u.batch.count })),
        manualTiyin: manualTotal.toString(),
        /** Umumiy vedomostdan yaratilgan, lekin saqlangan umumiy yuklashga bog'lanmagan bo'lim yuklashlari */
        stray: strayGeneral.map((u) => ({ unit: u.unit, label: entryUnitLabel(u.unit), batchId: u.batch.id, fileName: u.batch.fileName, totalTiyin: u.batch.totalTiyin })),
        strayTiyin: strayTotal.toString(),
      },
      expected: expected.toString(),
      expenseTotal: expenseTotal.toString(),
      diffTiyin: (expenseTotal - expected).toString(),
      /** Farq nimadan: ortiqcha xarajatlar, ikki marta sanalgan (qo'lda), bog'lanmagan bo'lim yuklashlari, manbasiz */
      explain: { cleanableTiyin: cleanable.toString(), duplicateManualTiyin: dupManual.toString(), strayTiyin: strayTotal.toString(), otherTiyin: sum('OTHER').toString() },
      byKind,
      issues,
      cleanableTiyin: cleanable.toString(),
      duplicates: duplicates.sort((a, b) => (BigInt(b.extraTiyin) > BigInt(a.extraTiyin) ? 1 : -1)).slice(0, 500),
      duplicateCount: duplicates.length,
      duplicateTiyin: dupExtra.toString(),
      ok: expenseTotal === expected && !duplicates.length && !strayGeneral.length,
    };
  }

  /** Bir necha oy: har oy qisqacha (yil bo'yicha qayerda farq borligini topish uchun) */
  async controlRange(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '') || from > to) throw new BadRequestException("Oylar noto'g'ri (YYYY-MM)");
    const months: string[] = [];
    let [y, m] = from.split('-').map(Number) as [number, number];
    while (`${y}-${String(m).padStart(2, '0')}` <= to && months.length < 36) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const out: { period: string; monthLabel: string; soliqTiyin: string; expected: string; expenseTotal: string; diffTiyin: string; duplicateTiyin: string; cleanableTiyin: string; ok: boolean }[] = [];
    for (const p of months) {
      const c = await this.control(p);
      out.push({ period: p, monthLabel: c.monthLabel, soliqTiyin: (BigInt(c.soliq.totalTiyin) + BigInt(c.soliq.manualTiyin)).toString(), expected: c.expected, expenseTotal: c.expenseTotal, diffTiyin: c.diffTiyin, duplicateTiyin: c.duplicateTiyin, cleanableTiyin: c.cleanableTiyin, ok: c.ok });
    }
    const total = (k: 'expected' | 'expenseTotal' | 'diffTiyin' | 'duplicateTiyin') => out.reduce((s, r) => s + BigInt(r[k]), 0n).toString();
    return { from, to, months: out, expected: total('expected'), expenseTotal: total('expenseTotal'), diffTiyin: total('diffTiyin'), duplicateTiyin: total('duplicateTiyin') };
  }

  /** Umumiy vedomostdan yaratilgan, lekin saqlangan umumiy yuklashga bog'lanmagan bo'lim yuklashlarini bekor qilish */
  async cancelStray(period: string, batchIds: unknown, userId: string) {
    if (!this.units) throw new BadRequestException("Bo'limlar moduli ulanmagan");
    const want = new Set(Array.isArray(batchIds) ? batchIds.map(String) : []);
    const c = await this.control(period);
    const list = c.soliq.stray.filter((s) => want.has(s.batchId));
    if (!list.length) throw new BadRequestException("Tanlangan yuklashlar ortiqcha emas");
    for (const s of list) await this.units.cancel(s.unit, period, s.batchId, userId);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'payroll_control', entityId: period, summary: `Ish haqi nazorati ${monthLabel(period)}: umumiy yuklashga bog'lanmagan ${list.length} ta bo'lim yuklashi bekor qilindi` });
    return { cancelled: list.length };
  }

  /** Ikki marta sanalganlar: bo'lim sahifasida qo'lda yuklangan qatori olib tashlanadi (umumiy soliq hisoboti qoladi) */
  async dedupe(period: string, pinfls: unknown, userId: string) {
    if (!this.units) throw new BadRequestException("Bo'limlar moduli ulanmagan");
    const want = new Set(Array.isArray(pinfls) ? pinfls.map(String) : []);
    const c = await this.control(period);
    const list = c.duplicates.filter((d) => want.has(d.pinfl) && d.removeFrom.length && d.sources.some((x) => !x.manual));
    if (!list.length) throw new BadRequestException("Tanlanganlar orasida umumiy hisobotda ham, bo'limda qo'lda ham yuklangan xodim yo'q");
    const byUnit = new Map<string, string[]>();
    for (const d of list) for (const u of d.removeFrom) byUnit.set(u, [...(byUnit.get(u) ?? []), d.pinfl]);
    let removed = 0;
    let total = 0n;
    for (const [u, pins] of byUnit) {
      const r = await this.units.removeManualRows(u, period, pins, userId);
      removed += r.removed;
      total += BigInt(r.totalTiyin);
    }
    return { removed, totalTiyin: total.toString() };
  }

  /** Ortiqcha xarajatlarni Savatga (tasdiqlangandan keyin): faqat tozalanadigan turlar, nazoratdan qayta tekshiriladi */
  async clean(period: string, ids: unknown, userId: string) {
    const want = new Set(Array.isArray(ids) ? ids.map(String).slice(0, 2000) : []);
    if (!want.size) throw new BadRequestException('Tozalanadigan xarajatlarni tanlang');
    const c = await this.control(period);
    const ok = c.issues.filter((i) => i.cleanable && want.has(i.id));
    if (!ok.length) throw new BadRequestException("Tanlanganlar orasida tozalanadigan (ortiqcha) xarajat yo'q");
    const r = await this.prisma.expense.updateMany({ where: { id: { in: ok.map((i) => i.id) }, deletedAt: null }, data: { deletedAt: new Date() } });
    const total = ok.reduce((s, i) => s + BigInt(i.tiyin), 0n);
    await this.audit.log({
      userId,
      action: 'DELETE',
      entity: 'payroll_control',
      entityId: period,
      summary: `Ish haqi nazorati ${monthLabel(period)}: ${r.count} ta ortiqcha xarajat Savatga o'tkazildi (${(Number(total) / 100).toLocaleString('uz-UZ')} so'm) — ${[...new Set(ok.map((i) => i.label))].join('; ')}`,
    });
    return { removed: r.count, totalTiyin: total.toString() };
  }
}
