import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { monthsBetween } from '../../common/period';
import { UNIT_CATEGORIES_KEY } from '../../common/segments/unit-categories';
import { runExclusive } from '../../common/locks';
import { AuditService } from '../audit/audit.service';
import { BANK_ANALYSIS_KEY, BankAnalysisService, readStore, rk } from '../bank-analysis/bank-analysis.service';
import { CenterIncomeService } from '../cashbook/center-income.service';
import { policyRouting, readPolicy, writePolicy } from '../expense-policy/policy.util';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { QOMITA_BANK_TAG, QOMITA_CONFIG_KEY, QOMITA_INCOME_PREFIX, QOMITA_SEGMENT, qomitaPayrollKey, readQomita, type QomitaConfig, type QomitaItem, type QomitaPayrollSummary } from './qomita.util';

// ═══════════════════════════════════════════════════════════
// Qo'mita mablag'lari (Daromadlar › Qo'mita mablag'lari).
//
// Qo'mita ayrim bo'limlarimiz xarajatini qoplash uchun pul ajratadi. Har qoplanadigan bo'lim uchun:
//  • DAROMAD turi «Qo'mita ajratmasi: <bo'lim>» (avtomatik yaratiladi) — yozuv yo'nalishi QOMITA;
//    qo'lda kiritiladi yoki bank ko'chirmasidagi kirimdan (Qo'mitadan kelgan to'lov) yo'naltiriladi;
//  • QOPLANADIGAN XARAJAT:
//     – ish haqi qismlari (Oklad, 40% ustama …) — ish haqi qayta guruhlanganda bo'limdan ajratilib Qo'mita hisobiga;
//     – boshqa moddalar — bo'limlar siyosati (shu bo'limda yozilgan modda → Qo'mita hisobidan).
//  • Hisobot: bo'lim × oy — Ajratildi · Qoplanishi kerak · Qoldiq / kamomad (faqat ko'rsatiladi, cheklanmaydi).
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Bankdagi Qo'mitadan kelgan to'lov belgisi (to'lovchi nomi yoki izohida) */
const QOMITA_RE = /комитет|комитета|qo['ʻ‘’`]?mita|qumita|komitet|kumita|қўмита|кумита/i;
const MAX_ITEMS = 50;
/** Tasdiqlangan Qo'mita daromadlari: yozuv id → kim, qachon */
const APPROVED_KEY = 'qomita.income.approved';
/** Qo'mitaga modda sifatida berilmaydi: ish haqi (qismlar bilan beriladi) va avtomatik qismlar */
const NOT_CATS = (code: string) => code === 'PAYROLL_BASE' || code === 'QMT' || code.startsWith('QMT_') || code === 'IHQ' || code.startsWith('IHQ_');

type Money = Map<string, bigint>;
const add = (m: Money, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);
const sumOf = (m: Money) => [...m.values()].reduce((s, v) => s + v, 0n);
const toRec = (m: Money) => Object.fromEntries([...m].filter(([, v]) => v !== 0n).map(([k, v]) => [k, v.toString()]));
const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    return 0n;
  }
};
const periodEnd = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(`${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}T12:00:00+05:00`);
};

export interface QomitaRow {
  /** Bo'lim id; «-» — bo'lim ko'rsatilmagan Qo'mita daromadi */
  key: string;
  label: string;
  incomeCode: string | null;
  components: { code: string; name: string }[];
  categories: { code: string; label: string }[];
  /** Ajratildi (daromad) */
  allocatedTiyin: string;
  /** Ish haqi qismlari (Qo'mita hisobiga ajratilgan) */
  payrollTiyin: string;
  /** Boshqa moddalar (siyosat bo'yicha Qo'mita hisobiga) */
  otherTiyin: string;
  /** Qoplanishi kerak = ish haqi + boshqa */
  coveredTiyin: string;
  /** Qoldiq: + ortib qoldi, − yetmadi */
  balanceTiyin: string;
  months: Record<string, { allocated: string; payroll: string; other: string }>;
}

@Injectable()
export class QomitaService {
  private readonly logger = new Logger(QomitaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly payroll?: PayrollService,
    @Optional() private readonly bank?: BankAnalysisService,
    @Optional() private readonly centerIncome?: CenterIncomeService,
  ) {}

  /**
   * Kassadagi Qo'mita qatorlari (1.11, 1.14, 1.15) Qo'mita mablag'lari bilan bitta pul: yozuv qo'shilsa/o'chirilsa —
   * kassa farqi qayta hisoblanadi (periods bo'lmasa — hamma oylar). Xato bo'lsa — logga, amal bekor bo'lmaydi.
   */
  async resyncKassa(userId: string, periods?: string[]): Promise<void> {
    if (!this.centerIncome) return;
    try {
      if (periods?.length) for (const p of [...new Set(periods)].sort()) await this.centerIncome.syncPeriod(p, userId);
      else await this.centerIncome.syncAll(userId);
    } catch (e) {
      this.logger.warn(`Kassa (Qo'mita qatorlari) qayta hisoblanmadi: ${(e as Error).message}`);
    }
  }

  // ═══════════ Sozlama ═══════════

  private async writeConfig(config: QomitaConfig): Promise<void> {
    const value = config as unknown as object;
    await this.prisma.setting.upsert({ where: { key: QOMITA_CONFIG_KEY }, create: { key: QOMITA_CONFIG_KEY, value }, update: { value } });
  }

  /** Bo'limlar siyosatidan: shu bo'limning Qo'mita hisobidagi moddalari */
  private qomitaCats(depRules: Record<string, Record<string, string>>, departmentId: string): string[] {
    return Object.entries(depRules[departmentId] ?? {})
      .filter(([, t]) => t === QOMITA_SEGMENT)
      .map(([c]) => c)
      .sort();
  }

  async config() {
    const [config, policy, deps, comps, cats, incomeCats] = await Promise.all([
      readQomita(this.prisma),
      readPolicy(this.prisma),
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.prisma.salaryComponent.findMany({ where: { isActive: true, sign: { gt: 0 } }, select: { code: true, name: true, category: true }, orderBy: [{ sortOrder: 'asc' }] }),
      this.prisma.category.findMany({ where: { isActive: true }, select: { code: true, label: true, parentCode: true, isLeaf: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: QOMITA_INCOME_PREFIX } }, select: { code: true, label: true } }),
    ]);
    const depName = new Map(deps.map((d) => [d.id, d.name]));
    const compName = new Map(comps.map((c) => [c.code, c.name]));
    const catLabel = new Map(cats.map((c) => [c.code, c.label]));
    const incLabel = new Map(incomeCats.map((c) => [c.code, c.label]));
    const parent = new Map(cats.map((c) => [c.code, c.label]));
    return {
      items: config.items.map((i) => ({
        id: i.id,
        departmentId: i.departmentId,
        departmentName: depName.get(i.departmentId) ?? "Bo'lim (o'chirilgan)",
        incomeCode: i.incomeCode,
        incomeLabel: incLabel.get(i.incomeCode) ?? i.incomeCode,
        components: i.components.map((c) => ({ code: c, name: compName.get(c) ?? c })),
        categories: this.qomitaCats(policy.depRules, i.departmentId).map((c) => ({ code: c, label: catLabel.get(c) ?? c })),
        note: i.note,
      })),
      departments: deps,
      components: comps.map((c) => ({ code: c.code, name: c.name, group: c.category })),
      categories: cats.filter((c) => !NOT_CATS(c.code)).map((c) => ({ code: c.code, label: c.label, group: c.parentCode ? (parent.get(c.parentCode) ?? null) : null, isLeaf: c.isLeaf })),
    };
  }

  /** Bo'lim uchun Qo'mita daromad turi (yo'q bo'lsa — yaratiladi), Qo'mita daromad ro'yxatiga ham qo'shiladi */
  async ensureIncomeCode(dep: { id: string; name: string; index: number }): Promise<string> {
    const code = `${QOMITA_INCOME_PREFIX}${dep.index}`;
    const label = `Qo'mita ajratmasi: ${dep.name}`.slice(0, 200);
    const have = await this.prisma.incomeCategory.findUnique({ where: { code } });
    if (!have) await this.prisma.incomeCategory.create({ data: { code, label, isActive: true, order: 900 + (dep.index % 100) } });
    else if (!have.isActive || have.label !== label) await this.prisma.incomeCategory.update({ where: { code }, data: { isActive: true, label } });
    // Qo'mita bo'limining daromad ro'yxati to'ldirilgan bo'lsa — yangi tur ham ro'yxatga
    await runExclusive(`setting:${UNIT_CATEGORIES_KEY}`, async () => {
      const row = await this.prisma.setting.findUnique({ where: { key: UNIT_CATEGORIES_KEY } });
      const v = (row?.value ?? {}) as { expense?: Record<string, string[]>; income?: Record<string, string[]> };
      const list = v.income?.[QOMITA_SEGMENT];
      if (Array.isArray(list) && list.length && !list.includes(code)) {
        const value = { ...v, income: { ...(v.income ?? {}), [QOMITA_SEGMENT]: [...list, code] } } as object;
        await this.prisma.setting.update({ where: { key: UNIT_CATEGORIES_KEY }, data: { value } });
      }
    });
    return code;
  }

  /** Bo'limlar siyosati: shu bo'limning Qo'mita moddalari — aynan shu ro'yxat (boshqa maqsadlarga tegilmaydi) */
  private async setQomitaCats(departmentId: string, codes: string[]): Promise<{ added: string[]; removed: string[] }> {
    const policy = await readPolicy(this.prisma);
    const rules = { ...(policy.depRules[departmentId] ?? {}) };
    const before = new Set(this.qomitaCats(policy.depRules, departmentId));
    const want = new Set(codes);
    const removed = [...before].filter((c) => !want.has(c));
    const added = [...want].filter((c) => !before.has(c));
    for (const c of removed) delete rules[c];
    for (const c of want) rules[c] = QOMITA_SEGMENT;
    if (!removed.length && !added.length) return { added, removed };
    const next = { ...policy.depRules };
    if (Object.keys(rules).length) next[departmentId] = rules;
    else delete next[departmentId];
    await writePolicy(this.prisma, { depRules: next });
    return { added, removed };
  }

  /** Ish haqi qayta guruhlash (Qo'mita qismlari yangilanadi). Xato bo'lsa — sozlama saqlangan, ogohlantiriladi */
  private async recompute(): Promise<{ ok: boolean; message: string | null }> {
    if (!this.payroll) return { ok: false, message: "Ish haqi qayta hisoblanmadi — «Xarajatlar siyosati › Qayta hisoblash»ni bosing" };
    try {
      await this.payroll.regroupAll();
      return { ok: true, message: null };
    } catch (error) {
      this.logger.warn(`Qo'mita: ish haqi qayta hisoblanmadi: ${(error as Error).message}`);
      return { ok: false, message: `Ish haqi qayta hisoblanmadi: ${(error as Error).message}`.slice(0, 300) };
    }
  }

  /**
   * Qoplanadigan bo'lim — qo'shish yoki o'zgartirish:
   * { departmentId, components: ['OKLAD','OKLAD_40'], categories: ['ALOQA', …], note }
   */
  async saveItem(body: { departmentId?: unknown; components?: unknown; categories?: unknown; note?: unknown }, userId: string) {
    const departmentId = typeof body?.departmentId === 'string' ? body.departmentId.trim() : '';
    if (!departmentId) throw new BadRequestException("Bo'limni tanlang");
    const dep = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, index: true, isActive: true } });
    if (!dep || !dep.isActive) throw new NotFoundException("Bo'lim topilmadi");
    const rawComps = Array.isArray(body?.components) ? [...new Set(body.components.filter((c): c is string => typeof c === 'string'))] : [];
    const rawCats = Array.isArray(body?.categories) ? [...new Set(body.categories.filter((c): c is string => typeof c === 'string'))] : [];
    if (rawComps.length > 40 || rawCats.length > 300) throw new BadRequestException("Ro'yxat juda uzun");
    const [comps, cats] = await Promise.all([
      rawComps.length ? this.prisma.salaryComponent.findMany({ where: { code: { in: rawComps } }, select: { code: true, sign: true } }) : [],
      rawCats.length ? this.prisma.category.findMany({ where: { code: { in: rawCats } }, select: { code: true } }) : [],
    ]);
    const okComps = new Set(comps.filter((c) => c.sign > 0).map((c) => c.code));
    const badComp = rawComps.find((c) => !okComps.has(c));
    if (badComp) throw new BadRequestException(`Ish haqi qismi topilmadi yoki ayiriladigan: ${badComp.slice(0, 40)}`);
    const okCats = new Set(cats.map((c) => c.code));
    const badCat = rawCats.find((c) => !okCats.has(c) || NOT_CATS(c));
    if (badCat) throw new BadRequestException(`Modda topilmadi: ${badCat.slice(0, 64)}`);
    if (!rawComps.length && !rawCats.length) throw new BadRequestException("Nima qoplanadi — ish haqi qismi yoki moddani tanlang");
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;

    const incomeCode = await this.ensureIncomeCode(dep);
    const { before, item } = await runExclusive(`setting:${QOMITA_CONFIG_KEY}`, async () => {
      const config = await readQomita(this.prisma);
      const prev = config.items.find((i) => i.departmentId === departmentId) ?? null;
      if (!prev && config.items.length >= MAX_ITEMS) throw new BadRequestException(`Ko'pi bilan ${MAX_ITEMS} ta bo'lim`);
      const next: QomitaItem = { id: prev?.id ?? randomUUID(), departmentId, incomeCode, components: rawComps.sort(), note, createdAt: prev?.createdAt ?? new Date().toISOString() };
      config.items = prev ? config.items.map((i) => (i.departmentId === departmentId ? next : i)) : [...config.items, next];
      await this.writeConfig(config);
      return { before: prev, item: next };
    });
    const catChange = await this.setQomitaCats(departmentId, rawCats);
    const compsChanged = (before?.components ?? []).join(',') !== item.components.join(',');
    const recalc = compsChanged ? await this.recompute() : { ok: true, message: null };
    await this.audit.log({
      userId,
      action: before ? 'UPDATE' : 'CREATE',
      entity: 'qomita',
      entityId: departmentId.slice(0, 190),
      summary: `Qo'mita mablag'lari — ${dep.name}: ish haqi qismlari [${item.components.join(', ') || '—'}], moddalar ${rawCats.length} ta${catChange.added.length || catChange.removed.length ? ` (+${catChange.added.length} / −${catChange.removed.length})` : ''}`,
    });
    return { item, recalculated: compsChanged && recalc.ok, warning: recalc.message };
  }

  /** Bo'limni Qo'mita ro'yxatidan olib tashlash: qismlar bo'limga qaytadi, moddalar umumiy siyosatga; daromadlar joyida qoladi */
  async removeItem(departmentId: string, userId: string) {
    const removed = await runExclusive(`setting:${QOMITA_CONFIG_KEY}`, async () => {
      const config = await readQomita(this.prisma);
      const item = config.items.find((i) => i.departmentId === departmentId);
      if (!item) throw new NotFoundException("Bo'lim Qo'mita ro'yxatida yo'q");
      config.items = config.items.filter((i) => i !== item);
      await this.writeConfig(config);
      return item;
    });
    await this.setQomitaCats(departmentId, []);
    const recalc = removed.components.length ? await this.recompute() : { ok: true, message: null };
    // Daromad turi: yozuvi bo'lmasa — nofaol (ro'yxatlarda ko'rinmaydi)
    const used = await this.prisma.income.count({ where: { categoryCode: removed.incomeCode, deletedAt: null } });
    if (!used) await this.prisma.incomeCategory.updateMany({ where: { code: removed.incomeCode }, data: { isActive: false } });
    const dep = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'qomita', entityId: departmentId.slice(0, 190), summary: `Qo'mita mablag'lari — ${dep?.name ?? departmentId}: ro'yxatdan olib tashlandi` });
    return { removed: true, warning: recalc.message };
  }

  // ═══════════ Hisobot ═══════════

  private range(from: string, to: string): string[] {
    return monthsBetween(String(from ?? ''), String(to ?? ''));
  }

  /** Davrdagi hamma ma'lumot (hisobot va tafsilot uchun) */
  private async load(months: string[]) {
    const [config, policy, cats, deps, comps, incomes, summaries] = await Promise.all([
      readQomita(this.prisma),
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, parentCode: true, label: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true, index: true } }),
      this.prisma.salaryComponent.findMany({ select: { code: true, name: true } }),
      this.prisma.income.findMany({
        where: { segment: QOMITA_SEGMENT, deletedAt: null, period: { in: months } },
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, description: true, clientName: true, contractNo: true, source: true, importBatchId: true },
        orderBy: [{ date: 'desc' }],
      }),
      this.prisma.setting.findMany({ where: { key: { in: months.map(qomitaPayrollKey) } }, select: { key: true, value: true } }),
    ]);
    const routing = policyRouting(policy, cats);
    const depIds = config.items.map((i) => i.departmentId);
    // Boshqa moddalar: shu bo'limlarda (Markazda) yozilgan, siyosat bo'yicha Qo'mita hisobiga o'tadigan xarajatlar
    const rows = depIds.length
      ? await this.prisma.expense.findMany({
          where: { deletedAt: null, segment: null, departmentId: { in: depIds }, period: { in: months } },
          select: { id: true, period: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true, source: true, description: true, counterparty: true, date: true },
        })
      : [];
    const other = rows.filter((r) => (r.regionCode === 0 || r.regionCode === null) && r.source !== 'PAYROLL' && routing.route(r)?.key === `s:${QOMITA_SEGMENT}`);
    const summary = new Map(summaries.map((s) => [s.key.slice('qomita.payroll.'.length), (s.value ?? {}) as Partial<QomitaPayrollSummary>]));
    // Daromad turi → bo'lim: sozlamadagilar va har bo'limning «QOMITA_<indeks>» turi (sozlanmagan bo'limga ham kiritilgan bo'lishi mumkin)
    const codeDep = new Map<string, string>(deps.map((d) => [`${QOMITA_INCOME_PREFIX}${d.index}`, d.id]));
    for (const i of config.items) codeDep.set(i.incomeCode, i.departmentId);
    const depCode = new Map([...codeDep].map(([c, dep]) => [dep, c]));
    for (const i of config.items) depCode.set(i.departmentId, i.incomeCode);
    return {
      config,
      codeDep,
      depCode,
      incomes,
      other,
      summary,
      depName: new Map(deps.map((d) => [d.id, d.name])),
      compName: new Map(comps.map((c) => [c.code, c.name])),
      catLabel: new Map(cats.map((c) => [c.code, c.label])),
      depRules: policy.depRules,
    };
  }

  async report(from: string, to: string) {
    const months = this.range(from, to);
    const d = await this.load(months);
    const rows: QomitaRow[] = [];
    const empty = () => ({ allocated: new Map() as Money, payroll: new Map() as Money, other: new Map() as Money });
    const acc = new Map<string, ReturnType<typeof empty>>();
    const get = (k: string) => {
      let x = acc.get(k);
      if (!x) acc.set(k, (x = empty()));
      return x;
    };
    for (const i of d.config.items) get(i.departmentId);
    for (const inc of d.incomes) add(get(d.codeDep.get(inc.categoryCode) ?? '-').allocated, inc.period, inc.amountTiyin);
    for (const p of months)
      for (const [dep, v] of Object.entries(d.summary.get(p)?.deps ?? {})) {
        if (!d.config.items.some((i) => i.departmentId === dep)) continue;
        for (const t of Object.values(v.parts ?? {})) add(get(dep).payroll, p, big(t));
      }
    for (const r of d.other) add(get(r.departmentId!).other, r.period, r.amountTiyin);

    const missing = months.filter((p) => d.config.items.some((i) => i.components.length) && d.summary.get(p)?.tarkib === false);
    for (const [key, x] of acc) {
      const item = d.config.items.find((i) => i.departmentId === key);
      // Sozlanmagan bo'lim — faqat Qo'mita daromadi bo'lsa (qoplash qoidasi yo'q)
      if (!item && key !== '-' && !d.depName.has(key)) continue;
      const allocated = sumOf(x.allocated);
      const payroll = sumOf(x.payroll);
      const other = sumOf(x.other);
      const monthsOut: QomitaRow['months'] = {};
      for (const p of months) {
        const a = x.allocated.get(p) ?? 0n;
        const pr = x.payroll.get(p) ?? 0n;
        const o = x.other.get(p) ?? 0n;
        if (a || pr || o) monthsOut[p] = { allocated: a.toString(), payroll: pr.toString(), other: o.toString() };
      }
      rows.push({
        key,
        label: key === '-' ? "Bo'lim ko'rsatilmagan Qo'mita daromadi" : (d.depName.get(key) ?? "Bo'lim (o'chirilgan)"),
        incomeCode: key === '-' ? null : (d.depCode.get(key) ?? null),
        components: (item?.components ?? []).map((c) => ({ code: c, name: d.compName.get(c) ?? c })),
        categories: item ? this.qomitaCats(d.depRules, key).map((c) => ({ code: c, label: d.catLabel.get(c) ?? c })) : [],
        allocatedTiyin: allocated.toString(),
        payrollTiyin: payroll.toString(),
        otherTiyin: other.toString(),
        coveredTiyin: (payroll + other).toString(),
        balanceTiyin: (allocated - payroll - other).toString(),
        months: monthsOut,
      });
    }
    rows.sort((a, b) => (a.key === '-' ? 1 : b.key === '-' ? -1 : a.label.localeCompare(b.label)));
    const t = (f: (r: QomitaRow) => string) => rows.reduce((s, r) => s + big(f(r)), 0n).toString();
    return {
      from: months[0]!,
      to: months[months.length - 1]!,
      months,
      /** Ish haqi tarkibi yuklanmagan oylar (ish haqi qismlari ajratilmagan) */
      tarkibMissing: missing,
      rows,
      totals: { allocatedTiyin: t((r) => r.allocatedTiyin), payrollTiyin: t((r) => r.payrollTiyin), otherTiyin: t((r) => r.otherTiyin), coveredTiyin: t((r) => r.coveredTiyin), balanceTiyin: t((r) => r.balanceTiyin) },
    };
  }

  /** Bo'lim tafsiloti: daromad yozuvlari, ish haqi qismlari (oyma-oy, xodimlar), boshqa moddalar */
  async detail(key: string, from: string, to: string) {
    const months = this.range(from, to);
    const d = await this.load(months);
    const item = d.config.items.find((i) => i.departmentId === key) ?? null;
    const code = key === '-' ? null : (d.depCode.get(key) ?? null);
    if (key !== '-' && !code) throw new NotFoundException("Bo'lim topilmadi");
    const bankIds = new Set((readStore((await this.prisma.setting.findUnique({ where: { key: BANK_ANALYSIS_KEY } }))?.value).posts ?? []).filter((p) => p.status === 'POSTED').map((p) => p.entryId));
    const approved = await this.approvedMap();
    const incomes = d.incomes
      .filter((i) => (code ? i.categoryCode === code : !d.codeDep.has(i.categoryCode)))
      .map((i) => ({
        id: i.id,
        date: i.date.toISOString().slice(0, 10),
        period: i.period,
        amountTiyin: i.amountTiyin.toString(),
        description: i.description,
        clientName: i.clientName,
        documentNo: i.contractNo,
        origin: bankIds.has(i.id) ? ('BANK' as const) : i.source === 'MANUAL' ? ('MANUAL' as const) : i.importBatchId?.startsWith(QOMITA_BANK_TAG) ? ('FILE' as const) : i.importBatchId?.startsWith('kassa:') ? ('KASSA' as const) : ('OTHER' as const),
        approved: approved[i.id] ?? null,
      }));
    // Ish haqi qismlari: modda × oy, xodimlar (davr bo'yicha jami)
    const parts = new Map<string, Money>();
    const people = new Map<string, { pinfl: string; fullName: string; parts: Money; months: Money }>();
    if (item)
      for (const p of months) {
        const dep = d.summary.get(p)?.deps?.[key];
        if (!dep) continue;
        for (const [c, v] of Object.entries(dep.parts ?? {})) {
          const m = parts.get(c) ?? new Map();
          add(m, p, big(v));
          parts.set(c, m);
        }
        for (const e of dep.employees ?? []) {
          const x = people.get(e.pinfl) ?? { pinfl: e.pinfl, fullName: e.fullName, parts: new Map(), months: new Map() };
          for (const [c, v] of Object.entries(e.parts ?? {})) {
            add(x.parts, c, big(v));
            add(x.months, p, big(v));
          }
          people.set(e.pinfl, x);
        }
      }
    const cats = new Map<string, Money>();
    const lastText = new Map<string, string>();
    if (item)
      for (const r of d.other.filter((x) => x.departmentId === key)) {
        const m = cats.get(r.categoryCode) ?? new Map();
        add(m, r.period, r.amountTiyin);
        cats.set(r.categoryCode, m);
        const txt = [r.counterparty, r.description].filter(Boolean).join(' — ');
        if (txt) lastText.set(r.categoryCode, txt.slice(0, 160));
      }
    return {
      key,
      label: key === '-' ? "Bo'lim ko'rsatilmagan Qo'mita daromadi" : (d.depName.get(key) ?? "Bo'lim (o'chirilgan)"),
      months,
      incomeCode: code,
      incomes,
      payrollParts: [...parts].map(([code, m]) => ({ code, name: d.compName.get(code) ?? code, totalTiyin: sumOf(m).toString(), months: toRec(m) })).sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : -1)),
      employees: [...people.values()].map((e) => ({ pinfl: e.pinfl, fullName: e.fullName, totalTiyin: sumOf(e.parts).toString(), parts: toRec(e.parts), months: toRec(e.months) })).sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : -1)),
      categories: [...cats].map(([code, m]) => ({ code, label: d.catLabel.get(code) ?? code, totalTiyin: sumOf(m).toString(), months: toRec(m), sub: lastText.get(code) ?? null })).sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : -1)),
      tarkibMissing: item?.components.length ? months.filter((p) => d.summary.get(p)?.tarkib === false) : [],
    };
  }

  // ═══════════ Daromad: qo'lda ═══════════

  /** Bo'limning Qo'mita daromad turi: sozlamada bo'lsa — o'sha, bo'lmasa — yaratiladi (qoplash qoidasi keyin belgilanadi) */
  private async incomeCodeFor(departmentId: string): Promise<string> {
    if (!departmentId) throw new BadRequestException("Bo'limni tanlang");
    const item = (await readQomita(this.prisma)).items.find((i) => i.departmentId === departmentId);
    if (item) return item.incomeCode;
    const dep = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, index: true, isActive: true } });
    if (!dep || !dep.isActive) throw new BadRequestException("Bo'lim topilmadi");
    return this.ensureIncomeCode(dep);
  }

  async addIncome(body: { departmentId?: unknown; period?: unknown; date?: unknown; amount?: unknown; description?: unknown }, userId: string) {
    const departmentId = typeof body?.departmentId === 'string' ? body.departmentId : '';
    const period = typeof body?.period === 'string' && PERIOD_RE.test(body.period) ? body.period : null;
    if (!period) throw new BadRequestException("Qaysi oy uchun — tanlang");
    const rawAmount = String(body?.amount ?? '').replace(/\s+/g, '').replace(',', '.');
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(rawAmount)) throw new BadRequestException("Summa noto'g'ri (so'mda)");
    const [whole, frac = ''] = rawAmount.split('.');
    const amount = BigInt(whole!) * 100n + BigInt((frac + '00').slice(0, 2));
    if (amount <= 0n) throw new BadRequestException("Summa 0 dan katta bo'lsin");
    let date = periodEnd(period);
    if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      const x = new Date(`${body.date}T12:00:00+05:00`);
      if (!Number.isNaN(x.getTime())) date = x;
    }
    const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 500) : "Qo'mita ajratmasi";
    const incomeCode = await this.incomeCodeFor(departmentId);
    const dep = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } });
    const income = await this.prisma.income.create({
      data: {
        date,
        period,
        amountTiyin: amount,
        paidTiyin: amount,
        categoryCode: incomeCode,
        segment: QOMITA_SEGMENT,
        regionCode: null,
        departmentId: null,
        districtId: null,
        description,
        clientName: "Qo'mita",
        paymentMethod: 'BANK',
        paymentStatus: 'PAID',
        source: 'MANUAL',
        section: 'DOIMIY',
        createdById: userId,
      },
      select: { id: true },
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'qomita_income', entityId: income.id, summary: `Qo'mita ajratmasi — ${dep?.name ?? ''}, ${period}: ${(Number(amount) / 100).toLocaleString('uz-UZ')} so'm` });
    await this.resyncKassa(userId, [period]);
    return { id: income.id, amountTiyin: amount.toString() };
  }

  /** Qo'mita daromadini tasdiqlash (tekshirildi) yoki tasdiqni olib tashlash — settings «qomita.income.approved» */
  async approveIncome(id: string, ok: boolean, userId: string) {
    const income = await this.prisma.income.findUnique({ where: { id }, select: { id: true, segment: true, deletedAt: true, period: true, amountTiyin: true } });
    if (!income || income.deletedAt || income.segment !== QOMITA_SEGMENT) throw new NotFoundException('Yozuv topilmadi');
    const by = (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
    await runExclusive(`setting:${APPROVED_KEY}`, async () => {
      const cur = await this.approvedMap();
      if (ok) cur[id] = { at: new Date().toISOString(), by };
      else delete cur[id];
      const value = cur as object;
      await this.prisma.setting.upsert({ where: { key: APPROVED_KEY }, create: { key: APPROVED_KEY, value }, update: { value } });
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'qomita_income', entityId: id, summary: `Qo'mita ajratmasi ${ok ? 'tasdiqlandi' : 'tasdig‘i olib tashlandi'}: ${income.period}, ${(Number(income.amountTiyin) / 100).toLocaleString('uz-UZ')} so'm` });
    return { approved: ok };
  }

  private async approvedMap(): Promise<Record<string, { at: string; by: string }>> {
    const v = (await this.prisma.setting.findUnique({ where: { key: APPROVED_KEY } }))?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, { at: string; by: string }>) : {};
  }

  /**
   * Qo'mita daromadini o'chirish (yumshoq — Savatdan tiklash mumkin): qo'lda, ko'chirma faylidan yoki bank tahlilidan
   * yo'naltirilgani (bu holda bank yo'naltirishi ham bekor qilinadi — to'lov yana «yo'naltirilmagan» bo'ladi).
   * Kassadan yozilgan farq qatori bu yerda o'chirilmaydi — u kassa bo'yicha hisoblanadi.
   */
  async removeIncome(id: string, userId: string) {
    const period = await this.removeOne(id, userId);
    await this.resyncKassa(userId, [period]);
    return { removed: true };
  }

  /** Bir nechta ajratmani birdan o'chirish (Qo'mita mablag'lari › «O'chirish»): kassa farqi oxirida bir marta qayta hisoblanadi */
  async removeIncomes(body: { ids?: unknown }, userId: string) {
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].slice(0, 500) : [];
    if (!ids.length) throw new BadRequestException("O'chiriladigan ajratmalarni tanlang");
    const periods: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        periods.push(await this.removeOne(id, userId));
      } catch (e) {
        failed.push({ id, message: (e as Error).message });
      }
    }
    if (periods.length) await this.resyncKassa(userId, periods);
    return { removed: periods.length, failed };
  }

  /** Davrdagi hamma Qo'mita ajratmalari (o'chirish ro'yxati uchun): bo'lim, manba, o'chirsa bo'ladimi */
  async incomes(from: string, to: string) {
    const months = this.range(from, to);
    const [rows, cats, store] = await Promise.all([
      this.prisma.income.findMany({
        where: { segment: QOMITA_SEGMENT, deletedAt: null, period: { in: months } },
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, description: true, contractNo: true, source: true, importBatchId: true },
        orderBy: [{ period: 'asc' }, { date: 'asc' }],
      }),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: QOMITA_INCOME_PREFIX } }, select: { code: true, label: true } }),
      this.prisma.setting.findUnique({ where: { key: BANK_ANALYSIS_KEY } }),
    ]);
    const bankIds = new Set((readStore(store?.value).posts ?? []).filter((p) => p.status === 'POSTED').map((p) => p.entryId));
    const label = new Map(cats.map((c) => [c.code, c.label.replace(/^Qo'mita ajratmasi:\s*/, '')]));
    return rows.map((i) => {
      const origin = i.importBatchId?.startsWith('kassa:') ? ('KASSA' as const) : bankIds.has(i.id) ? ('BANK' as const) : i.source === 'MANUAL' ? ('MANUAL' as const) : i.importBatchId?.startsWith(QOMITA_BANK_TAG) ? ('FILE' as const) : ('OTHER' as const);
      return {
        id: i.id,
        date: i.date.toISOString().slice(0, 10),
        period: i.period,
        amountTiyin: i.amountTiyin.toString(),
        department: label.get(i.categoryCode) ?? i.categoryCode,
        description: i.description,
        documentNo: i.contractNo,
        origin,
        canDelete: origin === 'MANUAL' || origin === 'FILE' || origin === 'BANK',
      };
    });
  }

  /** Bitta ajratmani o'chirish (kassa qayta hisoblanmaydi) — o'chirilgan oy qaytadi */
  private async removeOne(id: string, userId: string): Promise<string> {
    const income = await this.prisma.income.findUnique({ where: { id }, select: { id: true, segment: true, source: true, deletedAt: true, amountTiyin: true, period: true, categoryCode: true, importBatchId: true } });
    if (!income || income.deletedAt || income.segment !== QOMITA_SEGMENT) throw new NotFoundException('Yozuv topilmadi');
    if (income.importBatchId?.startsWith('kassa:')) throw new BadRequestException("Bu qator kunlik ma'lumotnomadan (kassa farqi) — Buxgalteriya › Markaz daromadlari sahifasida hisoblanadi");
    const post = this.bank ? readStore((await this.prisma.setting.findUnique({ where: { key: BANK_ANALYSIS_KEY } }))?.value).posts?.find((p) => p.status === 'POSTED' && p.entryId === id) : undefined;
    if (post) {
      await this.bank!.unroute({ ids: [post.id] }, userId);
    } else {
      if (income.source !== 'MANUAL' && !income.importBatchId?.startsWith(QOMITA_BANK_TAG)) throw new BadRequestException("Bu yozuv boshqa manbadan (bank ko'chirmasi tahlili yoki import) — o'sha yerda o'chiring");
      await this.prisma.income.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    await this.audit.log({ userId, action: 'DELETE', entity: 'qomita_income', entityId: id, summary: `Qo'mita ajratmasi o'chirildi${post ? " (bank yo'naltirishi bekor qilindi)" : ''}: ${income.period}, ${(Number(income.amountTiyin) / 100).toLocaleString('uz-UZ')} so'm` });
    return income.period;
  }

  // ═══════════ Daromad: bank ko'chirmasidan ═══════════

  /**
   * Bank ko'chirmasidagi yo'naltirilmagan kirimlar: Qo'mitadan kelganlari (yoki q — qidiruv matni bo'yicha har qanday kirim).
   * Tozalangan (ro'yxatdan chiqarilgan) kirimlar chiqmaydi; dismissed = true — faqat tozalanganlar (tiklash uchun).
   */
  async bankCandidates(q?: string, dismissed = false) {
    const row = await this.prisma.setting.findUnique({ where: { key: BANK_ANALYSIS_KEY } });
    const store = readStore(row?.value);
    const posted = new Set(store.posts.filter((p) => p.status === 'POSTED').map((p) => rk(p.account, p.rowId)));
    const needle = typeof q === 'string' ? q.trim().toLowerCase().slice(0, 60) : '';
    const out: { account: string; accountLabel: string; rowId: string; docDate: string; docNo: string; payer: string; amountTiyin: string; purpose: string; matched: boolean; dismissed: { at: string; by: string; reason: string | null } | null }[] = [];
    let dismissedCount = 0;
    for (const acc of Object.values(store.accounts))
      for (const m of Object.values(acc.months ?? {}))
        for (const r of m.rows ?? []) {
          const k = rk(acc.key, r.id);
          if (r.dir !== 'IN' || posted.has(k)) continue;
          const matched = QOMITA_RE.test(r.accountName) || QOMITA_RE.test(r.purpose);
          const hit = needle ? `${r.accountName} ${r.purpose} ${r.docNo}`.toLowerCase().includes(needle) : matched;
          if (!hit) continue;
          const dis = store.dismissed[k] ?? null;
          if (dis) dismissedCount += 1;
          if (Boolean(dis) !== dismissed) continue;
          out.push({ account: acc.key, accountLabel: acc.label, rowId: r.id, docDate: r.docDate, docNo: r.docNo, payer: r.accountName, amountTiyin: r.amountTiyin, purpose: r.purpose, matched, dismissed: dis ? { at: dis.at, by: dis.by, reason: dis.reason ?? null } : null });
        }
    out.sort((a, b) => b.docDate.localeCompare(a.docDate));
    return { total: out.length, dismissedCount, items: out.slice(0, 300) };
  }

  /** Kirimlarni tozalash — ro'yxatdan chiqarish (yozuv yaratilmaydi; bank tahlilida «Bekor qilinganlar»da turadi, tiklanadi) */
  async bankDismiss(body: { items?: unknown; reason?: unknown }, userId: string) {
    if (!this.bank) throw new BadRequestException("Bank ko'chirmasi moduli ulanmagan");
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason : "Qo'mita mablag'larida tozalandi (daromadga yozilmaydi)";
    return this.bank.dismiss({ items: body?.items, reason }, userId);
  }

  /** Tozalangan kirimlarni qaytarish */
  async bankUndismiss(body: { items?: unknown }, userId: string) {
    if (!this.bank) throw new BadRequestException("Bank ko'chirmasi moduli ulanmagan");
    return this.bank.undismiss({ items: body?.items }, userId);
  }

  /** Tanlangan kirimlar → shu bo'limning Qo'mita daromadi (bank ko'chirmasi yo'naltirishi orqali — bekor qilish ham o'sha yerda) */
  async bankRoute(body: { items?: unknown; departmentId?: unknown; description?: unknown; force?: unknown; skipDuplicates?: unknown }, userId: string) {
    if (!this.bank) throw new BadRequestException("Bank ko'chirmasi moduli ulanmagan");
    const departmentId = typeof body?.departmentId === 'string' ? body.departmentId : '';
    const incomeCode = await this.incomeCodeFor(departmentId);
    const res = await this.bank.route({ items: body?.items, place: { unit: QOMITA_SEGMENT }, categoryCode: incomeCode, section: 'DOIMIY', description: body?.description, force: body?.force, skipDuplicates: body?.skipDuplicates }, userId);
    await this.resyncKassa(userId);
    return res;
  }
}
