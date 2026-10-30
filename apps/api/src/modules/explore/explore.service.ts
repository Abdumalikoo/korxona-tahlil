import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { SEGMENTS, segmentKey, segmentLabel, unitKeyOf } from '../../common/segments/segments';
import { ownQomitaIncome, QOMITA_COVER, QOMITA_COVER_OUT, QOMITA_SEGMENT, qomitaIncomeOwners, type QomitaOwner } from '../qomita/qomita.util';
import { Nazorat3802Service } from '../qomita/nazorat-3802.service';
import { loadPolicyRouting, type PolicyRouting } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { ranges, type Ranges, type Span } from './explore.range';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Daromad / Xarajat / Tahlil — ichiga kirib boriladigan jadvallar.
//
//  Har bir qator: joriy davr, o'tgan davr (teng uzunlikdagi oldingi), o'tgan yil va yozuvlar soni.
//  Har bir qatorda «f» — shu qatorni tashkil qilgan yozuvlar filtri: /explore/records ga berilsa,
//  aynan o'sha yozuvlar va ularning jami qaytadi (jadvaldagi summa bilan bir xil).
//
//  Birlik qoidasi Solishtirma bilan bir xil:
//   yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya) bo'lsa — o'sha bo'limniki ("s:KOD");
//   hudud kodi bo'lsa — hudud (0 — Markaz); hudud yo'q, bo'lim bor — Markaz; hech biri yo'q — biriktirilmagan.
//  Xarajatda — Xarajatlar siyosati ham (Solishtirma kabi): modda boshqa birlik hisobidan bo'lsa, o'sha birlikka o'tadi.
//  Barcha summalar tiyinda (son).
// ═══════════════════════════════════════════════════════════

export type Kind = 'income' | 'expense';

export interface Filter {
  /** Moddalar (xarajatda — ichki moddalari bilan) */
  cats?: string[];
  /** center | regions | segments | none | r:<kod> | s:<yo'nalish kodi> */
  unit?: string;
  /** Bo'lim id yoki 'none' */
  dep?: string;
  /** Oy: 2026-03 */
  month?: string;
  /** Mijoz / kontragent ('' — ko'rsatilmagan) */
  party?: string;
  /** Faqat to'lanmaganlar */
  unpaid?: boolean;
  /** Xarajat moddasi ichki moddalarisiz (faqat o'ziga yozilganlari) */
  exact?: boolean;
}

export interface Vals {
  cur: number;
  prev: number;
  ly: number;
  count: number;
}

export interface Node extends Vals {
  key: string;
  label: string;
  kind: Kind;
  f: Filter;
  /** Qo'shimcha ustunlar: Markaz / Hududlar ulushi, to'lanmagan va h.k. */
  x?: Record<string, number>;
  children?: Node[];
}

export interface MatrixRow {
  key: string;
  label: string;
  kind: Kind;
  f: Filter;
  values: number[];
  total: number;
  children?: MatrixRow[];
}


interface Row {
  cat: string;
  unit: string;
  dep: string;
  period: string;
  party: string;
  status: string;
  sum: number;
  /** To'lanmagan qismi (daromadda — debitorlik, xarajatda — kreditorlik) */
  open: number;
  count: number;
  /** Xarajatlar siyosati bo'yicha yozilgan joyidan boshqa birlikka o'tkazilgan */
  routed: boolean;
}

interface Sets {
  cur: Row[];
  prev: Row[];
  ly: Row[];
}

interface Lookups {
  regions: Map<number, string>;
  departments: Map<string, string>;
  incomeCats: Map<string, { label: string; order: number }>;
  expenseCats: Map<string, { label: string; parent: string | null; order: number }>;
  /** Xarajatlar siyosati (o'qib bo'lmasa — null: yozilgan joyi bo'yicha) */
  routing: PolicyRouting | null;
  /** Qo'mita ajratmasi egasi (Solishtirma bilan bir xil — pul berilgan bo'lim) */
  qomita: Map<string, QomitaOwner>;
  /** 3802 hovuzi moddalari — Qo'mita qatorida qoladi */
  qomitaPool: Set<string>;
}

type GroupModel = {
  groupBy: (args: unknown) => Promise<Array<Record<string, unknown> & { _sum: Record<string, bigint | null>; _count: { _all: number } }>>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  aggregate: (args: unknown) => Promise<{ _sum: Record<string, bigint | null>; _count: { _all: number } }>;
  count: (args: unknown) => Promise<number>;
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Xarajat yozuvining birligi: siyosat bo'yicha kim hisobidan, bo'lmasa — yozilgan joyi (Solishtirma bilan bir xil) */
export function expenseUnit(routing: PolicyRouting | null, r: { categoryCode: string; regionCode: number | null; departmentId: string | null; segment: string | null }): { unit: string; routed: boolean } {
  const own = unitKey(r.regionCode, r.departmentId, r.segment);
  const key = routing?.route(r)?.key;
  return key && key !== own ? { unit: key, routed: true } : { unit: own, routed: false };
}

/** Birlik filtri (center | regions | segments | none | r:<kod> | s:<kod>) shu birlik kalitiga mosmi */
export function unitMatches(filter: string, key: string): boolean {
  return filter === 'regions' ? key.startsWith('r:') : filter === 'segments' ? key.startsWith('s:') : key === filter;
}

/** Yozilgan joyi bo'yicha birlik (Solishtirma bilan bir xil qoida — common/segments) */
export function unitKey(regionCode: number | null, departmentId: string | null, segment?: string | null): string {
  return unitKeyOf(regionCode, departmentId, segment);
}

/** Yo'nalishlar (Tax free …) birlik kalitlari — tartib bo'yicha */
export const SEGMENT_KEYS: string[] = SEGMENTS.map((x) => segmentKey(x.code));

export const NO_PARTY = '';
const TOP_PARTIES = 30;
const PAGE_SIZE = 50;

@Injectable()
export class ExploreService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly nazorat?: Nazorat3802Service,
  ) {}

  /** 3802 hovuzi qoplashi (bo'lmasa — null: hovuz puli Qo'mita qatorida qoladi) */
  private qomitaCoverage() {
    return this.nazorat ? this.nazorat.coverage().catch(() => null) : Promise.resolve(null);
  }

  private model(kind: Kind): GroupModel {
    return (kind === 'income' ? this.prisma.income : this.prisma.expense) as unknown as GroupModel;
  }

  // ───────────────────────── Ma'lumot yuklash ─────────────────────────

  private async lookups(): Promise<Lookups> {
    const [regions, departments, incomeCats, expenseCats] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true, order: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, order: true } }),
    ]);
    const exp = new Map(expenseCats.map((c) => [c.code, { label: c.label, parent: c.parentCode ?? null, order: c.order ?? 0 }]));
    // Ish haqidan ushlanadigan daromad solig'i — «Soliqlar» ichida (yozuvlardan ajratiladi, pastda)
    const routing = await loadPolicyRouting(this.prisma, expenseCats.map((c) => ({ code: c.code, parentCode: c.parentCode }))).catch(() => null);
    const qomita = await qomitaIncomeOwners(this.prisma);
    const qomitaPool = (await this.qomitaCoverage())?.poolCodes ?? new Set<string>();
    return {
      qomita,
      qomitaPool,
      regions: new Map(regions.map((r) => [r.code, r.code === 0 ? 'Markaz' : r.name])),
      departments: new Map(departments.map((d) => [d.id, d.name])),
      incomeCats: new Map(incomeCats.map((c) => [c.code, { label: c.label, order: c.order ?? 0 }])),
      expenseCats: exp,
      routing,
    };
  }

  private async load(kind: Kind, s: Span, opts: { period?: boolean; party?: boolean; routing?: PolicyRouting | null } = {}): Promise<Row[]> {
    const partyField = kind === 'income' ? 'clientName' : 'counterparty';
    // Mijoz / kontragent kesimi alohida yuklanadi (aks holda guruhlar soni juda ko'payadi)
    const by = [...(opts.party ? [partyField, 'paymentStatus'] : ['categoryCode', 'regionCode', 'departmentId', 'segment', 'paymentStatus', ...(opts.period ? ['period'] : [])]), ...(kind === 'expense' ? ['source'] : [])];
    const owners = kind === 'income' ? await qomitaIncomeOwners(this.prisma) : null;
    const cov = kind === 'income' ? await this.qomitaCoverage() : null;
    const groups = await this.model(kind).groupBy({
      by,
      where: { deletedAt: null, date: { gte: s.start, lt: s.end } },
      _sum: kind === 'income' ? { amountTiyin: true, paidTiyin: true } : { amountTiyin: true },
      _count: { _all: true },
    });
    // 3802 hovuzi: har oy har bo'limga o'z xodimlariga qoplangani (+) va Qo'mita qatoridan (−) — Solishtirma bilan bir xil
    if (cov && owners && !opts.party) {
      for (const [period, m] of cov.covered) {
        const date = new Date(`${period}-15T07:00:00Z`);
        if (date < s.start || date >= s.end) continue;
        for (const c of m.values()) {
          const amount = c.amount;
          if (amount <= 0n) continue;
          groups.push({ categoryCode: QOMITA_COVER.code, regionCode: c.regionCode, departmentId: c.departmentId, segment: c.segment, paymentStatus: 'PAID', period, _sum: { amountTiyin: amount, paidTiyin: amount }, _count: { _all: 0 } });
          groups.push({ categoryCode: QOMITA_COVER_OUT.code, regionCode: null, departmentId: null, segment: QOMITA_SEGMENT, paymentStatus: 'PAID', period, _sum: { amountTiyin: -amount, paidTiyin: -amount }, _count: { _all: 0 } });
        }
      }
    }
    return groups.flatMap((g) => {
      const sum = num(g._sum.amountTiyin);
      const status = String(g.paymentStatus ?? 'PAID');
      // Daromadda to'langan qism alohida yoziladi; xarajatda — holat bo'yicha (qisman to'langani ham ochiq hisoblanadi)
      const open = status === 'PAID' ? 0 : kind === 'income' ? Math.max(0, sum - num(g._sum.paidTiyin)) : sum;
      const place = { categoryCode: String(g.categoryCode ?? ''), regionCode: (g.regionCode as number | null) ?? null, departmentId: (g.departmentId as string | null) ?? null, segment: (g.segment as string | null) ?? null };
      // Qo'mita ajratmasi — pul berilgan bo'limniki (Solishtirma bilan bir xil)
      if (owners) ownQomitaIncome([place], owners, cov?.poolCodes);
      // Mijoz / kontragent kesimida modda va joy yo'q — siyosat qo'llanmaydi (birlik u yerda ishlatilmaydi)
      const { unit, routed } = kind === 'expense' && !opts.party ? expenseUnit(opts.routing ?? null, place) : { unit: unitKey(place.regionCode, place.departmentId, place.segment), routed: false };
      const row: Row = {
        cat: place.categoryCode,
        unit,
        dep: place.departmentId ?? 'none',
        period: String(g.period ?? ''),
        party: String(g[partyField] ?? NO_PARTY),
        status,
        sum,
        open,
        count: g._count._all,
        routed,
      };
      // Daromad solig'i (JShDS) ish haqi ICHIDA — alohida xarajat qatori bo'lib yozilmaydi (ikki marta sanalmasin);
      // ish haqi — to'liq (hisoblangan) summa
      return [row];
    });
  }

  private async sets(kind: Kind, r: Ranges, routing: PolicyRouting | null, party = false): Promise<Sets> {
    const [cur, prev, ly] = await Promise.all([this.load(kind, r.cur, { period: !party, party, routing }), this.load(kind, r.prev, { party, routing }), this.load(kind, r.ly, { party, routing })]);
    return { cur, prev, ly };
  }

  // ───────────────────────── Filtr va yig'ish ─────────────────────────

  private readonly descCache = new WeakMap<Lookups, (code: string) => Set<string>>();

  /** Xarajat moddasi va uning barcha ichki moddalari */
  private descendants(lk: Lookups): (code: string) => Set<string> {
    const known = this.descCache.get(lk);
    if (known) return known;
    const children = new Map<string, string[]>();
    for (const [code, c] of lk.expenseCats) if (c.parent) children.set(c.parent, [...(children.get(c.parent) ?? []), code]);
    const cache = new Map<string, Set<string>>();
    const fn = (code: string) => {
      const hit = cache.get(code);
      if (hit) return hit;
      const out = new Set<string>([code]);
      const stack = [code];
      while (stack.length) for (const ch of children.get(stack.pop()!) ?? []) if (!out.has(ch)) (out.add(ch), stack.push(ch));
      cache.set(code, out);
      return out;
    };
    this.descCache.set(lk, fn);
    return fn;
  }

  private matcher(kind: Kind, f: Filter, lk: Lookups): (r: Row) => boolean {
    let cats: Set<string> | null = null;
    if (f.cats?.length) {
      if (kind === 'expense' && !f.exact) {
        const desc = this.descendants(lk);
        cats = new Set(f.cats.flatMap((c) => [...desc(c)]));
      } else cats = new Set(f.cats);
    }
    return (r) =>
      (!cats || cats.has(r.cat)) &&
      (!f.unit || unitMatches(f.unit, r.unit)) &&
      (!f.dep || r.dep === f.dep) &&
      (!f.month || r.period === f.month) &&
      (f.party === undefined || r.party === f.party) &&
      (!f.unpaid || r.status !== 'PAID');
  }

  private vals(s: Sets, test: (r: Row) => boolean): Vals & { open: number } {
    let cur = 0;
    let count = 0;
    let open = 0;
    for (const r of s.cur) if (test(r)) (cur += r.sum, count += r.count, open += r.open);
    let prev = 0;
    for (const r of s.prev) if (test(r)) prev += r.sum;
    let ly = 0;
    for (const r of s.ly) if (test(r)) ly += r.sum;
    return { cur, prev, ly, count, open };
  }

  private node(kind: Kind, s: Sets, lk: Lookups, key: string, label: string, f: Filter, children?: Node[]): Node {
    const v = this.vals(s, this.matcher(kind, f, lk));
    const out: Node = { key, label, kind, f, cur: v.cur, prev: v.prev, ly: v.ly, count: v.count, x: { open: v.open } };
    if (children?.length) out.children = children;
    return out;
  }

  private static nonEmpty(n: Node): boolean {
    return n.cur !== 0 || n.prev !== 0 || n.ly !== 0 || n.count !== 0;
  }

  private static byCur(a: Node, b: Node): number {
    return b.cur - a.cur || b.prev - a.prev || a.label.localeCompare(b.label);
  }

  /** Ro'yxat → nolsiz, katta summadan kichigiga */
  private static tidy(list: Node[]): Node[] {
    return list.filter(ExploreService.nonEmpty).sort(ExploreService.byCur);
  }

  private unitLabel(unit: string, lk: Lookups): string {
    if (unit === 'center') return 'Markaz';
    if (unit === 'none') return 'Biriktirilmagan';
    if (unit === 'regions') return 'Hududlar';
    if (unit === 'segments') return "Yo'nalishlar";
    if (unit.startsWith('s:')) return segmentLabel(unit.slice(2));
    const code = Number(unit.slice(2));
    return lk.regions.get(code) ?? `Hudud ${code}`;
  }

  private depLabel(dep: string, lk: Lookups): string {
    return dep === 'none' ? "Bo'lim ko'rsatilmagan" : (lk.departments.get(dep) ?? 'Noma’lum bo‘lim');
  }

  private catLabel(kind: Kind, code: string, lk: Lookups): string {
    return (kind === 'income' ? lk.incomeCats.get(code)?.label : lk.expenseCats.get(code)?.label) ?? code;
  }

  private static distinct(s: Sets, pick: (r: Row) => string): string[] {
    const out = new Set<string>();
    for (const list of [s.cur, s.prev, s.ly]) for (const r of list) out.add(pick(r));
    return [...out];
  }

  /** Birliklar: Markaz, hududlar (kod tartibida), yo'nalishlar (Tax free …), so'ng biriktirilmagan */
  private unitsOf(s: Sets): string[] {
    const units = ExploreService.distinct(s, (r) => r.unit);
    const regions = units.filter((u) => u.startsWith('r:')).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    return [...(units.includes('center') ? ['center'] : []), ...regions, ...SEGMENT_KEYS.filter((k) => units.includes(k)), ...(units.includes('none') ? ['none'] : [])];
  }

  /** Davrda yozuvi bor yo'nalishlar (Tax free …) */
  private segmentsOf(...sets: Sets[]): string[] {
    const have = new Set(sets.flatMap((s) => ExploreService.distinct(s, (r) => r.unit)));
    return SEGMENT_KEYS.filter((k) => have.has(k));
  }

  /** Yo'nalishlar bo'yicha jami (KPI kartochkalari uchun) */
  private bySegment(kind: Kind, s: Sets, lk: Lookups) {
    return this.segmentsOf(s).map((k) => ({ key: k, label: this.unitLabel(k, lk), ...this.vals(s, this.matcher(kind, { unit: k }, lk)) }));
  }

  private matrix(kind: Kind, s: Sets, lk: Lookups, months: string[], key: string, label: string, f: Filter): MatrixRow {
    const test = this.matcher(kind, f, lk);
    const values = months.map(() => 0);
    const index = new Map(months.map((m, i) => [m, i]));
    let total = 0;
    for (const r of s.cur) {
      if (!test(r)) continue;
      total += r.sum;
      const i = index.get(r.period);
      if (i !== undefined) values[i]! += r.sum;
    }
    return { key, label, kind, f, values, total };
  }

  /** Eng katta yozuvlar */
  private async top(kind: Kind, s: Span, lk: Lookups, take = 15) {
    const rows = await this.model(kind).findMany({
      where: { deletedAt: null, date: { gte: s.start, lt: s.end } },
      orderBy: [{ amountTiyin: 'desc' }],
      take,
    });
    return rows.map((r) => this.record(kind, r, lk));
  }

  private record(kind: Kind, r: Record<string, unknown>, lk: Lookups) {
    const place = { categoryCode: String(r.categoryCode ?? ''), regionCode: (r.regionCode as number | null) ?? null, departmentId: (r.departmentId as string | null) ?? null, segment: (r.segment as string | null) ?? null };
    if (kind === 'income') ownQomitaIncome([place], lk.qomita, lk.qomitaPool);
    const { unit, routed } = kind === 'expense' ? expenseUnit(lk.routing, place) : { unit: unitKey(place.regionCode, place.departmentId, place.segment), routed: false };
    const amount = num(r.amountTiyin);
    const status = String(r.paymentStatus ?? 'PAID');
    return {
      id: String(r.id),
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      period: String(r.period ?? ''),
      amount,
      open: status === 'PAID' ? 0 : kind === 'income' ? Math.max(0, amount - num(r.paidTiyin)) : amount,
      status,
      category: this.catLabel(kind, String(r.categoryCode), lk),
      categoryCode: String(r.categoryCode),
      unit,
      unitLabel: this.unitLabel(unit, lk),
      /** Siyosat bo'yicha o'tkazilgan bo'lsa — yozilgan joyi */
      placeLabel: routed ? this.unitLabel(unitKey(place.regionCode, place.departmentId, place.segment), lk) : null,
      department: r.departmentId ? this.depLabel(String(r.departmentId), lk) : null,
      party: ((kind === 'income' ? r.clientName : r.counterparty) as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      quantity: kind === 'income' ? ((r.quantity as number | null) ?? null) : null,
      documentNo: kind === 'expense' ? ((r.documentNo as string | null) ?? null) : ((r.contractNo as string | null) ?? null),
    };
  }

  private totals(s: Sets): Vals & { open: number } {
    return this.vals(s, () => true);
  }

  private static header(r: Ranges) {
    return {
      cur: { from: r.cur.from, to: r.cur.to },
      prev: { from: r.prev.from, to: r.prev.to },
      ly: { from: r.ly.from, to: r.ly.to },
      monthList: r.months,
    };
  }

  /** Mijozlar / kontragentlar: eng kattalari + «Boshqalar» */
  private parties(kind: Kind, s: Sets, lk: Lookups): { rows: Node[]; others: Vals & { parties: number }; total: number } {
    const all = ExploreService.tidy(
      ExploreService.distinct(s, (r) => r.party).map((p) => this.node(kind, s, lk, `p:${p}`, p || 'Ko‘rsatilmagan', { party: p })),
    );
    const named = all.filter((n) => n.f.party !== NO_PARTY);
    const blank = all.find((n) => n.f.party === NO_PARTY);
    const rows = named.slice(0, TOP_PARTIES);
    const rest = named.slice(TOP_PARTIES);
    const others = rest.reduce((a, n) => ({ cur: a.cur + n.cur, prev: a.prev + n.prev, ly: a.ly + n.ly, count: a.count + n.count, parties: a.parties + 1 }), { cur: 0, prev: 0, ly: 0, count: 0, parties: 0 });
    return { rows: blank ? [...rows, blank] : rows, others, total: named.length };
  }

  // ───────────────────────── Daromad ─────────────────────────

  /**
   * Birliklar daraxti (tartib: Markaz, Hududlar, yo'nalishlar, Biriktirilmagan):
   *  byPart = false — Hududlar → viloyatlar → qismlar (xizmatlar / moddalar);
   *  byPart = true  — Hududlar → qismlar → viloyatlar. center — Markaz uchun o'z tuguni (bo'lmasa — qismlari bilan).
   */
  private unitTree(K: Kind, s: Sets, lk: Lookups, units: string[], parts: (base: Filter, kids?: (code: string) => Node[]) => Node[], byPart: boolean, center?: Node): Node[] {
    const regionUnits = units.filter((u) => u.startsWith('r:'));
    const viloyatlar = (base: Filter) => ExploreService.tidy(regionUnits.map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { ...base, unit: u })));
    const tree = ExploreService.tidy([
      center ?? this.node(K, s, lk, 'center', 'Markaz', { unit: 'center' }, parts({ unit: 'center' })),
      this.node(
        K, s, lk, 'regions', 'Hududlar', { unit: 'regions' },
        byPart
          ? parts({ unit: 'regions' }, (code) => viloyatlar({ cats: [code] }))
          : ExploreService.tidy(regionUnits.map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { unit: u }, parts({ unit: u })))),
      ),
      // Yo'nalishlar — har biri alohida: qismlari bilan
      ...this.segmentsOf(s).map((k) => this.node(K, s, lk, k, this.unitLabel(k, lk), { unit: k }, parts({ unit: k }))),
      this.node(K, s, lk, 'none', 'Biriktirilmagan', { unit: 'none' }, parts({ unit: 'none' })),
    ]);
    const ORDER = ['center', 'regions', ...SEGMENT_KEYS, 'none'];
    return tree.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  }

  async income(from?: string, to?: string) {
    const r = ranges(from, to);
    const lk = await this.lookups();
    const [s, ps] = await Promise.all([this.sets('income', r, null), this.sets('income', r, null, true)]);
    const K: Kind = 'income';
    const cats = ExploreService.distinct(s, (x) => x.cat);
    const units = this.unitsOf(s);
    const regionUnits = units.filter((u) => u.startsWith('r:'));
    const deps = ExploreService.distinct(s, (x) => x.dep);
    const catNode = (code: string, base: Filter, children?: (c: string) => Node[]) =>
      this.node(K, s, lk, `c:${code}`, this.catLabel(K, code, lk), { ...base, cats: [code] }, children?.(code));

    // 1) Asosiy daraxt: Markaz → xizmatlar → bo'limlar; Hududlar → viloyatlar → xizmatlar (treeByPart: xizmatlar → viloyatlar);
    //    keyin yo'nalishlar va Biriktirilmagan — xizmatlari bilan
    const centerNode = this.node(K, s, lk, 'center', 'Markaz', { unit: 'center' }, ExploreService.tidy(cats.map((c) => catNode(c, { unit: 'center' }, (code) => ExploreService.tidy(deps.map((d) => this.node(K, s, lk, `d:${d}`, this.depLabel(d, lk), { unit: 'center', cats: [code], dep: d })))))));
    const incomeParts = (base: Filter, kids?: (code: string) => Node[]) => ExploreService.tidy(cats.map((c) => catNode(c, base, kids)));
    const tree = this.unitTree(K, s, lk, units, incomeParts, false, centerNode);
    const treeByPart = this.unitTree(K, s, lk, units, incomeParts, true, centerNode);
    void regionUnits;

    // 2) Moddalar → birliklar (Markaz va har bir hudud)
    const categories = ExploreService.tidy(cats.map((c) => catNode(c, {}, (code) => ExploreService.tidy(units.map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { unit: u, cats: [code] }))))));
    // 3) Hududlar (Markaz ham) → moddalar
    const regions = units
      .map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { unit: u }, ExploreService.tidy(cats.map((c) => catNode(c, { unit: u })))))
      .filter(ExploreService.nonEmpty);
    // 4) Bo'limlar → moddalar
    const departments = ExploreService.tidy(deps.map((d) => this.node(K, s, lk, `d:${d}`, this.depLabel(d, lk), { dep: d }, ExploreService.tidy(cats.map((c) => catNode(c, { dep: d }))))));
    // 5) Oylar × moddalar
    const months = {
      rows: categories.map((c) => this.matrix(K, s, lk, r.months, c.key, c.label, c.f)),
      total: this.matrix(K, s, lk, r.months, 'total', 'Jami', {}),
      units: [
        this.matrix(K, s, lk, r.months, 'center', 'Markaz', { unit: 'center' }),
        this.matrix(K, s, lk, r.months, 'regions', 'Hududlar', { unit: 'regions' }),
        ...this.segmentsOf(s).map((k) => this.matrix(K, s, lk, r.months, k, this.unitLabel(k, lk), { unit: k })),
      ],
    };
    const t = this.totals(s);
    const qty = await this.model(K).aggregate({ where: { deletedAt: null, date: { gte: r.cur.start, lt: r.cur.end } }, _sum: { quantity: true }, _count: { _all: true } });
    return {
      ...ExploreService.header(r),
      totals: {
        ...t,
        received: t.cur - t.open,
        quantity: num(qty._sum.quantity),
        center: this.vals(s, this.matcher(K, { unit: 'center' }, lk)),
        regions: this.vals(s, this.matcher(K, { unit: 'regions' }, lk)),
        segments: this.vals(s, this.matcher(K, { unit: 'segments' }, lk)),
        none: this.vals(s, this.matcher(K, { unit: 'none' }, lk)),
        bySegment: this.bySegment(K, s, lk),
      },
      tree,
      treeByPart,
      categories,
      regions,
      departments,
      months,
      clients: this.parties(K, ps, lk),
      top: await this.top(K, r.cur, lk),
    };
  }

  // ───────────────────────── Xarajat ─────────────────────────

  /** Moddalar daraxti: ildiz → ichki moddalar → (eng pastki) birliklar */
  private expenseTree(s: Sets, lk: Lookups, base: Filter, units: string[], leafUnits: boolean): Node[] {
    const K: Kind = 'expense';
    const used = new Set(ExploreService.distinct(s, (x) => x.cat));
    // Ishlatilgan moddalar va ularning ota-onalari
    const present = new Set<string>();
    for (const c of used) {
      let cur: string | null = c;
      let guard = 0;
      while (cur && !present.has(cur) && guard++ < 20) {
        present.add(cur);
        cur = lk.expenseCats.get(cur)?.parent ?? null;
      }
    }
    const kids = new Map<string | null, string[]>();
    for (const c of present) {
      const parent = lk.expenseCats.get(c)?.parent ?? null;
      const p = parent && present.has(parent) ? parent : null;
      kids.set(p, [...(kids.get(p) ?? []), c]);
    }
    const build = (code: string): Node => {
      const children = (kids.get(code) ?? []).map(build);
      // Ota modda o'ziga ham yozilgan bo'lsa — alohida qator (ichki moddalarisiz)
      if (children.length) {
        const own = this.node(K, s, lk, `o:${code}`, `${this.catLabel(K, code, lk)} — umumiy (ichki moddasiz)`, { ...base, cats: [code], exact: true });
        if (ExploreService.nonEmpty(own)) children.push(own);
      }
      const unitKids = !children.length && leafUnits ? ExploreService.tidy(units.map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { ...base, cats: [code], unit: u }))) : [];
      const n = this.node(K, s, lk, `c:${code}`, this.catLabel(K, code, lk), { ...base, cats: [code] }, children.length ? ExploreService.tidy(children) : unitKids);
      const test = (u: string) => this.vals(s, this.matcher(K, { ...base, cats: [code], unit: u }, lk)).cur;
      n.x = { ...n.x, center: test('center'), regions: test('regions'), none: test('none'), ...Object.fromEntries(SEGMENT_KEYS.map((k) => [k, test(k)])), leaf: children.length ? 0 : 1 };
      return n;
    };
    return ExploreService.tidy((kids.get(null) ?? []).map(build));
  }

  async expense(from?: string, to?: string) {
    const r = ranges(from, to);
    const lk = await this.lookups();
    const [s, ps] = await Promise.all([this.sets('expense', r, lk.routing), this.sets('expense', r, lk.routing, true)]);
    const K: Kind = 'expense';
    const units = this.unitsOf(s);
    const deps = ExploreService.distinct(s, (x) => x.dep);
    const tree = this.expenseTree(s, lk, {}, units, true);
    const roots = tree.map((n) => ({ code: n.f.cats![0]!, label: n.label }));
    const rootNodes = (base: Filter) => ExploreService.tidy(roots.map((c) => this.node(K, s, lk, `c:${c.code}`, c.label, { ...base, cats: [c.code] })));
    // Birliklar bo'yicha: Markaz → moddalar; Hududlar → viloyatlar → moddalar (unitTreeByPart: moddalar → viloyatlar); yo'nalishlar
    const expenseParts = (base: Filter, kids?: (code: string) => Node[]) => ExploreService.tidy(roots.map((c) => this.node(K, s, lk, `c:${c.code}`, c.label, { ...base, cats: [c.code] }, kids?.(c.code))));
    const unitTree = this.unitTree(K, s, lk, units, expenseParts, false);
    const unitTreeByPart = this.unitTree(K, s, lk, units, expenseParts, true);

    const regions = units.map((u) => this.node(K, s, lk, u, this.unitLabel(u, lk), { unit: u }, rootNodes({ unit: u }))).filter(ExploreService.nonEmpty);
    const departments = ExploreService.tidy(deps.map((d) => this.node(K, s, lk, `d:${d}`, this.depLabel(d, lk), { dep: d }, rootNodes({ dep: d }))));
    const months = {
      rows: tree.map((n) => ({
        ...this.matrix(K, s, lk, r.months, n.key, n.label, n.f),
        children: (n.children ?? []).filter((c) => c.f.cats && !c.f.unit).map((c) => this.matrix(K, s, lk, r.months, c.key, c.label, c.f)),
      })),
      total: this.matrix(K, s, lk, r.months, 'total', 'Jami', {}),
      units: [
        this.matrix(K, s, lk, r.months, 'center', 'Markaz', { unit: 'center' }),
        this.matrix(K, s, lk, r.months, 'regions', 'Hududlar', { unit: 'regions' }),
        ...this.segmentsOf(s).map((k) => this.matrix(K, s, lk, r.months, k, this.unitLabel(k, lk), { unit: k })),
      ],
    };
    const t = this.totals(s);
    const unpaid = this.vals(s, (x) => x.status !== 'PAID');
    return {
      ...ExploreService.header(r),
      totals: {
        ...t,
        paid: t.cur - t.open,
        unpaidCount: unpaid.count,
        center: this.vals(s, this.matcher(K, { unit: 'center' }, lk)),
        regions: this.vals(s, this.matcher(K, { unit: 'regions' }, lk)),
        segments: this.vals(s, this.matcher(K, { unit: 'segments' }, lk)),
        none: this.vals(s, this.matcher(K, { unit: 'none' }, lk)),
        bySegment: this.bySegment(K, s, lk),
        /** Xarajatlar siyosati bo'yicha yozilgan joyidan boshqa birlikka o'tkazilgani */
        policy: this.vals(s, (x) => x.routed),
      },
      tree,
      unitTree,
      unitTreeByPart,
      regions,
      departments,
      months,
      counterparties: this.parties(K, ps, lk),
      top: await this.top(K, r.cur, lk),
    };
  }

  // ───────────────────────── Tahlil: natija ─────────────────────────

  async result(from?: string, to?: string) {
    const r = ranges(from, to);
    const lk = await this.lookups();
    const [inc, exp] = await Promise.all([this.sets('income', r, null), this.sets('expense', r, lk.routing)]);
    const units = [...new Set([...this.unitsOf(inc), ...this.unitsOf(exp)])].sort((a, b) => {
      const w = (u: string) => (u === 'center' ? -1 : u === 'none' ? 1e9 : u.startsWith('s:') ? 1e6 + SEGMENT_KEYS.indexOf(u) : Number(u.slice(2)));
      return w(a) - w(b);
    });

    // P&L: oylar kesimida
    const incCats = ExploreService.tidy(ExploreService.distinct(inc, (x) => x.cat).map((c) => this.node('income', inc, lk, `c:${c}`, this.catLabel('income', c, lk), { cats: [c] })));
    const expRoots = this.expenseTree(exp, lk, {}, [], false);
    const row = (kind: Kind, s: Sets, key: string, label: string, f: Filter) => {
      const m = this.matrix(kind, s, lk, r.months, key, label, f);
      const v = this.vals(s, this.matcher(kind, f, lk));
      return { ...m, prev: v.prev, ly: v.ly, count: v.count };
    };
    const income = {
      ...row('income', inc, 'income', 'Daromad', {}),
      children: [
        { ...row('income', inc, 'inc:center', 'Markaz', { unit: 'center' }), children: incCats.map((c) => row('income', inc, `c:${c.f.cats![0]}`, c.label, { unit: 'center', cats: c.f.cats })).filter((x) => x.total || x.prev || x.ly) },
        { ...row('income', inc, 'inc:regions', 'Hududlar', { unit: 'regions' }), children: incCats.map((c) => row('income', inc, `c:${c.f.cats![0]}`, c.label, { unit: 'regions', cats: c.f.cats })).filter((x) => x.total || x.prev || x.ly) },
        ...this.segmentsOf(inc).map((k) => ({
          ...row('income', inc, `inc:${k}`, this.unitLabel(k, lk), { unit: k }),
          children: incCats.map((c) => row('income', inc, `c:${c.f.cats![0]}`, c.label, { unit: k, cats: c.f.cats })).filter((x) => x.total || x.prev || x.ly),
        })),
        ...(this.vals(inc, (x) => x.unit === 'none').count ? [row('income', inc, 'inc:none', 'Biriktirilmagan', { unit: 'none' })] : []),
      ],
    };
    const expense = {
      ...row('expense', exp, 'expense', 'Xarajat', {}),
      children: expRoots.map((n) => ({
        ...row('expense', exp, n.key, n.label, n.f),
        children: (n.children ?? []).map((c) => row('expense', exp, c.key, c.label, c.f)),
      })),
    };
    const sub = (a: number[], b: number[]) => a.map((v, i) => v - (b[i] ?? 0));
    const result = {
      key: 'result',
      label: 'Natija (foyda / zarar)',
      values: sub(income.values, expense.values),
      total: income.total - expense.total,
      prev: income.prev - expense.prev,
      ly: income.ly - expense.ly,
    };
    const margin = (res: number, i: number) => (i ? res / i : null);

    // Birliklar: Markaz va hududlar
    const unitRows = units.map((u) => {
      const i = this.vals(inc, (x) => x.unit === u);
      const e = this.vals(exp, (x) => x.unit === u);
      return {
        key: u,
        label: this.unitLabel(u, lk),
        income: i,
        expense: e,
        result: { cur: i.cur - e.cur, prev: i.prev - e.prev, ly: i.ly - e.ly },
        margin: margin(i.cur - e.cur, i.cur),
        marginPrev: margin(i.prev - e.prev, i.prev),
        incomeTop: ExploreService.tidy(ExploreService.distinct(inc, (x) => x.cat).map((c) => this.node('income', inc, lk, `c:${c}`, this.catLabel('income', c, lk), { unit: u, cats: [c] }))).slice(0, 8),
        expenseTop: ExploreService.tidy(expRoots.map((n) => this.node('expense', exp, lk, n.key, n.label, { unit: u, cats: n.f.cats }))).slice(0, 8),
      };
    });
    const ti = this.totals(inc);
    const te = this.totals(exp);
    return {
      ...ExploreService.header(r),
      totals: {
        income: ti,
        expense: te,
        result: { cur: ti.cur - te.cur, prev: ti.prev - te.prev, ly: ti.ly - te.ly },
        margin: margin(ti.cur - te.cur, ti.cur),
        marginPrev: margin(ti.prev - te.prev, ti.prev),
        marginLy: margin(ti.ly - te.ly, ti.ly),
        receivable: ti.open,
        payable: te.open,
      },
      pnl: { income, expense, result, margin: { values: income.values.map((v, i) => margin(result.values[i]!, v)), total: margin(result.total, income.total), prev: margin(result.prev, income.prev), ly: margin(result.ly, income.ly) } },
      units: unitRows,
    };
  }

  // ───────────────────────── Yozuvlar ─────────────────────────

  /** Filtr → Prisma sharti (matcher bilan aynan bir xil mantiq) */
  private async where(kind: Kind, span: Span, f: Filter) {
    const and: Record<string, unknown>[] = [{ deletedAt: null }, { date: { gte: span.start, lt: span.end } }];
    const lk = kind === 'expense' ? await this.lookups() : null;
    if (f.cats?.length) {
      let codes = f.cats;
      if (lk && !f.exact) {
        const desc = this.descendants(lk);
        codes = [...new Set(f.cats.flatMap((c) => [...desc(c)]))];
      }
      and.push({ categoryCode: { in: codes } });
    }
    // Yo'nalish yozuvi (segment) — o'sha bo'limniki; Markaz / hudud / biriktirilmagan — yo'nalishsiz yozuvlar
    const noSegment = { OR: [{ segment: null }, { segment: { notIn: SEGMENTS.map((x) => x.code) } }] };
    const own: Record<string, unknown>[] = [];
    if (f.unit === 'center') own.push(noSegment, { OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }] });
    else if (f.unit === 'regions') own.push(noSegment, { regionCode: { gt: 0 } });
    else if (f.unit === 'none') own.push(noSegment, { regionCode: null, departmentId: null });
    else if (f.unit === 'segments') own.push({ segment: { in: SEGMENTS.map((x) => x.code) } });
    else if (f.unit?.startsWith('s:')) own.push({ segment: f.unit.slice(2) });
    else if (f.unit?.startsWith('r:')) own.push(noSegment, { regionCode: Number(f.unit.slice(2)) });
    // Xarajatlar siyosati: shu birlikdan boshqa birlikka o'tganlar chiqariladi, boshqa birlikdan shu birlikka o'tganlar qo'shiladi
    // (modda × joy guruhlari bo'yicha — jadvaldagi summa bilan aynan bir xil)
    // Daromad: «Qo'mita» yo'nalishidagi ajratma — egasi bo'limniki (Call markaz → Markaz › bo'limi, Marksheyder → yo'nalish)
    if (kind === 'income' && f.unit) {
      const owners = await qomitaIncomeOwners(this.prisma);
      const pool = (await this.qomitaCoverage())?.poolCodes ?? new Set<string>();
      const codesOf = (pred: (o: QomitaOwner) => boolean) => [...owners].filter(([c, o]) => !pool.has(c) && pred(o)).map(([c]) => c);
      const owned = (codes: string[]) => (codes.length ? [{ segment: QOMITA_SEGMENT, categoryCode: { in: codes } }] : []);
      const all = codesOf(() => true);
      if (f.unit === 'center') {
        const extra = owned(codesOf((o) => !o.segment));
        if (extra.length) own.splice(0, own.length, { OR: [{ AND: [...own] }, ...extra] });
      } else if (f.unit.startsWith('s:')) {
        const seg = f.unit.slice(2);
        const extra = owned(codesOf((o) => o.segment === seg));
        if (seg === QOMITA_SEGMENT && all.length) own.push({ NOT: { categoryCode: { in: all } } });
        else if (extra.length) own.splice(0, own.length, { OR: [{ AND: [...own] }, ...extra] });
      } else if (f.unit === 'segments') {
        const centerCodes = codesOf((o) => !o.segment);
        if (centerCodes.length) own.push({ NOT: { segment: QOMITA_SEGMENT, categoryCode: { in: centerCodes } } });
      }
    }
    const moved = f.unit && lk?.routing ? await this.movedPlaces(and, f.unit, lk.routing) : { out: [], in: [] };
    if (moved.out.length || moved.in.length) {
      and.push({ OR: [{ AND: [...own, ...(moved.out.length ? [{ NOT: { OR: moved.out } }] : [])] }, ...(moved.in.length ? [{ OR: moved.in }] : [])] });
    } else and.push(...own);
    if (f.dep) {
      // Markaz bo'limi: Qo'mita shu bo'limga bergan ajratma ham (yozuvda bo'lim yo'q — modda bo'limga bog'langan)
      const pool = kind === 'income' ? ((await this.qomitaCoverage())?.poolCodes ?? new Set<string>()) : new Set<string>();
      const qcodes = kind === 'income' && f.dep !== 'none' ? [...(await qomitaIncomeOwners(this.prisma))].filter(([c, o]) => !pool.has(c) && o.departmentId === f.dep && !o.segment).map(([c]) => c) : [];
      and.push(qcodes.length ? { OR: [{ departmentId: f.dep }, { segment: QOMITA_SEGMENT, categoryCode: { in: qcodes } }] } : { departmentId: f.dep === 'none' ? null : f.dep });
    }
    if (f.month) and.push({ period: f.month });
    if (f.party !== undefined) {
      const field = kind === 'income' ? 'clientName' : 'counterparty';
      and.push(f.party === NO_PARTY ? { OR: [{ [field]: null }, { [field]: '' }] } : { [field]: f.party });
    }
    if (f.unpaid) and.push({ paymentStatus: { not: 'PAID' } });
    return { AND: and };
  }

  /** Siyosat bo'yicha birlikdan chiqqan (out) va birlikka kirgan (in) modda × joy guruhlari */
  private async movedPlaces(base: Record<string, unknown>[], unit: string, routing: PolicyRouting) {
    const groups = await this.prisma.expense.groupBy({ by: ['categoryCode', 'regionCode', 'departmentId', 'segment'], where: { AND: base } });
    const out: Record<string, unknown>[] = [];
    const into: Record<string, unknown>[] = [];
    for (const g of groups) {
      const { unit: key, routed } = expenseUnit(routing, g);
      if (!routed) continue;
      const place = { categoryCode: g.categoryCode, regionCode: g.regionCode, departmentId: g.departmentId, segment: g.segment };
      const own = unitKey(g.regionCode, g.departmentId, g.segment);
      if (unitMatches(unit, own) && !unitMatches(unit, key)) out.push(place);
      else if (!unitMatches(unit, own) && unitMatches(unit, key)) into.push(place);
    }
    return { out, in: into };
  }

  static parseFilter(q: Record<string, string | undefined>): Filter {
    const f: Filter = {};
    if (q.cats) f.cats = q.cats.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500);
    if (q.unit) {
      if (!/^(center|regions|segments|none|r:\d{1,4})$/.test(q.unit) && !SEGMENT_KEYS.includes(q.unit)) throw new BadRequestException("Birlik noto'g'ri");
      f.unit = q.unit;
    }
    if (q.dep) f.dep = q.dep;
    if (q.month) {
      if (!/^\d{4}-\d{2}$/.test(q.month)) throw new BadRequestException("Oy noto'g'ri");
      f.month = q.month;
    }
    if (q.party !== undefined) f.party = q.party.trim();
    if (q.unpaid === '1' || q.unpaid === 'true') f.unpaid = true;
    if (q.exact === '1' || q.exact === 'true') f.exact = true;
    return f;
  }

  async records(kindRaw: string, from: string | undefined, to: string | undefined, f: Filter, pageRaw?: string, sortRaw?: string, which?: string) {
    if (kindRaw !== 'income' && kindRaw !== 'expense') throw new BadRequestException("Tur noto'g'ri");
    const kind: Kind = kindRaw;
    const r = ranges(from, to);
    const span = which === 'prev' ? r.prev : which === 'ly' ? r.ly : r.cur;
    const where = await this.where(kind, span, f);
    const page = Math.max(1, Math.min(10000, Number(pageRaw) || 1));
    const orderBy = sortRaw === 'date' ? [{ date: 'desc' }, { amountTiyin: 'desc' }] : sortRaw === 'date-asc' ? [{ date: 'asc' }] : [{ amountTiyin: 'desc' }, { date: 'desc' }];
    const [lk, rows, agg] = await Promise.all([
      this.lookups(),
      this.model(kind).findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      this.model(kind).aggregate({ where, _sum: kind === 'income' ? { amountTiyin: true, paidTiyin: true, quantity: true } : { amountTiyin: true }, _count: { _all: true } }),
    ]);
    const count = agg._count._all;
    return {
      span: { from: span.from, to: span.to },
      page,
      pages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
      count,
      total: num(agg._sum.amountTiyin),
      quantity: kind === 'income' ? num(agg._sum.quantity) : null,
      rows: rows.map((x) => this.record(kind, x, lk)),
    };
  }
}