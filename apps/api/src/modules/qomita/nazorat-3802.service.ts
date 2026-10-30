import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { runExclusive } from '../../common/locks';
import { classify, readRules, RULES_KEY, sortedRules } from '../acc-23106/acc23106.rules';
import { readStore as read23106, STORE_KEY as ACC23106_KEY } from '../acc-23106/acc23106.store';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthsBetween } from '../../common/period';
import { SEGMENTS } from '../../common/segments/segments';
import { candidates, computeMonth, matchPerson, nameKey, vedCoverage, type LinkCode, type Nz23106Row, type NzShtatSection, type NzTarkibRow, type NzVedEmployee } from './nazorat-3802.compute';
import { QOMITA_INCOME_PREFIX, QOMITA_SEGMENT, readQomita } from './qomita.util';
import { Shtat3802Service } from './shtat-3802.service';
import { VED_INDEX_KEY, vedKey, type VedIndexEntry } from './vedomost-3802.service';
import type { VedSection } from './vedomost-3802.parse';

// ═══════════════════════════════════════════════════════════
// 3802 › Nazorat zanjiri — ma'lumot yig'ish va sozlamalar (hisob — nazorat-3802.compute.ts).
// Har ochilganda qayta hisoblanadi (yangi jadval yo'q). Foydalanuvchi sozlamalari — settings:
//  «3802.nazorat.links»    — ism kaliti → JShShIR (qo'lda bog'lash; null — «tarkibda yo'q» deb tasdiqlangan);
//  «3802.nazorat.sections» — vedomost bo'limi → shtat bo'limi (null — shtatda yo'q deb tasdiqlangan);
//  «3802.nazorat.notes»    — «<oy>|<halqa>|<element>» → izoh (tushuntirilgan farq);
//  «3802.nazorat.config»   — farq chegarasi (tiyin).
// ═══════════════════════════════════════════════════════════

const LINKS_KEY = '3802.nazorat.links';
const SECTIONS_KEY = '3802.nazorat.sections';
const NOTES_KEY = '3802.nazorat.notes';
const CONFIG_KEY = '3802.nazorat.config';
const DEFAULT_TOLERANCE = 100_000n; // 1 000 so'm
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const addMonth = (p: string, k: number) => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const LINK_CODES: LinkCode[] = ['TARKIB', 'SHTAT', 'D23106', 'QOPLASH', 'AJRATISH'];

interface NoteEntry {
  note: string;
  by: string;
  at: string;
}

@Injectable()
export class Nazorat3802Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly shtat: Shtat3802Service,
  ) {}

  private async read<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.prisma.setting.findUnique({ where: { key } }))?.value;
    return v && typeof v === 'object' ? (v as T) : fallback;
  }

  private async write(key: string, value: unknown) {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  async tolerance(): Promise<bigint> {
    const c = await this.read<{ toleranceTiyin?: string }>(CONFIG_KEY, {});
    try {
      return c.toleranceTiyin !== undefined ? BigInt(c.toleranceTiyin) : DEFAULT_TOLERANCE;
    } catch {
      return DEFAULT_TOLERANCE;
    }
  }

  /** Qabul qilingan vedomost oylari (o'sish tartibida) */
  private async vedPeriods(): Promise<string[]> {
    const v = await this.read<{ periods?: Record<string, VedIndexEntry> }>(VED_INDEX_KEY, {});
    return Object.keys(v.periods ?? {})
      .filter((p) => PERIOD_RE.test(p))
      .sort();
  }

  /** Oylar uchun hamma kirish ma'lumoti (bir yo'la) */
  private async load(periods: string[]) {
    const [vedRows, batches, view, deps, config, links, sectionMap, notes, tol, accRow, rulesRow] = await Promise.all([
      this.prisma.setting.findMany({ where: { key: { in: periods.map(vedKey) } }, select: { key: true, value: true } }),
      this.prisma.salaryCompositionBatch.findMany({ where: { cancelledAt: null, period: { in: periods } }, select: { id: true, period: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }] }),
      this.shtat.view(),
      this.prisma.department.findMany({ select: { id: true, name: true, index: true, isActive: true } }),
      readQomita(this.prisma),
      this.read<Record<string, string | null>>(LINKS_KEY, {}),
      this.read<Record<string, string | null>>(SECTIONS_KEY, {}),
      this.read<Record<string, NoteEntry>>(NOTES_KEY, {}),
      this.tolerance(),
      this.prisma.setting.findUnique({ where: { key: ACC23106_KEY }, select: { value: true } }),
      this.prisma.setting.findUnique({ where: { key: RULES_KEY }, select: { value: true } }),
    ]);
    // 23106: ta'til puli va moddiy yordam (tur — qoidalar va qo'lda belgilash bilan, 23106 sahifasidagidek)
    const acc = read23106(accRow?.value);
    const rs = readRules(rulesRow?.value ?? null);
    const sorted = sortedRules(rs);
    const pay = new Map<string, Nz23106Row[]>();
    for (const [month, st] of Object.entries(acc.months))
      for (const r of st.rows ?? []) {
        const kind = classify(r, rs, sorted).kind;
        if (kind !== 'TATIL' && kind !== 'MODDIY' && kind !== 'ISH_HAQI') continue;
        pay.set(month, [...(pay.get(month) ?? []), { pinfl: r.pinfl, fullName: r.fullName ?? r.commentName ?? r.accountName, docDate: r.docDate, amountTiyin: BigInt(r.debitTiyin || '0'), kind }]);
      }
    const acc23106Months = new Set(Object.keys(acc.months));
    // Tarkib: har oy — eng so'nggi faol yuklash
    const batchOf = new Map<string, string>();
    for (const b of batches) if (!batchOf.has(b.period)) batchOf.set(b.period, b.id);
    const batchIds = [...batchOf.values()];
    const [rows, items] = batchIds.length
      ? await Promise.all([
          this.prisma.salaryCompositionRow.findMany({ where: { batchId: { in: batchIds } }, select: { id: true, batchId: true, employeePinfl: true, fullName: true, totalTiyin: true } }),
          this.prisma.salaryCompositionItem.findMany({ where: { batchId: { in: batchIds }, componentCode: { in: ['OKLAD', 'OKLAD_40'] } }, select: { rowId: true, componentCode: true, amountTiyin: true } }),
        ])
      : [[], []];
    const amt = new Map<string, { o: bigint; u: bigint }>();
    for (const it of items) {
      const x = amt.get(it.rowId) ?? { o: 0n, u: 0n };
      if (it.componentCode === 'OKLAD') x.o += it.amountTiyin;
      else x.u += it.amountTiyin;
      amt.set(it.rowId, x);
    }
    const tarkib = new Map<string, NzTarkibRow[]>();
    const periodOfBatch = new Map([...batchOf].map(([p, id]) => [id, p]));
    for (const r of rows) {
      const p = periodOfBatch.get(r.batchId)!;
      const a = amt.get(r.id) ?? { o: 0n, u: 0n };
      tarkib.set(p, [...(tarkib.get(p) ?? []), { pinfl: r.employeePinfl, fullName: r.fullName ?? '', okladTiyin: a.o, ustamaTiyin: a.u, totalTiyin: r.totalTiyin }]);
    }
    // Shtat bo'limlari (ikkala toifa)
    const shtat: NzShtatSection[] = [];
    for (const kind of ['OLADI', 'OLMAYDI'] as const) {
      const s = view[kind];
      if (!s) continue;
      for (const sec of s.sheet.sections)
        shtat.push({ kind, key: sec.settingKey, name: sec.name, departmentId: sec.departmentId, coverage: sec.coverage, positions: sec.positions.map((p) => ({ row: p.row, name: p.name, units: p.units, salaryTiyin: p.salaryTiyin })) });
    }
    // Qo'mita daromadi: daromad turi → bo'lim
    const codeDep = new Map<string, string>(deps.map((d) => [`${QOMITA_INCOME_PREFIX}${d.index}`, d.id]));
    for (const i of config.items) codeDep.set(i.incomeCode, i.departmentId);
    const incomes = await this.prisma.income.findMany({ where: { segment: QOMITA_SEGMENT, deletedAt: null, period: { in: periods } }, select: { period: true, categoryCode: true, amountTiyin: true } });
    const income = new Map<string, Map<string, bigint>>();
    for (const i of incomes) {
      const m = income.get(i.period) ?? new Map<string, bigint>();
      const dep = codeDep.get(i.categoryCode) ?? '-';
      m.set(dep, (m.get(dep) ?? 0n) + i.amountTiyin);
      income.set(i.period, m);
    }
    const ved = new Map<string, NzVedEmployee[]>();
    for (const r of vedRows) {
      const v = r.value as { period?: string; sections?: VedSection[] } | null;
      if (!v?.period || !Array.isArray(v.sections)) continue;
      ved.set(
        v.period,
        v.sections.flatMap((s) => s.employees.map((e) => ({ section: s.name, fullName: e.fullName, position: e.position, amounts: e.amounts as Record<string, string>, totalTiyin: e.totalTiyin }))),
      );
    }
    return { pay, acc23106Months, ved, tarkib, shtat, departments: deps.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name })), income, links, sectionMap, notes, tol };
  }

  private month(d: Awaited<ReturnType<Nazorat3802Service['load']>>, period: string) {
    const prefix = `${period}|`;
    const notes = Object.fromEntries(
      Object.entries(d.notes)
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => [k.slice(prefix.length), v.note]),
    );
    return computeMonth({
      period,
      ved: d.ved.get(period) ?? [],
      tarkib: d.tarkib.get(period) ?? null,
      shtat: d.shtat,
      departments: d.departments,
      income: d.income.get(period) ?? new Map(),
      links: d.links,
      // Oy ±1 (ta'til puli ta'tildan oldin yoki keyin to'lanishi mumkin); shu oy 23106 yuklanmagan bo'lsa — null
      pay23106: d.acc23106Months.has(period) ? [addMonth(period, -1), period, addMonth(period, 1)].flatMap((p) => d.pay.get(p) ?? []) : null,
      sectionMap: d.sectionMap,
      notes,
      toleranceTiyin: d.tol,
    });
  }

  /** Umumiy ko'rinish: har qabul qilingan oy — halqalar holati, qoplash va yil boshidan yig'ma qoldiq (ismlarsiz) */
  async overview() {
    const periods = await this.vedPeriods();
    const d = await this.load(periods);
    const ytd = new Map<string, { needed: bigint; income: bigint }>();
    const months = periods.map((p) => {
      const m = this.month(d, p);
      const y = p.slice(0, 4);
      const acc = ytd.get(y) ?? { needed: 0n, income: 0n };
      acc.needed += BigInt(m.qoplash.neededTiyin);
      acc.income += BigInt(m.qoplash.incomeTiyin);
      ytd.set(y, acc);
      return {
        period: p,
        links: m.links.map((l) => ({ code: l.code, status: l.status, warn: l.warn, explained: l.explained })),
        employees: (d.ved.get(p) ?? []).length,
        neededTiyin: m.qoplash.neededTiyin,
        incomeTiyin: m.qoplash.incomeTiyin,
        /** Yil boshidan shu oygacha: kelgan − kerak */
        ytdBalanceTiyin: (acc.income - acc.needed).toString(),
      };
    });
    return { toleranceTiyin: d.tol.toString(), months: months.reverse() };
  }

  /** Bitta oy — to'liq (xodimlar bilan; shaxsiy ma'lumot) */
  async detail(period: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const periods = await this.vedPeriods();
    if (!periods.includes(period)) throw new NotFoundException(`${period} — 3802 vedomosti qabul qilinmagan`);
    const d = await this.load(periods.filter((p) => p.slice(0, 4) === period.slice(0, 4) && p <= period));
    const m = this.month(d, period);
    // Yil boshidan bo'lim bo'yicha yig'ma
    const ytd = new Map<string, { needed: bigint; income: bigint }>();
    for (const p of periods.filter((x) => x.slice(0, 4) === period.slice(0, 4) && x <= period)) {
      const mm = p === period ? m : this.month(d, p);
      for (const it of mm.qoplash.items) {
        const x = ytd.get(it.key) ?? { needed: 0n, income: 0n };
        x.needed += BigInt(it.neededTiyin);
        x.income += BigInt(it.incomeTiyin);
        ytd.set(it.key, x);
      }
    }
    const tarkibRows = d.tarkib.get(period) ?? [];
    return {
      ...m,
      toleranceTiyin: d.tol.toString(),
      qoplash: { ...m.qoplash, items: m.qoplash.items.map((it) => ({ ...it, ytdBalanceTiyin: ytd.has(it.key) ? (ytd.get(it.key)!.income - ytd.get(it.key)!.needed).toString() : '0' })) },
      tarkib: {
        ...m.tarkib,
        // Topilmaganlar uchun — o'xshash ismlar (qo'lda bog'lash)
        items: m.tarkib.items.map((x) => (x.status === 'NOT_FOUND' ? { ...x, candidates: candidates(x.fullName, tarkibRows).map((c) => ({ pinfl: c.pinfl, fullName: c.fullName })) } : x)),
      },
      shtatSections: d.shtat.map((s) => ({ key: s.key, name: s.name, kind: s.kind })),
    };
  }

  // ═══════════ Qo'mita pullarining sarfi ═══════════
  // Ikki oqim:
  //  • 3802 HOVUZI — vedomostdagi xodimlari bor bo'limlar (Oklad + 40% yoki to'liq, Nazorat zanjiri 4-halqasi qoidasi):
  //    bo'limga kelgan 3802 puli («3802 Call Markaz») hamma bo'limlar qoplashi bilan birga solishtiriladi (3802 qoldig'i);
  //  • XIZMAT SHARTNOMASI — pul kelgan, lekin 3802 qoplashi yo'q bo'lim (masalan, Marksheyder): kelgan pul bo'limning (va shu
  //    nomdagi yo'nalishning) to'liq sarfi bilan — moddalar bo'yicha.
  // Xodimlar: tarkib bo'yicha hisoblangan ish haqi va 3802 qoplaydigan qismi oyma-oy.
  // Faqat ko'rsatish — xarajatlar jadvaliga hech narsa yozilmaydi, umumiy xarajat o'zgarmaydi.

  private async sarfData(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    if (!months.length) throw new BadRequestException("«Dan» oyi «Gacha»dan keyin bo'lmasin");
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const d = await this.load(months);
    const depName = new Map(d.departments.map((x) => [x.id, x.name]));
    // Har oy — vedomost xodimlari qoplashi (bo'lim bo'yicha)
    const cov = new Map(months.map((p) => [p, vedCoverage(d.ved.get(p) ?? [], d.shtat, d.departments, d.sectionMap)]));
    // Bo'limlar: kelgan pul yoki 3802 qoplashi bor
    const units = new Set<string>();
    for (const p of months) {
      for (const dep of d.income.get(p)?.keys() ?? []) units.add(dep);
      for (const c of cov.get(p)!) if (c.departmentId && c.coveredTiyin > 0n) units.add(c.departmentId);
    }
    const depIds = [...units].filter((u) => u !== '-');
    // Bo'lim nomi bilan bir xil yo'nalish (Marksheyder bo'limi ↔ «MARKSHEYDER» yo'nalishi xarajatlari)
    const segOf = new Map<string, string>();
    for (const id of depIds) {
      const seg = SEGMENTS.find((x) => x.code !== 'QOMITA' && nameKey(x.label) === nameKey(depName.get(id) ?? ''));
      if (seg) segOf.set(id, seg.code);
    }
    const depOfSeg = new Map([...segOf].map(([dep, seg]) => [seg, dep]));
    const [expenses, cats, emps] = await Promise.all([
      depIds.length
        ? this.prisma.expense.findMany({
            where: { deletedAt: null, period: { in: months }, OR: [{ departmentId: { in: depIds } }, ...(segOf.size ? [{ segment: { in: [...segOf.values()] } }] : [])] },
            select: { period: true, amountTiyin: true, categoryCode: true, departmentId: true, segment: true },
          })
        : Promise.resolve([] as { period: string; amountTiyin: bigint; categoryCode: string; departmentId: string | null; segment: string | null }[]),
      this.prisma.category.findMany({ select: { code: true, label: true } }),
      depIds.length ? this.prisma.employee.findMany({ where: { departmentId: { in: depIds } }, select: { pinfl: true, fullName: true, departmentId: true } }) : Promise.resolve([] as { pinfl: string; fullName: string; departmentId: string | null }[]),
    ]);
    return { months, d, depName, cov, units: [...units], segOf, depOfSeg, expenses, catLabel: new Map(cats.map((c) => [c.code, c.label])), emps };
  }

  private sarfUnitOf(x: Awaited<ReturnType<Nazorat3802Service['sarfData']>>, unit: string) {
    const { months, d } = x;
    const zero = () => Object.fromEntries(months.map((p) => [p, 0n])) as Record<string, bigint>;
    const income = zero();
    const spend = zero();
    const covered = zero();
    for (const p of months) {
      income[p] = d.income.get(p)?.get(unit) ?? 0n;
      for (const c of x.cov.get(p)!) if (c.departmentId === unit) covered[p]! += c.coveredTiyin;
    }
    const cats = new Map<string, Record<string, bigint>>();
    if (unit !== '-')
      for (const e of x.expenses) {
        const owner = e.departmentId && x.units.includes(e.departmentId) ? e.departmentId : e.segment ? (x.depOfSeg.get(e.segment) ?? null) : null;
        if (owner !== unit) continue;
        spend[e.period]! += e.amountTiyin;
        const m = cats.get(e.categoryCode) ?? zero();
        m[e.period]! += e.amountTiyin;
        cats.set(e.categoryCode, m);
      }
    const sum = (r: Record<string, bigint>) => Object.values(r).reduce((t, v) => t + v, 0n);
    const str = (r: Record<string, bigint>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toString()]));
    let ci = 0n;
    let cs = 0n;
    let cc = 0n;
    const cumulative = months.map((p) => {
      ci += income[p]!;
      cs += spend[p]!;
      cc += covered[p]!;
      return { period: p, fullBalanceTiyin: (ci - cs).toString(), balance3802Tiyin: (ci - cc).toString() };
    });
    return {
      key: unit,
      /** POOL — 3802 a'zosi; CONTRACT — xizmat shartnomasi (to'liq sarf bilan); UNASSIGNED — bo'lim ko'rsatilmagan ajratma */
      kind: unit === '-' ? ('UNASSIGNED' as const) : sum(covered) > 0n ? ('POOL' as const) : ('CONTRACT' as const),
      departmentId: unit === '-' ? null : unit,
      label: unit === '-' ? "Bo'lim ko'rsatilmagan ajratma" : (x.depName.get(unit) ?? "Bo'lim (o'chirilgan)"),
      segment: x.segOf.get(unit) ?? null,
      incomeTiyin: sum(income).toString(),
      spendTiyin: sum(spend).toString(),
      coveredTiyin: sum(covered).toString(),
      fullBalanceTiyin: (sum(income) - sum(spend)).toString(),
      balance3802Tiyin: (sum(income) - sum(covered)).toString(),
      byMonth: Object.fromEntries(months.map((p) => [p, { income: income[p]!.toString(), spend: spend[p]!.toString(), covered: covered[p]!.toString() }])),
      cumulative,
      categories: [...cats]
        .map(([code, m]) => ({ code, label: x.catLabel.get(code) ?? code, totalTiyin: sum(m).toString(), byMonth: str(m) }))
        .sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : -1)),
    };
  }

  /** Ikki oqim bo'yicha sarf (ismsiz): 3802 va xizmat shartnomalari */
  async sarf(from: string, to: string) {
    const x = await this.sarfData(from, to);
    const units = x.units.map((u) => this.sarfUnitOf(x, u));
    const pool = units.filter((u) => u.kind === 'POOL').sort((a, b) => (BigInt(b.coveredTiyin) > BigInt(a.coveredTiyin) ? 1 : -1));
    const contracts = units.filter((u) => u.kind === 'CONTRACT').sort((a, b) => (BigInt(b.incomeTiyin) > BigInt(a.incomeTiyin) ? 1 : -1));
    const unassigned = units.find((u) => u.kind === 'UNASSIGNED') ?? null;
    const T = (l: typeof units, f: (u: (typeof units)[number]) => string) => l.reduce((s, u) => s + BigInt(f(u)), 0n);
    // 3802 oyma-oy: kelgan (3802 bo'limlariga) va qoplanishi kerak (hamma 3802 bo'limlari)
    let ci = 0n;
    let cc = 0n;
    const poolMonths = x.months.map((p) => {
      const inc = pool.reduce((t, u) => t + BigInt(u.byMonth[p]!.income), 0n);
      const cov = pool.reduce((t, u) => t + BigInt(u.byMonth[p]!.covered), 0n);
      ci += inc;
      cc += cov;
      return { period: p, incomeTiyin: inc.toString(), coveredTiyin: cov.toString(), balanceTiyin: (ci - cc).toString() };
    });
    const pIncome = T(pool, (u) => u.incomeTiyin);
    const pCovered = T(pool, (u) => u.coveredTiyin);
    return {
      from: x.months[0]!,
      to: x.months[x.months.length - 1]!,
      months: x.months,
      /** 3802 vedomosti bor oylar (qoplaydigan qism faqat shu oylar uchun) */
      vedMonths: x.months.filter((p) => (x.d.ved.get(p) ?? []).length > 0),
      pool: { incomeTiyin: pIncome.toString(), coveredTiyin: pCovered.toString(), balanceTiyin: (pIncome - pCovered).toString(), months: poolMonths, units: pool },
      contracts: {
        incomeTiyin: T(contracts, (u) => u.incomeTiyin).toString(),
        spendTiyin: T(contracts, (u) => u.spendTiyin).toString(),
        balanceTiyin: T(contracts, (u) => u.fullBalanceTiyin).toString(),
        units: contracts,
      },
      unassigned,
    };
  }

  /** Bitta bo'lim — xodimlar: tarkib bo'yicha hisoblangan ish haqi va 3802 qoplaydigan qismi oyma-oy (shaxsiy ma'lumot) */
  /** Ish haqi tarkibi (oy → qatorlar) va qo'lda bog'lashlar — boshqa hisoblar (Qo'mita › Solishtirma) uchun */
  async tarkibAndLinks(periods: string[]): Promise<{ tarkib: Map<string, NzTarkibRow[]>; links: Record<string, string | null> }> {
    const d = await this.load(periods);
    return { tarkib: d.tarkib, links: d.links };
  }

  async sarfUnit(unit: string, from: string, to: string) {
    const x = await this.sarfData(from, to);
    if (!x.units.includes(unit)) throw new NotFoundException("Bo'lim Qo'mita sarfida yo'q");
    const base = this.sarfUnitOf(x, unit);
    type Emp = { pinfl: string | null; fullName: string; months: Record<string, { paid: bigint; covered: bigint }>; inTarkib: boolean; inVedomost: boolean };
    const people = new Map<string, Emp>();
    const of = (k: string, pinfl: string | null, fullName: string) => {
      const e = people.get(k) ?? { pinfl, fullName, months: {}, inTarkib: false, inVedomost: false };
      people.set(k, e);
      return e;
    };
    const mine = new Set(x.emps.filter((e) => e.departmentId === unit).map((e) => e.pinfl));
    // Shu oy tarkibi bo'lmasa ham bir xil odam bitta qatorda — hamma oylar tarkibi bo'yicha moslanadi
    const allRows = [...new Map(x.months.flatMap((p) => x.d.tarkib.get(p) ?? []).map((r) => [r.pinfl, r])).values()];
    for (const p of x.months) {
      const rows = x.d.tarkib.get(p) ?? [];
      // Tarkib: shu bo'lim xodimlari (hisoblangan ish haqi)
      for (const r of rows.filter((r) => mine.has(r.pinfl))) {
        const e = of(r.pinfl, r.pinfl, r.fullName);
        e.inTarkib = true;
        const m = (e.months[p] ??= { paid: 0n, covered: 0n });
        m.paid += r.totalTiyin;
      }
      // Vedomost: shu bo'limga tushadigan xodimlar (qoplanadigan qismi) — tarkib bilan ism / qo'lda bog'lash orqali
      for (const c of x.cov.get(p)!.filter((c) => c.departmentId === unit)) {
        const m1 = matchPerson(c.e.fullName, rows, x.d.links);
        const m0 = m1.row ? m1 : matchPerson(c.e.fullName, allRows, x.d.links);
        const k = m0.row ? m0.row.pinfl : `v:${nameKey(c.e.fullName)}`;
        const e = of(k, m0.row?.pinfl ?? null, m0.row?.fullName ?? c.e.fullName);
        e.inVedomost = true;
        const m = (e.months[p] ??= { paid: 0n, covered: 0n });
        m.covered += c.coveredTiyin;
      }
    }
    const employees = [...people.values()]
      .map((e) => {
        const paid = Object.values(e.months).reduce((t, m) => t + m.paid, 0n);
        const covered = Object.values(e.months).reduce((t, m) => t + m.covered, 0n);
        return {
          pinfl: e.pinfl,
          fullName: e.fullName,
          inTarkib: e.inTarkib,
          inVedomost: e.inVedomost,
          paidTiyin: paid.toString(),
          coveredTiyin: covered.toString(),
          months: Object.fromEntries(Object.entries(e.months).map(([p, m]) => [p, { paid: m.paid.toString(), covered: m.covered.toString() }])),
        };
      })
      .sort((a, b) => (BigInt(b.paidTiyin) + BigInt(b.coveredTiyin) > BigInt(a.paidTiyin) + BigInt(a.coveredTiyin) ? 1 : -1));
    return { ...base, months: x.months, employees };
  }

  // ─────────── Sozlamalar ───────────

  /** Qo'lda bog'lash: vedomost ismi → tarkib JShShIR (null — «tarkibda yo'q» deb tasdiqlash; undefined — bog'lashni bekor qilish) */
  async setLink(body: { fullName?: unknown; pinfl?: unknown }, userId: string) {
    const fullName = typeof body?.fullName === 'string' ? body.fullName : '';
    const key = nameKey(fullName);
    if (!key) throw new BadRequestException('Xodim ismi kerak');
    const pinfl = body?.pinfl === null ? null : typeof body?.pinfl === 'string' ? body.pinfl.trim() : undefined;
    if (typeof pinfl === 'string' && !/^\d{14}$/.test(pinfl)) throw new BadRequestException("JShShIR noto'g'ri");
    if (typeof pinfl === 'string' && !(await this.prisma.salaryCompositionRow.findFirst({ where: { employeePinfl: pinfl }, select: { id: true } }))) throw new NotFoundException('Bu JShShIR ish haqi tarkibida yo‘q');
    await runExclusive(`setting:${LINKS_KEY}`, async () => {
      const cur = await this.read<Record<string, string | null>>(LINKS_KEY, {});
      if (pinfl === undefined) delete cur[key];
      else cur[key] = pinfl;
      await this.write(LINKS_KEY, cur);
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'nazorat_3802', entityId: 'links', summary: `3802 nazorat: xodim bog'lash ${pinfl === undefined ? 'bekor qilindi' : pinfl === null ? '— «tarkibda yo‘q» deb tasdiqlandi' : 'saqlandi'}` });
    return { saved: true };
  }

  /** Vedomost bo'limi → shtat bo'limi (null — shtatda yo'q; undefined — taklifga qaytarish) */
  async setSection(body: { section?: unknown; shtatKey?: unknown }, userId: string) {
    const key = nameKey(typeof body?.section === 'string' ? body.section : '');
    if (!key) throw new BadRequestException("Bo'lim nomi kerak");
    const shtatKey = body?.shtatKey === null ? null : typeof body?.shtatKey === 'string' && body.shtatKey ? body.shtatKey : undefined;
    if (typeof shtatKey === 'string') {
      const view = await this.shtat.view();
      const ok = (['OLADI', 'OLMAYDI'] as const).some((k) => view[k]?.sheet.sections.some((s) => s.settingKey === shtatKey));
      if (!ok) throw new NotFoundException("Shtat bo'limi topilmadi");
    }
    await runExclusive(`setting:${SECTIONS_KEY}`, async () => {
      const cur = await this.read<Record<string, string | null>>(SECTIONS_KEY, {});
      if (shtatKey === undefined) delete cur[key];
      else cur[key] = shtatKey;
      await this.write(SECTIONS_KEY, cur);
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'nazorat_3802', entityId: 'sections', summary: `3802 nazorat: vedomost bo'limi «${String(body.section).slice(0, 80)}» → ${shtatKey ?? (shtatKey === null ? 'shtatda yo‘q' : 'taklif')}` });
    return { saved: true };
  }

  /** Izoh (tushuntirilgan farq): bo'sh matn — izohni o'chirish */
  async setNote(body: { period?: unknown; link?: unknown; item?: unknown; note?: unknown }, userId: string) {
    const period = typeof body?.period === 'string' && PERIOD_RE.test(body.period) ? body.period : null;
    const link = typeof body?.link === 'string' && (LINK_CODES as string[]).includes(body.link) ? body.link : null;
    const item = typeof body?.item === 'string' ? body.item.slice(0, 200) : '';
    if (!period || !link || !item) throw new BadRequestException("Oy, halqa va element kerak");
    const text = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const by = (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
    await runExclusive(`setting:${NOTES_KEY}`, async () => {
      const cur = await this.read<Record<string, NoteEntry>>(NOTES_KEY, {});
      const k = `${period}|${link}|${item}`;
      if (text) cur[k] = { note: text, by, at: new Date().toISOString() };
      else delete cur[k];
      await this.write(NOTES_KEY, cur);
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'nazorat_3802', entityId: `${period}|${link}`, summary: `3802 nazorat (${period}, ${link}): izoh ${text ? 'yozildi' : "o'chirildi"}` });
    return { saved: true };
  }

  /** Farq chegarasi (so'm) */
  async setConfig(body: { toleranceSom?: unknown }, userId: string) {
    const raw = String(body?.toleranceSom ?? '').replace(/\s+/g, '');
    if (!/^\d{1,9}$/.test(raw)) throw new BadRequestException("Chegara — butun so'm (0 … 999 999 999)");
    const toleranceTiyin = (BigInt(raw) * 100n).toString();
    await this.write(CONFIG_KEY, { toleranceTiyin });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'nazorat_3802', entityId: 'config', summary: `3802 nazorat: farq chegarasi ${raw} so'm` });
    return { toleranceTiyin };
  }

  // ─────────── Excel ───────────

  async export(period: string): Promise<{ buffer: Buffer; filename: string }> {
    const m = await this.detail(period);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const s = (t: string | null) => (t === null ? '' : Number(t) / 100);
    const head = (ws: ExcelJS.Worksheet, cols: { h: string; w: number }[]) => {
      ws.columns = cols.map((c) => ({ header: c.h, width: c.w }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const z = wb.addWorksheet('Zanjir');
    head(z, [{ h: 'Halqa', w: 40 }, { h: 'Holat', w: 12 }, { h: 'Natija', w: 110 }]);
    const ST: Record<string, string> = { OK: 'mos', WARN: 'farq bor', NONE: "ma'lumot yo'q", LATER: 'keyin' };
    for (const l of m.links) z.addRow([l.title, ST[l.status], l.summary]);
    const t = wb.addWorksheet('Vedomost-tarkib');
    head(t, [{ h: "Bo'lim", w: 34 }, { h: 'F.I.Sh. (vedomost)', w: 34 }, { h: 'Lavozim', w: 28 }, { h: 'Holat', w: 14 }, { h: 'Vedomost: Oklad', w: 16 }, { h: 'Tarkib: Oklad', w: 16 }, { h: 'Vedomost: 40%', w: 16 }, { h: 'Tarkib: 40%', w: 16 }, { h: 'Izoh', w: 40 }]);
    const TS: Record<string, string> = { OK: 'mos', DIFF: 'farq', NOT_FOUND: 'topilmadi', CONFIRMED_NONE: "tarkibda yo'q (tasdiqlangan)" };
    for (const x of m.tarkib.items) t.addRow([x.section, x.fullName, x.position, TS[x.status], s(x.vedOklad), s(x.tarkibOklad), s(x.vedUstama), s(x.tarkibUstama), x.note ?? '']);
    for (const x of m.tarkib.tarkibOnly) t.addRow(['(tarkibda 40% bor, vedomostda yo‘q)', x.fullName, '', 'vedomostda yo‘q', '', s(x.okladTiyin), '', s(x.ustamaTiyin), x.note ?? '']);
    const d3 = wb.addWorksheet('Vedomost-23106');
    head(d3, [{ h: "Bo'lim", w: 34 }, { h: 'F.I.Sh.', w: 34 }, { h: "Vedomost: ta'til", w: 16 }, { h: 'Vedomost: moddiy yordam', w: 18 }, { h: "23106: to'langan", w: 16 }, { h: 'Nisbat, %', w: 10 }, { h: 'Holat', w: 16 }, { h: "To'lovlar", w: 40 }, { h: 'Izoh', w: 40 }]);
    const DS: Record<string, string> = { PAID: "to'langan", DIFF: 'summa farqi', WITH_SALARY: 'ish haqi bilan birga', NOT_PAID: 'topilmadi', REGIONAL: 'hudud' };
    for (const x of m.d23106.items) d3.addRow([x.section, x.fullName, s(x.vedTatilTiyin), s(x.vedModdiyTiyin), s(x.paidTiyin), x.ratio ?? '', DS[x.status], x.paid.map((p) => `${p.docDate.split('-').reverse().join('.')}: ${(Number(p.amountTiyin) / 100).toLocaleString('ru-RU')}`).join('; '), x.note ?? '']);
    const sh = wb.addWorksheet('Vedomost-shtat');
    head(sh, [{ h: 'Shtat lavozimi', w: 50 }, { h: 'Shtat birligi', w: 14 }, { h: 'Xodimlar', w: 10 }, { h: 'Shtat maoshi', w: 16 }, { h: 'Eng katta Oklad', w: 16 }, { h: 'Holat', w: 18 }, { h: 'Izoh', w: 40 }]);
    const PS: Record<string, string> = { OK: 'mos', OVER_UNITS: 'birlikdan ortiq', OVER_SALARY: 'maoshdan ortiq', BOTH: 'birlik va maosh' };
    for (const p of m.shtat.positions) sh.addRow([p.position, p.units, p.heads, s(p.salaryTiyin), s(p.maxOkladTiyin), PS[p.status], p.note ?? '']);
    for (const p of m.shtat.noPosition) sh.addRow([`${p.position} (shtatda yo‘q) — ${p.fullName}`, '', 1, '', '', 'lavozim yo‘q', p.note ?? '']);
    const q = wb.addWorksheet('Qoplash');
    head(q, [{ h: "Bo'lim", w: 40 }, { h: 'Qoplanishi kerak', w: 18 }, { h: "Qo'mitadan kelgan", w: 18 }, { h: 'Farq (oy)', w: 16 }, { h: 'Yil boshidan qoldiq', w: 18 }]);
    for (const x of m.qoplash.items) q.addRow([x.label, s(x.neededTiyin), s(x.incomeTiyin), s(x.diffTiyin), s(x.ytdBalanceTiyin)]);
    for (const ws of [t, d3, sh, q]) ws.eachRow((row, i) => i > 1 && row.eachCell((c) => typeof c.value === 'number' && (c.numFmt = '#,##0')));
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `3802-nazorat-${period}.xlsx` };
  }
}
