import { Injectable, Logger } from '@nestjs/common';
import { CenterService } from '../structure/center.service';
import type { CenterDetailResult, DepartmentDetailResult } from '../structure/center.types';
import { ChangesService, type ChangesResult } from '../structure/changes.service';
import { DistrictsService } from '../structure/districts.service';
import type { DistrictDetailResult, RegionDistrictsResult } from '../structure/districts.types';
import { RegionsService, type SohaCell, type SohaSink } from '../structure/regions.service';
import type { RegionUnit, RegionsResult } from '../structure/regions.types';
import { UnassignedService, type UnassignedResult } from '../structure/unassigned.service';
import { fmtPct, fmtSom, periodLabel, periodShort, safeFile, uzDate } from './reports.format';
import type { Cell, Column, ReportDoc, ReportParams, ReportSection, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma — to'liq hisobot (Excel).
// Solishtirma sahifasidagi BARCHA ma'lumot bitta faylda: hududlar → tumanlar → xizmatlar, xarajat moddalari, xodimlar;
// Markaz → bo'limlar → moddalar, xodimlar; hududga biriktirilmagan yozuvlar; sohalar (xizmat turlari va xarajat moddalari)
// kesimi; oylar; xodimlar harakati; tekshiruv. Raqamlar Solishtirma sahifasi bilan AYNAN bir xil xizmatlardan olinadi
// (RegionsService, DistrictsService, CenterService, UnassignedService, ChangesService) — alohida hisob yo'q.
// Ichma-ich jadvallar Excel'da guruhlangan: chapdagi [+] — ichkariga kirish, yuqoridagi 1 2 3 4 5 — barcha darajalar.
// ═══════════════════════════════════════════════════════════

type Tiyin = string | bigint | null | undefined;

/** Tiyin → so'm (jadvalda son) */
const som = (t: Tiyin): number | null => (t === null || t === undefined ? null : Number(BigInt(t)) / 100);
const big = (t: Tiyin): bigint => (t === null || t === undefined ? 0n : BigInt(t));

/** O'zgarish %: baza musbat bo'lsagina (nol yoki manfiy bazadan foiz chalg'itadi) */
function changePct(cur: Tiyin, base: Tiyin): number | null {
  if (cur === null || cur === undefined || base === null || base === undefined) return null;
  const b = BigInt(base);
  if (b <= 0n) return null;
  return Math.round((Number(BigInt(cur) - b) / Number(b)) * 100000) / 1000;
}

/** Rentabellik: natija ÷ daromad (daromad musbat bo'lsagina) */
function marginPct(income: Tiyin, expense: Tiyin): number | null {
  const i = big(income);
  if (i <= 0n || expense === null || expense === undefined) return null;
  return Math.round((Number(i - BigInt(expense)) / Number(i)) * 100000) / 1000;
}

const ratio = (a: Tiyin, b: Tiyin): number | null => (b === null || b === undefined || big(b) === 0n || a === null || a === undefined ? null : Math.round((Number(BigInt(a)) / Number(BigInt(b))) * 100000) / 1000);

const EMPLOYMENT: Record<string, string> = { SHTAT: 'Shtat', SHARTNOMA: 'Shartnoma' };
const SECTION_LABEL: Record<string, string> = { ALL: 'Barcha yozuvlar', DOIMIY: 'Doimiy (ish haqi, ijara va h.k.)', BOSHQA: 'Bir martalik' };
const CHANGE_LABEL: Record<string, string> = {
  hired: 'Ishga olindi',
  returned: 'Qaytdi',
  fired: "Bo'shatildi",
  idle: 'Ishlamadi',
  moved: "Ko'chdi",
  up: 'Oyligi oshdi (±20%+)',
  down: 'Oyligi kamaydi (±20%+)',
  hiredUnpaid: 'Ishga olingan, oylik yo‘q',
};

// ─────────── Ichma-ich jadval quruvchi ───────────

/** «Hududlar» daraxti ustunlari */
const TREE_COLUMNS: Column[] = [
  { label: 'Nomi', width: 3.4 },
  { label: 'Daraja', width: 1 },
  { label: 'Daromad', format: 'money' },
  { label: 'Xarajat', format: 'money' },
  { label: 'shundan ish haqi', format: 'money' },
  { label: 'Natija (daromad − xarajat)', format: 'money', toneBy: 'up' },
  { label: 'Rentabellik', format: 'pct' },
  { label: "O'tgan davr: daromad", format: 'money' },
  { label: "O'tgan davr: xarajat", format: 'money' },
  { label: "O'tgan davr: natija", format: 'money' },
  { label: "Natija o'zgarishi", format: 'money', toneBy: 'up' },
  { label: "Daromad o'zgarishi", format: 'signedPct', toneBy: 'up' },
  { label: "Xarajat o'zgarishi", format: 'signedPct', toneBy: 'down' },
  { label: 'Xizmatlar soni', format: 'int' },
  { label: 'Xodimlar', format: 'int' },
  { label: 'Reja (xodimlar)', format: 'money' },
  { label: 'Fakt (xodimlar)', format: 'money' },
  { label: 'Bir xodimga natija', format: 'money' },
];

interface TreeValues {
  income?: Tiyin;
  expense?: Tiyin;
  payroll?: Tiyin;
  previousIncome?: Tiyin;
  previousExpense?: Tiyin;
  quantity?: number | null;
  headcount?: number | null;
  plan?: Tiyin;
  fact?: Tiyin;
}

class Tree {
  rows: Cell[][] = [];
  levels: number[] = [];

  add(level: number, name: string, kind: string, v: TreeValues): void {
    const hasIn = v.income !== undefined && v.income !== null;
    const hasEx = v.expense !== undefined && v.expense !== null;
    const both = hasIn && hasEx;
    const result = both ? big(v.income) - big(v.expense) : null;
    const prevBoth = v.previousIncome !== undefined && v.previousIncome !== null && v.previousExpense !== undefined && v.previousExpense !== null;
    const prevResult = prevBoth ? big(v.previousIncome) - big(v.previousExpense) : null;
    const heads = v.headcount ?? null;
    this.rows.push([
      name,
      kind,
      hasIn ? som(v.income) : null,
      hasEx ? som(v.expense) : null,
      v.payroll === undefined ? null : som(v.payroll),
      result === null ? null : som(result),
      both ? marginPct(v.income, v.expense) : null,
      v.previousIncome === undefined ? null : som(v.previousIncome),
      v.previousExpense === undefined ? null : som(v.previousExpense),
      prevResult === null ? null : som(prevResult),
      result !== null && prevResult !== null ? som(result - prevResult) : null,
      hasIn ? changePct(v.income, v.previousIncome) : null,
      hasEx ? changePct(v.expense, v.previousExpense) : null,
      v.quantity ?? null,
      heads,
      v.plan === undefined ? null : som(v.plan),
      v.fact === undefined ? null : som(v.fact),
      result !== null && heads && heads > 0 ? Math.round(Number(result) / heads) / 100 : null,
    ]);
    this.levels.push(level);
  }

  block(title: string, total: Cell[] | undefined, note: string, openLevels = 1): TableBlock {
    return { type: 'table', title, columns: TREE_COLUMNS, rows: this.rows, levels: this.levels, openLevels, total, note, freeze: true };
  }
}

/** Natija manbai holati (Tekshiruv varag'i uchun) */
interface SourceLog {
  name: string;
  ok: boolean;
  note: string;
}

/** Xarajat moddasining eng yuqori guruhi (ota moddalar zanjiri bo'yicha) */
function rootOf(code: string, parent: Map<string, string | null>): string {
  let cur = code;
  for (let i = 0; i < 12; i += 1) {
    const p = parent.get(cur);
    if (!p) return cur;
    cur = p;
  }
  return cur;
}

const sumCells = (m: Map<string, SohaCell> | undefined) => {
  let amount = 0n;
  let previous = 0n;
  let count = 0;
  for (const c of m?.values() ?? []) {
    amount += c.amount;
    previous += c.previous;
    count += c.count;
  }
  return { amount, previous, count };
};

const byAmount = <T>(f: (x: T) => bigint) => (a: T, b: T) => {
  const x = f(a);
  const y = f(b);
  return y > x ? 1 : y < x ? -1 : 0;
};

@Injectable()
export class SolishtirmaReport {
  private readonly log = new Logger('SolishtirmaHisobot');

  constructor(
    private readonly regions: RegionsService,
    private readonly districts: DistrictsService,
    private readonly center: CenterService,
    private readonly changes: ChangesService,
    private readonly unassigned: UnassignedService,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const compare = params.options?.compare === 'yoy' ? 'yoy' : 'prev';
    const section = params.options?.section === 'DOIMIY' || params.options?.section === 'BOSHQA' ? params.options.section : 'ALL';
    const query = { from: params.from || undefined, to: params.to || undefined, section, compare };
    const sources: SourceLog[] = [];

    // ── 1. Solishtirma (hududlar, Markaz, biriktirilmagan) + sohalar kesimi — asosiy manba, xato bo'lsa hisobot yo'q ──
    const { result: R, soha } = await this.regions.full(query);
    sources.push({ name: 'Solishtirma: hududlar va Markaz', ok: true, note: `${R.units.length} ta birlik` });
    const q = { from: R.range.from, to: R.range.to, section, compare };

    // ── 2. Har bir viloyat: tumanlar va ularning tafsiloti (ketma-ket — bazaga yuk tushmasin) ──
    const regionUnits = R.units.filter((u) => u.kind === 'region' && u.code !== null);
    const drills = new Map<string, RegionDistrictsResult & { details: DistrictDetailResult[] }>();
    const drillErrors: string[] = [];
    for (const u of regionUnits) {
      try {
        drills.set(u.key, await this.districts.regionFull(u.code!, q));
      } catch (e) {
        drillErrors.push(u.name);
        this.log.warn(`Tumanlar o'qilmadi (${u.name}): ${(e as Error).message}`);
      }
    }
    sources.push({ name: 'Tumanlar, xizmatlar, xodimlar', ok: drillErrors.length === 0, note: drillErrors.length ? `O'qilmadi: ${drillErrors.join(', ')}` : `${drills.size} ta viloyat` });

    // ── 3. Markaz, biriktirilmagan, xodimlar oylari, xodimlar harakati ──
    const center = await this.attempt(sources, 'Markaz: bo\'limlar va xodimlar', () => this.center.full(q), (c) => `${c.departments.length} ta bo'lim`);
    const none = await this.attempt(sources, 'Hududga biriktirilmagan yozuvlar', () => this.unassigned.list(q), (u) => `daromad ${u.income.count} ta, xarajat ${u.expense.count} ta yozuv${u.income.truncated || u.expense.truncated ? " (ro'yxat qisqartirilgan)" : ''}`);
    const empMonths = await this.attempt(sources, 'Xodimlar oylari', () => this.districts.employeesMonths(q), (x) => `${x.rows.length} ta qator`);
    const moves = await this.attempt(sources, 'Xodimlar harakati', () => this.movesOf(R), (x) => (x.length ? `${x.length} ta oy` : "ish haqi yuklangan oy yo'q"));

    // ── Nomlar ──
    const unitName = new Map(R.units.map((u) => [u.key, u.name]));
    unitName.set('center', unitName.get('center') ?? 'Markaz');
    unitName.set('none', unitName.get('none') ?? 'Hududga biriktirilmagan');
    const unitOrder = [...R.units.map((u) => u.key)];
    for (const k of ['center', 'none']) if (!unitOrder.includes(k)) unitOrder.push(k);
    const catLabel = new Map(soha.categories.map((c) => [c.code, c.label]));
    const catParent = new Map(soha.categories.map((c) => [c.code, c.parentCode]));
    const svcLabel = soha.incomeLabels;

    const sum = (f: (u: RegionUnit) => string) => R.units.reduce((s, u) => s + BigInt(f(u)), 0n);
    const total = {
      income: sum((u) => u.incomeTiyin),
      expense: sum((u) => u.expenseTiyin),
      payroll: sum((u) => u.payrollTiyin),
      previousIncome: sum((u) => u.previousIncomeTiyin),
      previousExpense: sum((u) => u.previousExpenseTiyin),
      headcount: R.units.reduce((s, u) => s + u.headcount, 0),
    };
    const regionsOnly = R.units.filter((u) => u.kind === 'region');
    const regionsResult = regionsOnly.reduce((s, u) => s + BigInt(u.incomeTiyin) - BigInt(u.expenseTiyin), 0n);
    const centerUnit = R.units.find((u) => u.kind === 'center');
    const centerNet = centerUnit ? BigInt(centerUnit.expenseTiyin) - BigInt(centerUnit.incomeTiyin) : 0n;
    const coverage = centerNet > 0n ? ratio(regionsResult, centerNet) : null;

    const sections: ReportSection[] = [];

    // ═══ 1. Hududlar — ichma-ich ═══
    sections.push({
      title: 'Hududlar → tumanlar → xizmatlar, moddalar, xodimlar',
      sheet: 'Hududlar',
      intro: "Har bir hudud ichida: daromad (xizmat turlari), xarajat (moddalar), tumanlar → har tuman xizmatlari, xarajati va xodimlari. Markaz ichida: daromad manbalari, bo'limlar → moddalar va xodimlar, hududlar uchun to'langan. Chapdagi [+] — ichkariga kirish; yuqoridagi 1–5 raqamlari — barcha darajalarni ochish.",
      blocks: [this.unitsTree(R, soha, drills, center, none, catLabel, catParent, svcLabel, total)],
    });

    // ═══ 2. Sohalar — ichma-ich ═══
    sections.push({
      title: 'Sohalar kesimi: nima daromad, nima xarajat',
      sheet: 'Sohalar',
      intro: "Daromad — xizmat turlari (sohalar) → hududlar → tumanlar; xarajat — modda guruhlari → moddalar → hududlar. Xarajatlar siyosatidagi «Markaz hisobidan» moddalar (qayerda yozilgan bo'lsa ham) Markazda — Solishtirmadagidek.",
      blocks: [this.sohaTree(soha, drills, unitName, unitOrder, catLabel, catParent, svcLabel)],
    });

    // ═══ 3–4. Sohalar matritsasi ═══
    sections.push({ title: 'Daromad: xizmat turlari × hududlar', sheet: 'Daromad_matritsa', blocks: [this.incomeMatrix(soha, unitName, unitOrder, svcLabel)] });
    sections.push({ title: 'Xarajat: moddalar × hududlar', sheet: 'Xarajat_matritsa', blocks: [this.expenseMatrix(soha, unitName, unitOrder, catLabel, catParent)] });

    // ═══ 5. Hududlar jadvali (tekis) ═══
    sections.push({ title: 'Hududlar va Markaz — asosiy ko\'rsatkichlar', sheet: 'Hududlar_jadval', blocks: [this.unitsFlat(R)] });

    // ═══ 6–10. Tekis ro'yxatlar (filtr bilan) ═══
    const details = [...drills.entries()].flatMap(([key, d]) => d.details.map((x) => ({ key, region: unitName.get(key) ?? d.region.name, d: x })));
    sections.push({ title: 'Tumanlar', sheet: 'Tumanlar', blocks: [this.districtsFlat(drills, unitName)] });
    sections.push({ title: 'Xizmatlar (tumanlar bo\'yicha)', sheet: 'Xizmatlar', blocks: [this.servicesFlat(details)] });
    sections.push({ title: 'Xarajat tarkibi (tumanlar va Markaz bo\'limlari)', sheet: 'Xarajat_tarkibi', blocks: [this.partsFlat(details, center)] });
    sections.push({ title: 'Xodimlar (davr bo\'yicha)', sheet: 'Xodimlar', blocks: [this.employeesFlat(details, center)] });
    if (empMonths) sections.push({ title: 'Xodimlar — oylar bo\'yicha', sheet: 'Xodimlar_oylar', blocks: [this.employeeMonthsFlat(empMonths.rows)] });

    // ═══ 11. Oylar dinamikasi ═══
    sections.push({ title: 'Oylar dinamikasi (24 oy)', sheet: 'Oylar', intro: "Har bir birlik: natija; ichida — daromad va xarajat. Oylar yozuv sanasi bo'yicha.", blocks: [this.monthsTree(R)] });

    // ═══ 12. Markaz ═══
    if (center) sections.push({ title: 'Markaz', sheet: 'Markaz', blocks: this.centerBlocks(center, R) });

    // ═══ 13. Biriktirilmagan ═══
    if (none) sections.push({ title: 'Hududga biriktirilmagan yozuvlar', sheet: 'Biriktirilmagan', blocks: this.unassignedBlocks(none) });

    // ═══ 14. Xodimlar harakati ═══
    if (moves && moves.length) sections.push({ title: 'Xodimlar harakati (oylar bo\'yicha)', sheet: 'Xodimlar_harakati', blocks: this.movesBlocks(moves) });

    // ═══ 15. Tekshiruv ═══
    sections.push({ title: 'Tekshiruv: jamilar mosligi va manbalar', sheet: 'Tekshiruv', blocks: this.checkBlocks(R, soha, drills, center, none, sources) });

    // ═══ 16. Metodika ═══
    sections.push({ title: 'Metodika', sheet: 'Metodika', blocks: [this.methodology(R)] });

    const periodText = `${uzDate(R.range.from)} — ${uzDate(R.range.to)}`;
    const prevText = `${uzDate(R.previousRange.from)} — ${uzDate(R.previousRange.to)}`;
    const result = total.income - total.expense;
    return {
      kind: "Solishtirma — to'liq hisobot",
      title: "Solishtirma — to'liq hisobot",
      subtitle: `Hududlar, tumanlar, Markaz, sohalar va xodimlar · ${periodText}`,
      meta: [
        `Davr: ${periodText}; solishtirish (${R.compareLabel}): ${prevText}`,
        `Yozuvlar: ${SECTION_LABEL[section]}`,
        "Manba: Solishtirma bo'limi (Daromadlar, Xarajatlar, Xodimlar, ish haqi vedomosti, Natijalar fayli, Xarajatlar siyosati)",
        "Ichma-ich varaqlar: chapdagi [+] — ichkariga kirish, yuqoridagi 1–5 — barcha darajalar",
      ],
      highlights: R.notes.slice(0, 6),
      sections: [
        {
          title: 'Asosiy ko\'rsatkichlar',
          sheet: 'Ko\'rsatkichlar',
          blocks: [
            {
              type: 'kpis',
              title: 'Korxona jami',
              items: [
                { label: 'Daromad', value: fmtSom(Number(total.income) / 100), sub: changeText(total.income, total.previousIncome, R.compareLabel) },
                { label: 'Xarajat', value: fmtSom(Number(total.expense) / 100), sub: changeText(total.expense, total.previousExpense, R.compareLabel) },
                { label: 'Natija', value: fmtSom(Number(result) / 100), tone: result >= 0n ? 'good' : 'bad', sub: `rentabellik ${fmtPct(marginPct(total.income, total.expense))}` },
                { label: 'Xodimlar', value: String(total.headcount), sub: 'davr ichida ishlagan' },
              ],
            },
            {
              type: 'kpis',
              title: 'Hududlar va Markaz',
              items: [
                { label: 'Hududlar natijasi', value: fmtSom(Number(regionsResult) / 100), tone: regionsResult >= 0n ? 'good' : 'bad', sub: `${regionsOnly.length} ta hudud` },
                { label: 'Markaz sof xarajati', value: fmtSom(Number(centerNet) / 100), sub: "xarajat − o'z daromadi" },
                { label: 'Markazni qoplash', value: fmtPct(coverage), sub: 'hududlar natijasi ÷ Markaz sof xarajati' },
                { label: 'Biriktirilmagan', value: fmtSom(Number(big(R.units.find((u) => u.kind === 'unassigned')?.expenseTiyin)) / 100), sub: 'hududsiz xarajat' },
              ],
            },
            { type: 'notes', title: 'Xulosalar (Solishtirma)', items: R.notes },
          ],
        },
        ...sections,
      ],
      fileBase: safeFile(`Solishtirma toliq hisobot - ${R.range.from}_${R.range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      coverSheet: 'Xulosa',
      ownMethodology: true,
    };
  }

  /** Manbani o'qish: xato bo'lsa — hisobot to'xtamaydi, Tekshiruv varag'ida «Xato» */
  private async attempt<T>(log: SourceLog[], name: string, run: () => Promise<T>, note: (v: T) => string): Promise<T | null> {
    try {
      const v = await run();
      log.push({ name, ok: true, note: note(v) });
      return v;
    } catch (e) {
      this.log.warn(`${name}: ${(e as Error).message}`);
      log.push({ name, ok: false, note: `Xato: ${(e as Error).message}`.slice(0, 200) });
      return null;
    }
  }

  /** Davrdagi har oy uchun xodimlar harakati (faqat ish haqi yuklangan oylar) */
  private async movesOf(R: RegionsResult): Promise<ChangesResult[]> {
    const first = await this.changes.month({ to: R.range.to });
    const months = new Set(monthsBetween(R.range.from, R.range.to));
    const periods = first.periods.filter((p) => months.has(p)).sort();
    const out: ChangesResult[] = [];
    for (const p of periods) out.push(p === first.period ? first : await this.changes.month({ month: p }));
    return out;
  }

  // ─────────── 1. Hududlar daraxti ───────────

  private unitsTree(
    R: RegionsResult,
    soha: SohaSink,
    drills: Map<string, RegionDistrictsResult & { details: DistrictDetailResult[] }>,
    center: (CenterDetailResult & { details: DepartmentDetailResult[] }) | null,
    none: UnassignedResult | null,
    catLabel: Map<string, string>,
    catParent: Map<string, string | null>,
    svcLabel: Map<string, string>,
    total: { income: bigint; expense: bigint; payroll: bigint; previousIncome: bigint; previousExpense: bigint; headcount: number },
  ): TableBlock {
    const t = new Tree();
    for (const u of R.units) {
      const base: TreeValues = {
        income: u.incomeTiyin,
        expense: u.expenseTiyin,
        payroll: u.payrollTiyin,
        previousIncome: u.previousIncomeTiyin,
        previousExpense: u.previousExpenseTiyin,
        headcount: u.headcount,
      };
      if (u.kind === 'region') {
        const drill = drills.get(u.key);
        const plan = drill?.districts.reduce((s, d) => s + BigInt(d.planTiyin), 0n);
        const fact = drill?.districts.reduce((s, d) => s + BigInt(d.factTiyin), 0n);
        t.add(0, u.name, 'Hudud', { ...base, quantity: drill?.totals.quantity ?? null, plan: drill ? plan : undefined, fact: drill ? fact : undefined });
        this.incomeGroup(t, 1, soha.income, u.key, svcLabel);
        this.expenseGroup(t, 1, soha.expense, u.key, catLabel, catParent, soha.policyCodes);
        if (drill) {
          t.add(1, 'Tumanlar', 'Guruh', { income: drill.totals.incomeTiyin, expense: drill.totals.expenseTiyin, previousIncome: drill.totals.previousIncomeTiyin, previousExpense: drill.totals.previousExpenseTiyin, quantity: drill.totals.quantity });
          for (const d of drill.details) this.districtNode(t, 2, d);
        } else {
          t.add(1, "Tumanlar — ma'lumot o'qilmadi (Tekshiruv varag'iga qarang)", 'Xato', {});
        }
      } else if (u.kind === 'center') {
        t.add(0, u.name, 'Markaz', base);
        if (center) this.centerNode(t, 1, center);
        else t.add(1, "Markaz tafsiloti o'qilmadi (Tekshiruv varag'iga qarang)", 'Xato', {});
      } else {
        t.add(0, u.name, 'Biriktirilmagan', base);
        if (none) {
          if (none.income.byCategory.length) {
            t.add(1, 'Daromad turlari', 'Guruh', { income: none.income.totalTiyin });
            for (const g of none.income.byCategory) t.add(2, g.label, 'Xizmat', { income: g.totalTiyin, quantity: null });
          }
          if (none.expense.byCategory.length) {
            t.add(1, 'Xarajat moddalari', 'Guruh', { expense: none.expense.totalTiyin });
            for (const g of none.expense.byCategory) t.add(2, g.label, 'Modda', { expense: g.totalTiyin });
          }
          if (none.expense.bySource.length) {
            t.add(1, "Xarajat — qayerdan kiritilgan", 'Guruh', { expense: none.expense.totalTiyin });
            for (const g of none.expense.bySource) t.add(2, g.label, 'Manba', { expense: g.totalTiyin });
          }
        }
      }
    }
    const totalRow: Cell[] = [
      'JAMI (korxona)',
      '',
      som(total.income),
      som(total.expense),
      som(total.payroll),
      som(total.income - total.expense),
      marginPct(total.income, total.expense),
      som(total.previousIncome),
      som(total.previousExpense),
      som(total.previousIncome - total.previousExpense),
      som(total.income - total.expense - (total.previousIncome - total.previousExpense)),
      changePct(total.income, total.previousIncome),
      changePct(total.expense, total.previousExpense),
      null,
      total.headcount,
      null,
      null,
      total.headcount > 0 ? Math.round(Number(total.income - total.expense) / total.headcount) / 100 : null,
    ];
    return t.block(
      'Hududlar, Markaz va biriktirilmagan — ichma-ich',
      totalRow,
      "Jami — faqat eng yuqori qatorlar (hudud, Markaz, biriktirilmagan) yig'indisi; ichki qatorlar — shu qatorning tarkibi. Xodimlar qatorida «shundan ish haqi» — xodimga hisoblangan ish haqi (tuman xarajati ichida).",
    );
  }

  /** Daromad guruhi: xizmat turlari (sohalar) — barchasi */
  private incomeGroup(t: Tree, level: number, map: Map<string, Map<string, SohaCell>>, unitKey: string, svcLabel: Map<string, string>): void {
    const list = [...map.entries()].map(([code, byUnit]) => ({ code, c: byUnit.get(unitKey) })).filter((x): x is { code: string; c: SohaCell } => Boolean(x.c && (x.c.amount !== 0n || x.c.previous !== 0n)));
    if (!list.length) return;
    list.sort(byAmount((x) => x.c.amount));
    const s = list.reduce((a, x) => ({ amount: a.amount + x.c.amount, previous: a.previous + x.c.previous }), { amount: 0n, previous: 0n });
    t.add(level, 'Daromad — xizmat turlari', 'Guruh', { income: s.amount, previousIncome: s.previous });
    for (const x of list) t.add(level + 1, svcLabel.get(x.code) ?? x.code, 'Xizmat', { income: x.c.amount, previousIncome: x.c.previous });
  }

  /** Xarajat guruhi: modda guruhlari → moddalar (barchasi) */
  private expenseGroup(t: Tree, level: number, map: Map<string, Map<string, SohaCell>>, unitKey: string, catLabel: Map<string, string>, catParent: Map<string, string | null>, policy: Set<string>): void {
    const roots = new Map<string, { amount: bigint; previous: bigint; items: { code: string; c: SohaCell }[] }>();
    for (const [code, byUnit] of map) {
      const c = byUnit.get(unitKey);
      if (!c || (c.amount === 0n && c.previous === 0n)) continue;
      const root = rootOf(code, catParent);
      const g = roots.get(root) ?? { amount: 0n, previous: 0n, items: [] };
      g.amount += c.amount;
      g.previous += c.previous;
      g.items.push({ code, c });
      roots.set(root, g);
    }
    if (!roots.size) return;
    const all = [...roots.values()].reduce((a, g) => ({ amount: a.amount + g.amount, previous: a.previous + g.previous }), { amount: 0n, previous: 0n });
    t.add(level, 'Xarajat — moddalar', 'Guruh', { expense: all.amount, previousExpense: all.previous });
    for (const [root, g] of [...roots.entries()].sort(byAmount(([, g]) => g.amount))) {
      const single = g.items.length === 1 && g.items[0]!.code === root;
      const mark = (code: string) => (policy.has(code) ? ' (Markaz hisobidan)' : '');
      t.add(level + 1, `${catLabel.get(root) ?? root}${single ? mark(root) : ''}`, 'Modda guruhi', { expense: g.amount, previousExpense: g.previous });
      if (single) continue;
      for (const x of g.items.sort(byAmount((x) => x.c.amount))) t.add(level + 2, `${catLabel.get(x.code) ?? x.code}${mark(x.code)}`, 'Modda', { expense: x.c.amount, previousExpense: x.c.previous });
    }
  }

  /** Tuman: xizmatlar, xarajat tarkibi, xodimlar */
  private districtNode(t: Tree, level: number, d: DistrictDetailResult): void {
    const s = d.summary;
    t.add(level, d.district.name, d.district.unassigned ? "Tumanga bo'linmagan" : 'Tuman', {
      income: s.incomeTiyin,
      expense: s.expenseTiyin,
      payroll: s.payrollTiyin,
      previousIncome: s.previousIncomeTiyin,
      previousExpense: s.previousExpenseTiyin,
      quantity: s.quantity,
      headcount: s.headcount,
      plan: s.planTiyin,
      fact: s.factTiyin,
    });
    if (d.services.length) {
      const amount = d.services.reduce((a, x) => a + BigInt(x.amountTiyin), 0n);
      const previous = d.services.reduce((a, x) => a + BigInt(x.previousTiyin), 0n);
      t.add(level + 1, BigInt(s.allocatedIncomeTiyin) !== 0n ? `Xizmatlar (shundan taqsimlangan ${fmtSom(Number(s.allocatedIncomeTiyin) / 100)})` : 'Xizmatlar', 'Guruh', { income: amount, previousIncome: previous, quantity: d.services.reduce((a, x) => a + x.quantity, 0) });
      for (const x of d.services) t.add(level + 2, x.label, 'Xizmat', { income: x.amountTiyin, previousIncome: x.previousTiyin, quantity: x.quantity });
    }
    if (d.expenseParts.length) {
      const amount = d.expenseParts.reduce((a, x) => a + BigInt(x.amountTiyin), 0n);
      const previous = d.expenseParts.reduce((a, x) => a + BigInt(x.previousTiyin), 0n);
      t.add(level + 1, 'Xarajat tarkibi', 'Guruh', { expense: amount, previousExpense: previous });
      for (const p of d.expenseParts) t.add(level + 2, p.label, 'Modda', { expense: p.amountTiyin, previousExpense: p.previousTiyin });
    }
    if (d.employees.length) {
      t.add(level + 1, 'Xodimlar', 'Guruh', {
        payroll: d.employees.reduce((a, e) => a + BigInt(e.salaryTiyin), 0n),
        headcount: d.employees.filter((e) => e.salaryTiyin !== '0').length,
        plan: d.employees.reduce((a, e) => a + BigInt(e.planTiyin), 0n),
        fact: d.employees.reduce((a, e) => a + BigInt(e.factTiyin), 0n),
      });
      for (const e of d.employees) t.add(level + 2, `${e.fullName}${e.position ? ` — ${e.position}` : ''}`, `Xodim (${EMPLOYMENT[e.employmentType] ?? e.employmentType})`, { payroll: e.salaryTiyin, plan: e.planTiyin, fact: e.factTiyin });
    }
  }

  /** Markaz: daromad manbalari, o'z xarajati (bo'limlar), hududlar uchun to'langan, asosiy vositalar */
  private centerNode(t: Tree, level: number, c: CenterDetailResult & { details: DepartmentDetailResult[] }): void {
    const tt = c.totals;
    if (c.incomeParts.length) {
      t.add(level, 'Daromad manbalari', 'Guruh', { income: tt.incomeTiyin, previousIncome: tt.previousIncomeTiyin });
      for (const p of c.incomeParts) t.add(level + 1, p.label, 'Daromad turi', { income: p.amountTiyin, previousIncome: p.previousTiyin });
    }
    t.add(level, "O'z xarajati (bo'limlar)", 'Guruh', { expense: tt.ownExpenseTiyin, previousExpense: tt.previousOwnExpenseTiyin, payroll: tt.payrollTiyin, headcount: tt.headcount });
    const byId = new Map(c.details.map((d) => [d.department.id, d]));
    for (const row of c.departments) {
      const d = byId.get(row.id);
      t.add(level + 1, row.name, row.unassigned ? "Bo'limga biriktirilmagan" : "Bo'lim", { income: row.incomeTiyin, expense: row.expenseTiyin, payroll: row.payrollTiyin, previousIncome: row.previousIncomeTiyin, previousExpense: row.previousExpenseTiyin, headcount: row.headcount });
      if (!d) continue;
      if (d.expenseParts.length) {
        t.add(level + 2, 'Xarajat moddalari', 'Guruh', { expense: row.expenseTiyin, previousExpense: row.previousExpenseTiyin });
        for (const p of d.expenseParts) t.add(level + 3, p.label, 'Modda', { expense: p.amountTiyin, previousExpense: p.previousTiyin });
      }
      if (d.incomeParts.length) {
        t.add(level + 2, 'Daromad', 'Guruh', { income: row.incomeTiyin, previousIncome: row.previousIncomeTiyin });
        for (const p of d.incomeParts) t.add(level + 3, p.label, 'Daromad turi', { income: p.amountTiyin, previousIncome: p.previousTiyin });
      }
      if (d.employees.length) {
        t.add(level + 2, 'Xodimlar', 'Guruh', { payroll: d.employees.reduce((a, e) => a + BigInt(e.salaryTiyin), 0n), headcount: d.employees.filter((e) => e.salaryTiyin !== '0').length });
        for (const e of d.employees) t.add(level + 3, `${e.fullName}${e.position ? ` — ${e.position}` : ''}${e.isActive ? '' : ' (ishlamaydi)'}`, `Xodim (${EMPLOYMENT[e.employmentType] ?? e.employmentType})`, { payroll: e.salaryTiyin });
      }
    }
    if (big(tt.regionalExpenseTiyin) !== 0n || big(tt.previousRegionalExpenseTiyin) !== 0n) {
      t.add(level, "Hududlar uchun to'langan (Xarajatlar siyosati)", 'Guruh', { expense: tt.regionalExpenseTiyin, previousExpense: tt.previousRegionalExpenseTiyin });
      for (const p of c.regionalParts) t.add(level + 1, p.label, 'Modda', { expense: p.amountTiyin, previousExpense: p.previousTiyin });
      if (c.regionalBy.length) {
        t.add(level + 1, 'Qaysi hudud uchun', 'Guruh', { expense: tt.regionalExpenseTiyin });
        for (const r of c.regionalBy) t.add(level + 2, r.name, 'Hudud', { expense: r.amountTiyin });
      }
    }
    if (big(tt.assetsExpenseTiyin) !== 0n || big(tt.previousAssetsExpenseTiyin) !== 0n) {
      t.add(level, 'Asosiy vositalar sarfi (eskirish)', 'Guruh', { expense: tt.assetsExpenseTiyin, previousExpense: tt.previousAssetsExpenseTiyin });
    }
  }

  // ─────────── 2. Sohalar daraxti ───────────

  private sohaTree(
    soha: SohaSink,
    drills: Map<string, RegionDistrictsResult & { details: DistrictDetailResult[] }>,
    unitName: Map<string, string>,
    unitOrder: string[],
    catLabel: Map<string, string>,
    catParent: Map<string, string | null>,
    svcLabel: Map<string, string>,
  ): TableBlock {
    const columns: Column[] = [
      { label: 'Nomi', width: 3.4 },
      { label: 'Daraja', width: 1 },
      { label: 'Joriy davr', format: 'money' },
      { label: "O'tgan davr", format: 'money' },
      { label: "O'zgarish (so'm)", format: 'money', toneBy: 'row' },
      { label: "O'zgarish", format: 'signedPct', toneBy: 'row' },
      { label: 'Ulush (jamidan)', format: 'pct' },
      { label: 'Ulush (yuqori qatordan)', format: 'pct' },
      { label: 'Yozuvlar soni', format: 'int' },
      { label: 'Xizmatlar soni', format: 'int' },
    ];
    const rows: Cell[][] = [];
    const levels: number[] = [];
    const tones: ('up' | 'down' | null)[] = [];
    const push = (level: number, name: string, kind: string, amount: bigint, previous: bigint, all: bigint, parent: bigint, count: number | null, qty: number | null, dir: 'up' | 'down') => {
      rows.push([name, kind, som(amount), som(previous), som(amount - previous), changePct(amount, previous), ratio(amount, all), ratio(amount, parent), count, qty]);
      levels.push(level);
      tones.push(dir);
    };
    const order = (k: string) => {
      const i = unitOrder.indexOf(k);
      return i < 0 ? 999 : i;
    };

    // Daromad
    const inc = [...soha.income.entries()].map(([code, m]) => ({ code, m, s: sumCells(m) })).filter((x) => x.s.amount !== 0n || x.s.previous !== 0n);
    const incAll = inc.reduce((a, x) => ({ amount: a.amount + x.s.amount, previous: a.previous + x.s.previous, count: a.count + x.s.count }), { amount: 0n, previous: 0n, count: 0 });
    push(0, 'DAROMAD — jami', 'Bo\'lim', incAll.amount, incAll.previous, incAll.amount, incAll.amount, incAll.count, null, 'up');
    for (const x of inc.sort(byAmount((x) => x.s.amount))) {
      push(1, svcLabel.get(x.code) ?? x.code, 'Xizmat turi', x.s.amount, x.s.previous, incAll.amount, incAll.amount, x.s.count, null, 'up');
      for (const [unit, c] of [...x.m.entries()].filter(([, c]) => c.amount !== 0n || c.previous !== 0n).sort((a, b) => order(a[0]) - order(b[0]))) {
        const districts = drills.get(unit)?.details ?? [];
        const per = districts.map((d) => ({ d, s: d.services.find((s) => s.code === x.code) })).filter((y) => y.s && (y.s.amountTiyin !== '0' || y.s.previousTiyin !== '0'));
        const qty = per.length ? per.reduce((a, y) => a + y.s!.quantity, 0) : null;
        push(2, unitName.get(unit) ?? unit, unit === 'center' ? 'Markaz' : unit === 'none' ? 'Biriktirilmagan' : 'Hudud', c.amount, c.previous, incAll.amount, x.s.amount, c.count, qty, 'up');
        for (const y of per.sort(byAmount((y) => BigInt(y.s!.amountTiyin)))) {
          push(3, y.d.district.name, 'Tuman', BigInt(y.s!.amountTiyin), BigInt(y.s!.previousTiyin), incAll.amount, c.amount, null, y.s!.quantity, 'up');
        }
      }
    }

    // Xarajat
    const roots = new Map<string, { codes: { code: string; m: Map<string, SohaCell>; s: ReturnType<typeof sumCells> }[]; amount: bigint; previous: bigint; count: number }>();
    for (const [code, m] of soha.expense) {
      const s = sumCells(m);
      if (s.amount === 0n && s.previous === 0n) continue;
      const root = rootOf(code, catParent);
      const g = roots.get(root) ?? { codes: [], amount: 0n, previous: 0n, count: 0 };
      g.codes.push({ code, m, s });
      g.amount += s.amount;
      g.previous += s.previous;
      g.count += s.count;
      roots.set(root, g);
    }
    const expAll = [...roots.values()].reduce((a, g) => ({ amount: a.amount + g.amount, previous: a.previous + g.previous, count: a.count + g.count }), { amount: 0n, previous: 0n, count: 0 });
    push(0, 'XARAJAT — jami', 'Bo\'lim', expAll.amount, expAll.previous, expAll.amount, expAll.amount, expAll.count, null, 'down');
    const mark = (code: string) => (soha.policyCodes.has(code) ? ' (Markaz hisobidan)' : '');
    const unitsOf = (level: number, m: Map<string, SohaCell>, parent: bigint) => {
      for (const [unit, c] of [...m.entries()].filter(([, c]) => c.amount !== 0n || c.previous !== 0n).sort((a, b) => order(a[0]) - order(b[0]))) {
        push(level, unitName.get(unit) ?? unit, unit === 'center' ? 'Markaz' : unit === 'none' ? 'Biriktirilmagan' : 'Hudud', c.amount, c.previous, expAll.amount, parent, c.count, null, 'down');
      }
    };
    for (const [root, g] of [...roots.entries()].sort(byAmount(([, g]) => g.amount))) {
      const single = g.codes.length === 1 && g.codes[0]!.code === root;
      push(1, `${catLabel.get(root) ?? root}${single ? mark(root) : ''}`, 'Modda guruhi', g.amount, g.previous, expAll.amount, expAll.amount, g.count, null, 'down');
      if (single) {
        unitsOf(2, g.codes[0]!.m, g.amount);
        continue;
      }
      for (const x of g.codes.sort(byAmount((x) => x.s.amount))) {
        push(2, `${catLabel.get(x.code) ?? x.code}${mark(x.code)}`, 'Modda', x.s.amount, x.s.previous, expAll.amount, g.amount, x.s.count, null, 'down');
        unitsOf(3, x.m, x.s.amount);
      }
    }

    // Natija
    push(0, 'NATIJA (daromad − xarajat)', 'Natija', incAll.amount - expAll.amount, incAll.previous - expAll.previous, incAll.amount - expAll.amount, incAll.amount - expAll.amount, null, null, 'up');
    return {
      type: 'table',
      title: 'Sohalar: daromad va xarajat — ichma-ich',
      columns,
      rows,
      levels,
      rowTone: tones,
      openLevels: 2,
      freeze: true,
      note: "«Ulush (jamidan)» — DAROMAD yoki XARAJAT jamisidan; «Ulush (yuqori qatordan)» — ota qatordan. Tuman qatorlari — Solishtirma › tuman sahifasidagi xizmatlar (tumanga bo'linmagan daromad taqsimlangan bo'lsa — ulushi bilan).",
    };
  }

  // ─────────── 3–4. Matritsalar ───────────

  private incomeMatrix(soha: SohaSink, unitName: Map<string, string>, unitOrder: string[], svcLabel: Map<string, string>): TableBlock {
    const units = unitOrder.filter((k) => [...soha.income.values()].some((m) => (m.get(k)?.amount ?? 0n) !== 0n));
    const list = [...soha.income.entries()].map(([code, m]) => ({ code, m, s: sumCells(m) })).filter((x) => x.s.amount !== 0n).sort(byAmount((x) => x.s.amount));
    return {
      type: 'table',
      title: "Daromad (so'm): qator — xizmat turi, ustun — hudud",
      columns: [{ label: 'Xizmat turi', width: 2.6 }, { label: 'Jami', format: 'money' }, { label: "O'tgan davr", format: 'money' }, { label: "O'zgarish", format: 'signedPct', toneBy: 'up' }, ...units.map((k) => ({ label: unitName.get(k) ?? k, format: 'money' as const }))],
      rows: list.map((x) => [svcLabel.get(x.code) ?? x.code, som(x.s.amount), som(x.s.previous), changePct(x.s.amount, x.s.previous), ...units.map((k) => som(x.m.get(k)?.amount ?? 0n))]),
      total: ['JAMI', som(list.reduce((a, x) => a + x.s.amount, 0n)), som(list.reduce((a, x) => a + x.s.previous, 0n)), changePct(list.reduce((a, x) => a + x.s.amount, 0n), list.reduce((a, x) => a + x.s.previous, 0n)), ...units.map((k) => som(list.reduce((a, x) => a + (x.m.get(k)?.amount ?? 0n), 0n)))],
      freeze: true,
      filter: true,
    };
  }

  private expenseMatrix(soha: SohaSink, unitName: Map<string, string>, unitOrder: string[], catLabel: Map<string, string>, catParent: Map<string, string | null>): TableBlock {
    const units = unitOrder.filter((k) => [...soha.expense.values()].some((m) => (m.get(k)?.amount ?? 0n) !== 0n));
    const list = [...soha.expense.entries()]
      .map(([code, m]) => ({ code, root: rootOf(code, catParent), m, s: sumCells(m) }))
      .filter((x) => x.s.amount !== 0n)
      .sort((a, b) => (catLabel.get(a.root) ?? a.root).localeCompare(catLabel.get(b.root) ?? b.root, 'uz') || (b.s.amount > a.s.amount ? 1 : b.s.amount < a.s.amount ? -1 : 0));
    return {
      type: 'table',
      title: "Xarajat (so'm): qator — modda, ustun — hudud (siyosat moddalari Markazda)",
      columns: [{ label: 'Modda guruhi', width: 2.2 }, { label: 'Modda', width: 2.6 }, { label: 'Markaz hisobidan', width: 0.9 }, { label: 'Jami', format: 'money' }, { label: "O'tgan davr", format: 'money' }, { label: "O'zgarish", format: 'signedPct', toneBy: 'down' }, ...units.map((k) => ({ label: unitName.get(k) ?? k, format: 'money' as const }))],
      rows: list.map((x) => [catLabel.get(x.root) ?? x.root, catLabel.get(x.code) ?? x.code, soha.policyCodes.has(x.code) ? 'ha' : '', som(x.s.amount), som(x.s.previous), changePct(x.s.amount, x.s.previous), ...units.map((k) => som(x.m.get(k)?.amount ?? 0n))]),
      total: ['JAMI', '', '', som(list.reduce((a, x) => a + x.s.amount, 0n)), som(list.reduce((a, x) => a + x.s.previous, 0n)), changePct(list.reduce((a, x) => a + x.s.amount, 0n), list.reduce((a, x) => a + x.s.previous, 0n)), ...units.map((k) => som(list.reduce((a, x) => a + (x.m.get(k)?.amount ?? 0n), 0n)))],
      freeze: true,
      filter: true,
    };
  }

  // ─────────── 5. Hududlar jadvali ───────────

  private unitsFlat(R: RegionsResult): TableBlock {
    const kind = (u: RegionUnit) => (u.kind === 'region' ? 'Hudud' : u.kind === 'center' ? 'Markaz' : 'Biriktirilmagan');
    return {
      type: 'table',
      columns: [
        { label: 'Birlik', width: 2.2 },
        { label: 'Turi' },
        { label: 'Daromad', format: 'money' },
        { label: 'Xarajat', format: 'money' },
        { label: 'shundan ish haqi', format: 'money' },
        { label: 'Natija', format: 'money', toneBy: 'up' },
        { label: 'Rentabellik', format: 'pct' },
        { label: "O'tgan davr: daromad", format: 'money' },
        { label: "O'tgan davr: xarajat", format: 'money' },
        { label: "O'tgan davr: natija", format: 'money' },
        { label: "Daromad o'zgarishi", format: 'signedPct', toneBy: 'up' },
        { label: "Xarajat o'zgarishi", format: 'signedPct', toneBy: 'down' },
        { label: 'Xodimlar', format: 'int' },
        { label: "O'tgan davr: xodimlar", format: 'int' },
        { label: 'Bir xodimga daromad', format: 'money' },
        { label: 'Bir xodimga xarajat', format: 'money' },
        { label: 'Daromad yozuvlari', format: 'int' },
        { label: 'Xarajat yozuvlari', format: 'int' },
      ],
      rows: R.units.map((u) => {
        const res = big(u.incomeTiyin) - big(u.expenseTiyin);
        return [
          u.name,
          kind(u),
          som(u.incomeTiyin),
          som(u.expenseTiyin),
          som(u.payrollTiyin),
          som(res),
          marginPct(u.incomeTiyin, u.expenseTiyin),
          som(u.previousIncomeTiyin),
          som(u.previousExpenseTiyin),
          som(big(u.previousIncomeTiyin) - big(u.previousExpenseTiyin)),
          changePct(u.incomeTiyin, u.previousIncomeTiyin),
          changePct(u.expenseTiyin, u.previousExpenseTiyin),
          u.headcount,
          u.previousHeadcount,
          u.headcount > 0 ? Math.round(Number(big(u.incomeTiyin)) / u.headcount) / 100 : null,
          u.headcount > 0 ? Math.round(Number(big(u.expenseTiyin)) / u.headcount) / 100 : null,
          u.incomeCount,
          u.expenseCount,
        ];
      }),
      freeze: true,
      filter: true,
    };
  }

  // ─────────── 6–10. Tekis ro'yxatlar ───────────

  private districtsFlat(drills: Map<string, RegionDistrictsResult & { details: DistrictDetailResult[] }>, unitName: Map<string, string>): TableBlock {
    const rows: Cell[][] = [];
    for (const [key, d] of drills) {
      for (const r of d.districts) {
        rows.push([
          unitName.get(key) ?? d.region.name,
          r.name,
          som(r.incomeTiyin),
          som(r.allocatedIncomeTiyin),
          som(r.previousIncomeTiyin),
          r.quantity,
          r.previousQuantity,
          som(r.expenseTiyin),
          som(r.payrollTiyin),
          som(r.leaseTiyin),
          som(r.otherTiyin),
          som(r.previousExpenseTiyin),
          som(r.resultTiyin),
          som(r.previousResultTiyin),
          som(big(r.resultTiyin) - big(r.previousResultTiyin)),
          marginPct(r.incomeTiyin, r.expenseTiyin),
          r.headcount,
          som(r.planTiyin),
          som(r.factTiyin),
          ratio(r.factTiyin, r.planTiyin),
        ]);
      }
    }
    return {
      type: 'table',
      columns: [
        { label: 'Hudud', width: 1.6 },
        { label: 'Tuman', width: 1.8 },
        { label: 'Daromad', format: 'money' },
        { label: 'shundan taqsimlangan', format: 'money' },
        { label: "O'tgan davr: daromad", format: 'money' },
        { label: 'Xizmatlar soni', format: 'int' },
        { label: "O'tgan davr: soni", format: 'int' },
        { label: 'Xarajat', format: 'money' },
        { label: 'Ish haqi', format: 'money' },
        { label: 'Ijara', format: 'money' },
        { label: 'Boshqa', format: 'money' },
        { label: "O'tgan davr: xarajat", format: 'money' },
        { label: 'Natija', format: 'money', toneBy: 'up' },
        { label: "O'tgan davr: natija", format: 'money' },
        { label: "Natija o'zgarishi", format: 'money', toneBy: 'up' },
        { label: 'Rentabellik', format: 'pct' },
        { label: 'Xodimlar', format: 'int' },
        { label: 'Reja (xodimlar)', format: 'money' },
        { label: 'Fakt (xodimlar)', format: 'money' },
        { label: 'Reja bajarilishi', format: 'pct' },
      ],
      rows,
      freeze: true,
      filter: true,
      note: "«shundan taqsimlangan» — viloyat darajasida (tumansiz) yozilgan daromaddan shu tumanga taqsimlangan qism. Reja/fakt — Natijalar faylidan, daromadga qo'shilmaydi.",
    };
  }

  private servicesFlat(details: { region: string; d: DistrictDetailResult }[]): TableBlock {
    const rows: Cell[][] = [];
    for (const { region, d } of details) {
      for (const s of d.services) rows.push([region, d.district.name, s.label, s.quantity, s.previousQuantity, som(s.amountTiyin), som(s.previousTiyin), changePct(s.amountTiyin, s.previousTiyin), som(s.averageTiyin)]);
    }
    return {
      type: 'table',
      columns: [
        { label: 'Hudud', width: 1.6 },
        { label: 'Tuman', width: 1.8 },
        { label: 'Xizmat turi', width: 2.6 },
        { label: 'Soni', format: 'int' },
        { label: "O'tgan davr: soni", format: 'int' },
        { label: 'Summa', format: 'money' },
        { label: "O'tgan davr: summa", format: 'money' },
        { label: "O'zgarish", format: 'signedPct', toneBy: 'up' },
        { label: "O'rtacha narx", format: 'money' },
      ],
      rows,
      freeze: true,
      filter: true,
    };
  }

  private partsFlat(details: { region: string; d: DistrictDetailResult }[], center: (CenterDetailResult & { details: DepartmentDetailResult[] }) | null): TableBlock {
    const rows: Cell[][] = [];
    for (const { region, d } of details) for (const p of d.expenseParts) rows.push([region, d.district.name, p.label, som(p.amountTiyin), som(p.previousTiyin), changePct(p.amountTiyin, p.previousTiyin)]);
    if (center) {
      for (const d of center.details) for (const p of d.expenseParts) rows.push([center.center.name, d.department.name, p.label, som(p.amountTiyin), som(p.previousTiyin), changePct(p.amountTiyin, p.previousTiyin)]);
      for (const p of center.regionalParts) rows.push([center.center.name, "Hududlar uchun to'langan", p.label, som(p.amountTiyin), som(p.previousTiyin), changePct(p.amountTiyin, p.previousTiyin)]);
      if (big(center.totals.assetsExpenseTiyin) !== 0n) rows.push([center.center.name, 'Asosiy vositalar', 'Asosiy vositalar sarfi (eskirish)', som(center.totals.assetsExpenseTiyin), som(center.totals.previousAssetsExpenseTiyin), changePct(center.totals.assetsExpenseTiyin, center.totals.previousAssetsExpenseTiyin)]);
    }
    return {
      type: 'table',
      columns: [
        { label: 'Hudud / Markaz', width: 1.6 },
        { label: "Tuman / bo'lim", width: 1.8 },
        { label: 'Modda', width: 2.6 },
        { label: 'Summa', format: 'money' },
        { label: "O'tgan davr", format: 'money' },
        { label: "O'zgarish", format: 'signedPct', toneBy: 'down' },
      ],
      rows,
      freeze: true,
      filter: true,
      note: "Tumanlarda — ish haqi, ijara, mashinalar va modda guruhlari (tuman sahifasidagidek); Markazda — bo'lim moddalari va hududlar uchun to'langan moddalar.",
    };
  }

  private employeesFlat(details: { region: string; d: DistrictDetailResult }[], center: (CenterDetailResult & { details: DepartmentDetailResult[] }) | null): TableBlock {
    const rows: Cell[][] = [];
    for (const { region, d } of details) {
      for (const e of d.employees) rows.push([region, d.district.name, e.fullName, e.position ?? '', EMPLOYMENT[e.employmentType] ?? e.employmentType, som(e.salaryTiyin), som(e.previousSalaryTiyin), e.paidMonths, som(e.planTiyin), som(e.factTiyin), som(e.bonusTiyin), ratio(e.factTiyin, e.planTiyin)]);
    }
    if (center) {
      for (const d of center.details) {
        for (const e of d.employees) rows.push([center.center.name, d.department.name, e.fullName, e.position ?? '', EMPLOYMENT[e.employmentType] ?? e.employmentType, som(e.salaryTiyin), som(e.previousSalaryTiyin), e.paidMonths, null, null, null, null]);
      }
    }
    return {
      type: 'table',
      columns: [
        { label: 'Hudud / Markaz', width: 1.6 },
        { label: "Tuman / bo'lim", width: 1.8 },
        { label: 'F.I.Sh.', width: 2.4 },
        { label: 'Lavozim', width: 1.8 },
        { label: 'Turi' },
        { label: 'Ish haqi', format: 'money' },
        { label: "O'tgan davr: ish haqi", format: 'money' },
        { label: 'Oylar soni', format: 'int' },
        { label: 'Reja', format: 'money' },
        { label: 'Fakt', format: 'money' },
        { label: 'Bonus', format: 'money' },
        { label: 'Reja bajarilishi', format: 'pct' },
      ],
      rows,
      freeze: true,
      filter: true,
      note: "Shaxsiy identifikatorlar (JShShIR) faylga chiqarilmaydi. Hududda — tuman xarajatiga kirgan ish haqi; Markazda — bo'lim xodimlari.",
    };
  }

  private employeeMonthsFlat(rows: Awaited<ReturnType<DistrictsService['employeesMonths']>>['rows']): TableBlock {
    return {
      type: 'table',
      columns: [
        { label: 'Hudud', width: 1.6 },
        { label: 'Tuman', width: 1.8 },
        { label: 'F.I.Sh.', width: 2.4 },
        { label: 'Lavozim', width: 1.8 },
        { label: 'Turi' },
        { label: 'Oy' },
        { label: 'Ish haqi', format: 'money' },
        { label: 'Reja', format: 'money' },
        { label: 'Fakt', format: 'money' },
        { label: 'Bonus', format: 'money' },
      ],
      rows: rows.map((r) => [r.regionName, r.districtName ?? '', r.fullName, r.position ?? '', EMPLOYMENT[r.employmentType] ?? r.employmentType, r.period, som(r.salaryTiyin), som(r.planTiyin), som(r.factTiyin), som(r.bonusTiyin)]),
      freeze: true,
      filter: true,
      note: "Hudud va tuman — o'sha oy xodim qayerda ishlagani (joylashuv tarixidan). Ish haqi — tasdiqlangan vedomostlardan (hudud va Markaz).",
    };
  }

  // ─────────── 11. Oylar ───────────

  private monthsTree(R: RegionsResult): TableBlock {
    const rows: Cell[][] = [];
    const levels: number[] = [];
    const add = (level: number, name: string, values: bigint[]) => {
      rows.push([name, ...values.map((v) => som(v)), som(values.reduce((a, v) => a + v, 0n))]);
      levels.push(level);
    };
    const totalIn = R.months.map(() => 0n);
    const totalEx = R.months.map(() => 0n);
    for (const u of R.units) {
      const inc = u.incomeTrend.map((v) => BigInt(v));
      const exp = u.expenseTrend.map((v) => BigInt(v));
      inc.forEach((v, i) => (totalIn[i]! += v));
      exp.forEach((v, i) => (totalEx[i]! += v));
      add(0, `${u.name} — natija`, inc.map((v, i) => v - exp[i]!));
      add(1, 'Daromad', inc);
      add(1, 'Xarajat', exp);
    }
    add(0, 'JAMI — natija', totalIn.map((v, i) => v - totalEx[i]!));
    add(1, 'Daromad', totalIn);
    add(1, 'Xarajat', totalEx);
    return {
      type: 'table',
      columns: [{ label: 'Birlik', width: 2.6 }, ...R.months.map((m) => ({ label: periodShort(m), format: 'money' as const, toneBy: 'up' as const, width: 0.9 })), { label: '24 oy jami', format: 'money' }],
      rows,
      levels,
      openLevels: 1,
      freeze: true,
      note: `Oylar: ${periodLabel(R.months[0]!)} — ${periodLabel(R.months[R.months.length - 1]!)}. Ichida — daromad va xarajat.`,
    };
  }

  // ─────────── 12. Markaz ───────────

  private centerBlocks(c: CenterDetailResult & { details: DepartmentDetailResult[] }, R: RegionsResult): TableBlock[] {
    const t = c.totals;
    const blocks: TableBlock[] = [
      {
        type: 'table',
        title: 'Markaz jami',
        columns: [{ label: "Ko'rsatkich", width: 2.6 }, { label: 'Joriy davr', format: 'money' }, { label: "O'tgan davr", format: 'money' }, { label: "O'zgarish", format: 'signedPct', toneBy: 'row' }],
        rows: [
          ['Daromad', som(t.incomeTiyin), som(t.previousIncomeTiyin), changePct(t.incomeTiyin, t.previousIncomeTiyin)],
          ["O'z xarajati", som(t.ownExpenseTiyin), som(t.previousOwnExpenseTiyin), changePct(t.ownExpenseTiyin, t.previousOwnExpenseTiyin)],
          ["Hududlar uchun to'langan", som(t.regionalExpenseTiyin), som(t.previousRegionalExpenseTiyin), changePct(t.regionalExpenseTiyin, t.previousRegionalExpenseTiyin)],
          ['Asosiy vositalar sarfi', som(t.assetsExpenseTiyin), som(t.previousAssetsExpenseTiyin), changePct(t.assetsExpenseTiyin, t.previousAssetsExpenseTiyin)],
          ['Xarajat jami', som(t.expenseTiyin), som(t.previousExpenseTiyin), changePct(t.expenseTiyin, t.previousExpenseTiyin)],
          ['shundan ish haqi', som(t.payrollTiyin), som(t.previousPayrollTiyin), changePct(t.payrollTiyin, t.previousPayrollTiyin)],
          ['Sof xarajat (xarajat − daromad)', som(big(t.expenseTiyin) - big(t.incomeTiyin)), som(big(t.previousExpenseTiyin) - big(t.previousIncomeTiyin)), changePct(big(t.expenseTiyin) - big(t.incomeTiyin), big(t.previousExpenseTiyin) - big(t.previousIncomeTiyin))],
          ['Xodimlar', t.headcount, t.previousHeadcount, null],
        ],
        rowTone: ['up', 'down', 'down', 'down', 'down', 'down', 'down', null],
      },
      {
        type: 'table',
        title: "Bo'limlar",
        columns: [
          { label: "Bo'lim", width: 2.4 },
          { label: 'Daromad', format: 'money' },
          { label: 'Xarajat', format: 'money' },
          { label: 'shundan ish haqi', format: 'money' },
          { label: 'Boshqa', format: 'money' },
          { label: "O'tgan davr: xarajat", format: 'money' },
          { label: "O'zgarish", format: 'signedPct', toneBy: 'down' },
          { label: 'Xodimlar', format: 'int' },
          { label: 'Bir xodimga xarajat', format: 'money' },
        ],
        rows: c.departments.map((d) => [d.name, som(d.incomeTiyin), som(d.expenseTiyin), som(d.payrollTiyin), som(d.otherTiyin), som(d.previousExpenseTiyin), changePct(d.expenseTiyin, d.previousExpenseTiyin), d.headcount, som(d.perHeadTiyin)]),
        total: ['JAMI', som(c.departments.reduce((a, d) => a + big(d.incomeTiyin), 0n)), som(c.departments.reduce((a, d) => a + big(d.expenseTiyin), 0n)), som(c.departments.reduce((a, d) => a + big(d.payrollTiyin), 0n)), som(c.departments.reduce((a, d) => a + big(d.otherTiyin), 0n)), som(c.departments.reduce((a, d) => a + big(d.previousExpenseTiyin), 0n)), null, c.departments.reduce((a, d) => a + d.headcount, 0), null],
      },
    ];
    if (c.regionalBy.length) {
      blocks.push({
        type: 'table',
        title: "Hududlar uchun to'langan — qaysi hudud uchun",
        columns: [{ label: 'Hudud', width: 2.4 }, { label: 'Summa', format: 'money' }, { label: 'Ulush', format: 'pct' }],
        rows: c.regionalBy.map((r) => [r.name, som(r.amountTiyin), ratio(r.amountTiyin, t.regionalExpenseTiyin)]),
        total: ['JAMI', som(t.regionalExpenseTiyin), c.regionalBy.length ? 100 : null],
      });
    }
    blocks.push({
      type: 'table',
      title: 'Markaz — 12 oy',
      columns: [{ label: 'Oy' }, { label: 'Daromad', format: 'money' }, { label: "O'z xarajati", format: 'money' }, { label: "Hududlar uchun", format: 'money' }, { label: 'Asosiy vositalar', format: 'money' }, { label: 'Xarajat jami', format: 'money' }],
      rows: c.months.map((m, i) => {
        const own = big(c.trend.own[i]);
        const reg = big(c.trend.regional[i]);
        const ast = big(c.trend.assets[i]);
        return [periodLabel(m), som(c.trend.income[i]), som(own), som(reg), som(ast), som(own + reg + ast)];
      }),
    });
    void R;
    return blocks;
  }

  // ─────────── 13. Biriktirilmagan ───────────

  private unassignedBlocks(u: UnassignedResult): TableBlock[] {
    const group = (title: string, list: { label: string; totalTiyin: string; count: number }[], all: string): TableBlock => ({
      type: 'table',
      title,
      columns: [{ label: 'Nomi', width: 2.6 }, { label: 'Summa', format: 'money' }, { label: 'Yozuvlar', format: 'int' }, { label: 'Ulush', format: 'pct' }],
      rows: list.map((g) => [g.label, som(g.totalTiyin), g.count, ratio(g.totalTiyin, all)]),
    });
    const blocks: TableBlock[] = [
      {
        type: 'table',
        title: 'Oylar bo\'yicha',
        columns: [{ label: 'Oy' }, { label: 'Daromad', format: 'money' }, { label: 'Xarajat', format: 'money' }],
        rows: u.months.map((m) => [periodLabel(m.period), som(m.incomeTiyin), som(m.expenseTiyin)]),
        total: ['JAMI', som(u.income.totalTiyin), som(u.expense.totalTiyin)],
        note: big(u.policyExcludedTiyin) !== 0n ? `Siyosat bo'yicha Markazga o'tgani uchun bu ro'yxatga kirmagan xarajat: ${fmtSom(Number(u.policyExcludedTiyin) / 100)}.` : undefined,
      },
    ];
    if (u.income.byCategory.length) blocks.push(group('Daromad — turlari', u.income.byCategory, u.income.totalTiyin));
    if (u.expense.byCategory.length) blocks.push(group('Xarajat — moddalari', u.expense.byCategory, u.expense.totalTiyin));
    if (u.expense.bySource.length) blocks.push(group('Xarajat — qayerdan kiritilgan', u.expense.bySource, u.expense.totalTiyin));
    if (u.income.bySource.length) blocks.push(group('Daromad — qayerdan kiritilgan', u.income.bySource, u.income.totalTiyin));
    if (u.expense.byFile.length || u.income.byFile.length) blocks.push(group('Fayllar bo\'yicha (daromad va xarajat)', [...u.income.byFile, ...u.expense.byFile], (big(u.income.totalTiyin) + big(u.expense.totalTiyin)).toString()));
    const items = [...u.income.items.map((i) => ({ side: 'Daromad', i })), ...u.expense.items.map((i) => ({ side: 'Xarajat', i }))];
    if (items.length) {
      blocks.push({
        type: 'table',
        title: 'Yozuvlar',
        columns: [{ label: 'Turi' }, { label: 'Sana' }, { label: 'Modda / xizmat', width: 2.2 }, { label: 'Summa', format: 'money' }, { label: 'Kontragent / mijoz', width: 2 }, { label: 'Hujjat' }, { label: 'Izoh', width: 2.4 }, { label: 'Fayl', width: 1.6 }],
        rows: items.map(({ side, i }) => [side, uzDate(i.date.slice(0, 10)), i.categoryLabel, som(i.amountTiyin), i.counterparty ?? '', i.documentNo ?? '', i.description ?? '', i.fileName ?? '']),
        note: u.income.truncated || u.expense.truncated ? "Ro'yxat qisqartirilgan — eng katta yozuvlar ko'rsatildi (Solishtirma › Biriktirilmagan oynasidagidek); jamilar yuqoridagi jadvallarda to'liq." : undefined,
      });
    }
    return blocks;
  }

  // ─────────── 14. Xodimlar harakati ───────────

  private movesBlocks(list: ChangesResult[]): TableBlock[] {
    const rows: Cell[][] = [];
    const levels: number[] = [];
    for (const m of list) {
      rows.push([periodLabel(m.period), m.totals.currentCount, m.totals.previousCount, som(m.totals.currentTiyin), som(m.totals.previousTiyin), m.counts.hired ?? 0, m.counts.returned ?? 0, m.counts.fired ?? 0, m.counts.idle ?? 0, m.counts.moved ?? 0]);
      levels.push(0);
      for (const u of m.units) {
        rows.push([u.name, u.currentCount, u.previousCount, som(u.currentTiyin), som(u.previousTiyin), u.hired, u.returned, u.fired, u.idle, u.movedIn + u.movedOut]);
        levels.push(1);
      }
    }
    const people: Cell[][] = list.flatMap((m) =>
      m.people.map((p) => [periodLabel(m.period), p.fullName, p.position ?? '', CHANGE_LABEL[p.kind] ?? p.kind, p.unitName, p.fromUnitName ?? '', som(p.previousTiyin), som(p.currentTiyin), p.hiredAt ? uzDate(p.hiredAt.slice(0, 10)) : '', p.firedAt ? uzDate(p.firedAt.slice(0, 10)) : '']),
    );
    return [
      {
        type: 'table',
        title: 'Oylar → hududlar va Markaz',
        columns: [
          { label: 'Oy / birlik', width: 2.4 },
          { label: 'Oylik hisoblangan', format: 'int' },
          { label: "O'tgan oy", format: 'int' },
          { label: 'Ish haqi', format: 'money' },
          { label: "O'tgan oy: ish haqi", format: 'money' },
          { label: 'Ishga olindi', format: 'int' },
          { label: 'Qaytdi', format: 'int' },
          { label: "Bo'shatildi", format: 'int' },
          { label: 'Ishlamadi', format: 'int' },
          { label: "Ko'chdi (kirdi+chiqdi)", format: 'int' },
        ],
        rows,
        levels,
        openLevels: 1,
      },
      {
        type: 'table',
        title: "Xodimlar ro'yxati (harakat bo'yicha)",
        columns: [{ label: 'Oy' }, { label: 'F.I.Sh.', width: 2.4 }, { label: 'Lavozim', width: 1.8 }, { label: 'Harakat' }, { label: 'Birlik', width: 1.6 }, { label: 'Qayerdan', width: 1.6 }, { label: "O'tgan oy oyligi", format: 'money' }, { label: 'Bu oy oyligi', format: 'money' }, { label: 'Ishga kirgan' }, { label: "Bo'shagan" }],
        rows: people,
      },
    ];
  }

  // ─────────── 15. Tekshiruv ───────────

  private checkBlocks(
    R: RegionsResult,
    soha: SohaSink,
    drills: Map<string, RegionDistrictsResult & { details: DistrictDetailResult[] }>,
    center: CenterDetailResult | null,
    none: UnassignedResult | null,
    sources: SourceLog[],
  ): TableBlock[] {
    const rows: Cell[][] = [];
    const add = (name: string, a: bigint | null, b: bigint | null, note = '') => {
      const ok = a !== null && b !== null && a === b;
      rows.push([name, a === null ? null : som(a), b === null ? null : som(b), a === null || b === null ? null : som(a - b), a === null || b === null ? "Manba yo'q" : ok ? 'Mos' : 'Farq bor', note]);
    };
    const unitsIncome = R.units.reduce((s, u) => s + big(u.incomeTiyin), 0n);
    const unitsExpense = R.units.reduce((s, u) => s + big(u.expenseTiyin), 0n);
    const sohaIncome = [...soha.income.values()].reduce((s, m) => s + sumCells(m).amount, 0n);
    const sohaExpense = [...soha.expense.values()].reduce((s, m) => s + sumCells(m).amount, 0n);
    add('Daromad: birliklar jami = sohalar jami', unitsIncome, sohaIncome);
    add('Xarajat: birliklar jami = sohalar jami', unitsExpense, sohaExpense);
    for (const u of R.units.filter((x) => x.kind === 'region')) {
      const d = drills.get(u.key);
      add(`${u.name}: daromad = tumanlar yig'indisi`, big(u.incomeTiyin), d ? big(d.totals.incomeTiyin) : null);
      add(`${u.name}: xarajat = tumanlar yig'indisi`, big(u.expenseTiyin), d ? big(d.totals.expenseTiyin) : null);
    }
    const cu = R.units.find((u) => u.kind === 'center');
    if (cu) {
      add('Markaz: daromad (Solishtirma = Markaz sahifasi)', big(cu.incomeTiyin), center ? big(center.totals.incomeTiyin) : null);
      add('Markaz: xarajat (Solishtirma = Markaz sahifasi)', big(cu.expenseTiyin), center ? big(center.totals.expenseTiyin) : null);
    }
    const nu = R.units.find((u) => u.kind === 'unassigned');
    if (nu && none) {
      add('Biriktirilmagan: daromad', big(nu.incomeTiyin), big(none.income.totalTiyin));
      add('Biriktirilmagan: xarajat', big(nu.expenseTiyin), big(none.expense.totalTiyin));
    }
    return [
      {
        type: 'table',
        title: 'Jamilar mosligi (tiyingacha)',
        columns: [{ label: 'Tekshiruv', width: 3.4 }, { label: 'A', format: 'money' }, { label: 'B', format: 'money' }, { label: 'Farq', format: 'money' }, { label: 'Holat', tones: { Mos: 'good', 'Farq bor': 'bad', "Manba yo'q": 'warn' } }, { label: 'Izoh', width: 2.4 }],
        rows,
        note: "Farq bo'lsa — yozuvlar ikki joyda turlicha bog'langan (masalan, ish haqi xodim joylashuvi o'zgargandan keyin yuklangan). Raqamlar Solishtirma sahifasidagidek, hisobot ularni o'zgartirmaydi.",
      },
      {
        type: 'table',
        title: 'Manbalar holati',
        columns: [{ label: 'Manba', width: 2.6 }, { label: 'Holat', tones: { "To'liq": 'good', Xato: 'bad' } }, { label: 'Izoh', width: 3.4 }],
        rows: sources.map((s) => [s.name, s.ok ? "To'liq" : 'Xato', s.note]),
      },
    ];
  }

  // ─────────── 16. Metodika ───────────

  private methodology(R: RegionsResult) {
    return {
      type: 'formulas' as const,
      items: [
        { name: 'Daromad', formula: "Daromadlar bo'limidagi yozuvlar (davr ichidagi sana bo'yicha). Hudud — yozuvdagi hudud; Markaz — hudud kodi 0 yoki Markaz bo'limi; qolgani — «Hududga biriktirilmagan»." },
        { name: 'Xarajat', formula: "Xarajatlar bo'limidagi yozuvlar (ish haqi, ijara, mashinalar va boshqalar). Xarajatlar siyosatidagi «Markaz hisobidan» moddalar qayerda yozilgan bo'lsa ham — Markaz xarajati (hududlar uchun to'langan)." },
        { name: 'Natija', formula: 'Daromad − Xarajat' },
        { name: 'Rentabellik', formula: 'Natija ÷ Daromad × 100 (daromad musbat bo\'lsagina)' },
        { name: "O'zgarish, %", formula: "(Joriy − O'tgan) ÷ O'tgan × 100 — o'tgan davr qiymati musbat bo'lsagina; nol yoki manfiy bazada foiz ko'rsatilmaydi" },
        { name: "O'tgan davr", formula: `${R.compareLabel}: ${uzDate(R.previousRange.from)} — ${uzDate(R.previousRange.to)}` },
        { name: 'Tumanlar', formula: "Daromad — tuman kesimida yuklangan yozuvlar; tumansiz daromad tumanlarga xodimlar tushumi (Natijalar fayli), bo'lmasa xodimlar soni, bo'lmasa ish haqi ulushiga qarab taqsimlanadi. Ish haqi — xodim o'sha oy ishlagan tumanga; ijara — shartnomadagi tumanga; qolgani — yozuvdagi tumanga, bo'lmasa «Tumanga bo'linmagan»." },
        { name: 'Reja / Fakt (xodimlar)', formula: "Natijalar faylidan — ma'lumot uchun, daromadga qo'shilmaydi. Reja bajarilishi = Fakt ÷ Reja × 100." },
        { name: 'Markaz', formula: "O'z xarajati (bo'limlar bo'yicha) + hududlar uchun to'langan (siyosat moddalari) + asosiy vositalar sarfi (eskirish). Sof xarajat = xarajat − Markaz daromadi." },
        { name: 'Markazni qoplash', formula: 'Hududlar natijasi ÷ Markaz sof xarajati × 100' },
        { name: 'Xodimlar soni', formula: "Xodimlar bo'limidan: davr ichida ishlagan (ishga kirgan sanasi davr oxirigacha, bo'shagani davr boshidan keyin). Tumanda — davrda ish haqi olganlar." },
        { name: 'Sohalar', formula: "Daromad — xizmat turlari (daromad turlari); xarajat — modda guruhi (eng yuqori ota modda) → modda. Hamma birliklar bo'yicha yig'indi korxona jamisiga teng (Tekshiruv varag'ida)." },
        { name: "Ichma-ich varaqlar", formula: "Excel'da qatorlar guruhlangan: chapdagi [+] — ichkariga kirish, [−] — yopish; yuqori chapdagi 1, 2, 3 … — shu darajagacha hammasini ochish. Jami qatori — faqat eng yuqori daraja yig'indisi." },
        { name: 'Pul aniqligi', formula: "Hisob tiyinda (butun son) olib boriladi, jadvalda so'mda ko'rsatiladi." },
      ],
    };
  }
}

function changeText(cur: bigint, prev: bigint, label: string): string {
  const p = changePct(cur, prev);
  return p === null ? `${label}: taqqoslab bo'lmaydi` : `${label}ga nisbatan ${p > 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')}%`;
}

/** "YYYY-MM-DD" oralig'idagi oylar */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}