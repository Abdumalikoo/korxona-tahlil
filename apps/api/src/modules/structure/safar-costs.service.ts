import { BadRequestException, Injectable } from '@nestjs/common';
import { isSegment, segmentKey, segmentOfKey } from '../../common/segments/segments';
import { safarExpenseMeta } from '../acc-23106/acc23106.safar-ids';
import { policyRouting, readPolicy } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { bounds, compareRange, parseDay } from './structure.engine';
import type { CompareMode, DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichma-ich: «Xizmat safari» moddasi ichi — kimga (xodim) qancha, oyma-oy (o'tgan davr bilan).
// Manba: 23106 dan xarajatga o'tkazilgan xizmat safari yozuvlari. Xarajatlar siyosati hisobga olinadi:
//  • unit=center          — Markazning o'z xizmat safari (Markazda yozilgan, boshqa hisobga o'tmagan);
//  • unit=center:regional — Markaz hududlar uchun to'lagani (siyosat: «Markaz hisobidan»);
//  • dep:ID / cnd         — Markaz bo'limi / bo'limga biriktirilmagan;
//  • r:KOD / dist:ID / rnd:KOD — hudud / tuman / tumanga bo'linmagan (hudud o'zi to'lagani);
//  • s:KOD (yoki KOD)     — yo'nalish (o'zida yozilgan yoki siyosat bo'yicha uning hisobiga).
// ═══════════════════════════════════════════════════════════

const MAX_DAYS = 3 * 366;

export interface SafarCostItem {
  key: string;
  fullName: string;
  pinfl: string | null;
  /** Xodim ishlagan joy (to'langan oyda) */
  placeLabel: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  /** Joriy davr oylari: YYYY-MM → tiyin */
  months: Record<string, string>;
}

const monthOf = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 7);

@Injectable()
export class SafarCostsService {
  constructor(private readonly prisma: PrismaService) {}

  async costs(query: { unit?: string; from?: string; to?: string; compare?: string; section?: string }) {
    const unit = String(query.unit ?? 'all');
    const range: DateRange = { from: String(query.from ?? ''), to: String(query.to ?? '') };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b || (b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException("Davr noto'g'ri");
    const compare: CompareMode = query.compare === 'yoy' ? 'yoy' : 'prev';
    const section: SectionFilter = query.section === 'DOIMIY' || query.section === 'BOSHQA' ? query.section : 'ALL';
    const previous = compareRange(range, compare);
    const cur = bounds(range);
    const prev = bounds(previous);

    const meta = await safarExpenseMeta(this.prisma);
    const empty = { unit, range, previousRange: previous, totalTiyin: '0', previousTotalTiyin: '0', items: [] as SafarCostItem[] };
    if (!meta.size) return empty;
    const [expenses, cats, policy] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          id: { in: [...meta.keys()] },
          deletedAt: null,
          date: { gte: new Date(Math.min(cur.start.getTime(), prev.start.getTime())), lt: new Date(Math.max(cur.end.getTime(), prev.end.getTime())) },
          ...(section !== 'ALL' ? { section } : {}),
        },
        select: { id: true, date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, districtId: true, segment: true },
      }),
      this.prisma.category.findMany({ select: { code: true, parentCode: true } }),
      readPolicy(this.prisma),
    ]);
    const routing = policyRouting(policy, cats);
    const match = this.matcher(unit, routing.depOf);

    const acc = new Map<string, { item: SafarCostItem; cur: bigint; prev: bigint; months: Map<string, bigint> }>();
    let total = 0n;
    let prevTotal = 0n;
    for (const e of expenses) {
      const c = e.date >= cur.start && e.date < cur.end;
      const p = e.date >= prev.start && e.date < prev.end;
      if (!c && !p) continue;
      if (!match(e, routing.route(e))) continue;
      const m = meta.get(e.id)!;
      const k = m.pinfl ?? m.fullName;
      let x = acc.get(k);
      if (!x) {
        x = { item: { key: k, fullName: m.fullName, pinfl: m.pinfl, placeLabel: m.placeLabel, amountTiyin: '0', previousTiyin: '0', count: 0, months: {} }, cur: 0n, prev: 0n, months: new Map() };
        acc.set(k, x);
      }
      if (c) {
        x.cur += e.amountTiyin;
        x.item.count += 1;
        total += e.amountTiyin;
        const mo = monthOf(e.date);
        x.months.set(mo, (x.months.get(mo) ?? 0n) + e.amountTiyin);
      }
      if (p) {
        x.prev += e.amountTiyin;
        prevTotal += e.amountTiyin;
      }
    }
    const items = [...acc.values()]
      .map((x) => ({ ...x.item, amountTiyin: x.cur.toString(), previousTiyin: x.prev.toString(), months: Object.fromEntries([...x.months.entries()].sort().map(([k, v]) => [k, v.toString()])) }))
      .sort((l, r) => Number(BigInt(r.amountTiyin) - BigInt(l.amountTiyin)) || l.fullName.localeCompare(r.fullName));
    return { ...empty, totalTiyin: total.toString(), previousTotalTiyin: prevTotal.toString(), items };
  }

  /** Birlik kaliti → yozuv shu birlik xarajatiga kiradimi (siyosat bilan) */
  private matcher(unit: string, depOf: (row: { categoryCode: string | null; departmentId: string | null }) => string | null) {
    type Row = { categoryCode: string; regionCode: number | null; departmentId: string | null; districtId: string | null; segment: string | null };
    type Routed = { key: string; origin: string } | null;
    const centerWritten = (e: Row) => !e.segment && (e.regionCode === 0 || (e.regionCode === null && e.departmentId !== null));
    const centerOwn = (e: Row, r: Routed) => (!r && centerWritten(e)) || (r?.key === 'center' && r.origin !== 'global');
    if (unit === 'all') return () => true;
    if (unit === 'center') return centerOwn;
    if (unit === 'center:regional') return (_e: Row, r: Routed) => r?.key === 'center' && r.origin === 'global';
    // Markaz bo'limi — bo'limlar siyosati bilan (modda boshqa bo'lim hisobiga o'tgan bo'lishi mumkin)
    if (unit.startsWith('dep:')) return (e: Row, r: Routed) => centerOwn(e, r) && depOf(e) === unit.slice(4);
    if (unit === 'cnd') return (e: Row, r: Routed) => centerOwn(e, r) && !depOf(e);
    if (unit.startsWith('dist:')) return (e: Row, r: Routed) => !r && !e.segment && e.districtId === unit.slice(5);
    if (unit.startsWith('rnd:')) {
      const code = Number(unit.slice(4));
      return (e: Row, r: Routed) => !r && !e.segment && e.regionCode === code && !e.districtId;
    }
    if (unit.startsWith('r:')) {
      const code = Number(unit.slice(2));
      if (!Number.isInteger(code) || code <= 0) throw new BadRequestException("Hudud noto'g'ri");
      return (e: Row, r: Routed) => (r ? r.key === unit : !e.segment && e.regionCode === code);
    }
    const seg = segmentOfKey(unit) ?? (isSegment(unit) ? unit : null);
    if (seg) {
      const key = segmentKey(seg);
      return (e: Row, r: Routed) => (r ? r.key === key : e.segment === seg);
    }
    throw new BadRequestException("Birlik noto'g'ri");
  }
}
