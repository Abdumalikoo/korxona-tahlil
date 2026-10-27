import { BadRequestException, Injectable } from '@nestjs/common';
import { isSegment, segmentKey, segmentOfKey } from '../../common/segments/segments';
import { safarExpenseMeta } from '../acc-23106/acc23106.safar-ids';
import { ASSET_CHARGE_CATEGORY, ASSET_GROUP_CODES, policyRouting, readPolicy } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { bounds, compareRange, parseDay } from './structure.engine';
import type { CompareMode, DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichma-ich: xarajat moddasi (qism) ichi — keyingi daraja:
//   c:<GURUH>   — ichki moddalar (bitta bo'lsa — darhol kontragentlar);
//   cat:<MODDA> — kontragentlar (kimga to'langan), har birida yozuvlar soni va oxirgi izoh;
//   h:<MODDA>   — siyosat bo'yicha boshqa joydan kelgan: qayerda yozilgani (hudud / bo'lim / yo'nalish);
//   LEASE, ASSET, ASSET_X, <MODDA> (Markaz «hududlar uchun») — kontragentlar.
// Birlik va siyosat — Solishtirma bilan bir xil (unit: center | center:regional | dep:ID | cnd | r:KOD | dist:ID |
// rnd:KOD | s:KOD). Mashina va xizmat safari — o'z endpointlarida.
// ═══════════════════════════════════════════════════════════

const MAX_DAYS = 3 * 366;
const TOP_PARTIES = 40;
const NO_PARTY = 'Kontragent ko‘rsatilmagan';

export interface PartDetailItem {
  /** Keyingi daraja kaliti (ochiladi) yoki null */
  key: string | null;
  label: string;
  sub: string | null;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
}

type Row = { id: string; date: Date; amountTiyin: bigint; categoryCode: string; regionCode: number | null; departmentId: string | null; districtId: string | null; segment: string | null; source: string; counterparty: string | null; description: string | null };
type Routed = { key: string; origin: 'unit' | 'global' } | null;

@Injectable()
export class PartDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(query: { unit?: string; key?: string; from?: string; to?: string; compare?: string; section?: string }) {
    const unit = String(query.unit ?? '');
    const key = String(query.key ?? '');
    const range: DateRange = { from: String(query.from ?? ''), to: String(query.to ?? '') };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b || (b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException("Davr noto'g'ri");
    if (!key || key.length > 80) throw new BadRequestException("Qism noto'g'ri");
    const compare: CompareMode = query.compare === 'yoy' ? 'yoy' : 'prev';
    const section: SectionFilter = query.section === 'DOIMIY' || query.section === 'BOSHQA' ? query.section : 'ALL';
    const previous = compareRange(range, compare);
    const cur = bounds(range);
    const prev = bounds(previous);

    const [cats, policy, safar, regions, deps, districts] = await Promise.all([
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      readPolicy(this.prisma),
      safarExpenseMeta(this.prisma),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.district.findMany({ select: { id: true, name: true } }),
    ]);
    const routing = policyRouting(policy, cats);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
    const children = new Map<string, string[]>();
    for (const c of cats) if (c.parentCode) children.set(c.parentCode, [...(children.get(c.parentCode) ?? []), c.code]);
    const under = (code: string) => {
      const out = new Set<string>([code]);
      const stack = [code];
      while (stack.length) for (const ch of children.get(stack.pop()!) ?? []) if (!out.has(ch)) (out.add(ch), stack.push(ch));
      return out;
    };

    const inUnit = this.unitMatcher(unit, routing.depOf);
    const centerSide = unit.startsWith('center') || unit.startsWith('dep:') || unit === 'cnd';
    /** Oddiy modda qismi (c:/cat:) — ish haqi, ijara, mashina, safar, asosiy vositalar va siyosat qismlaridan tashqari */
    const plain = (r: Row, routed: Routed) =>
      r.source !== 'PAYROLL' && r.source !== 'LEASE' && r.source !== 'VEHICLE' && !safar.has(r.id) && !ASSET_GROUP_CODES.includes(r.categoryCode) && (centerSide ? routed?.origin !== 'global' : !routed);

    // Qism kaliti → yozuv filtri va keyingi daraja
    let pick: (r: Row, routed: Routed) => boolean;
    let level: 'cats' | 'party' | 'place';
    let groupCode: string | null = null;
    if (key.startsWith('c:')) {
      groupCode = key.slice(2);
      const set = under(groupCode);
      pick = (r, ro) => plain(r, ro) && set.has(r.categoryCode);
      level = (children.get(groupCode) ?? []).length ? 'cats' : 'party';
    } else if (key.startsWith('cat:')) {
      const set = under(key.slice(4));
      pick = (r, ro) => plain(r, ro) && set.has(r.categoryCode);
      level = (children.get(key.slice(4)) ?? []).length ? 'cats' : 'party';
      groupCode = key.slice(4);
    } else if (key.startsWith('h:')) {
      const code = key.slice(2);
      pick = (r, ro) => Boolean(ro) && r.categoryCode === code && !safar.has(r.id);
      level = 'place';
    } else if (key === 'LEASE') {
      pick = (r) => r.source === 'LEASE';
      level = 'party';
    } else if (key === 'ASSET') {
      pick = (r) => r.categoryCode === ASSET_CHARGE_CATEGORY.code;
      level = 'party';
    } else if (key === 'ASSET_X') {
      pick = (r) => ASSET_GROUP_CODES.includes(r.categoryCode) && r.categoryCode !== ASSET_CHARGE_CATEGORY.code;
      level = 'party';
    } else if (unit === 'center:regional' && label.has(key)) {
      // Markaz «hududlar uchun to'langan» — modda kodi o'zi
      pick = (r) => r.categoryCode === key && !safar.has(r.id);
      level = 'place';
    } else {
      throw new BadRequestException("Bu qism ichma-ich ochilmaydi");
    }

    const rows = (await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        date: { gte: new Date(Math.min(cur.start.getTime(), prev.start.getTime())), lt: new Date(Math.max(cur.end.getTime(), prev.end.getTime())) },
        ...(section !== 'ALL' ? { section } : {}),
      },
      select: { id: true, date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, districtId: true, segment: true, source: true, counterparty: true, description: true },
    })) as Row[];

    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const depName = new Map(deps.map((d) => [d.id, d.name]));
    const disName = new Map(districts.map((d) => [d.id, d.name]));
    const placeOf = (r: Row) =>
      r.segment
        ? r.segment
        : r.regionCode === 0 || (r.regionCode === null && r.departmentId)
          ? `Markaz${r.departmentId ? ` › ${depName.get(r.departmentId) ?? "bo'lim"}` : ''}`
          : r.regionCode
            ? `${regionName.get(r.regionCode) ?? `Hudud ${r.regionCode}`}${r.districtId ? ` › ${disName.get(r.districtId) ?? 'tuman'}` : ''}`
            : 'Joyi ko‘rsatilmagan';
    // Ichki modda — guruhning bevosita bolasi
    const childOf = (code: string): string => {
      let c: string | null = code;
      for (let d = 0; c && d < 20; d += 1) {
        const p: string | null = parent.get(c) ?? null;
        if (p === groupCode) return c;
        c = p;
      }
      return code;
    };

    const acc = new Map<string, { key: string | null; label: string; cur: bigint; prev: bigint; count: number; last: { date: Date; text: string | null } | null }>();
    let total = 0n;
    let prevTotal = 0n;
    for (const r of rows) {
      const c = r.date >= cur.start && r.date < cur.end;
      const p = r.date >= prev.start && r.date < prev.end;
      if (!c && !p) continue;
      const routed = routing.route(r);
      if (!inUnit(r, routed) || !pick(r, routed)) continue;
      let k: string;
      let lbl: string;
      let next: string | null = null;
      if (level === 'cats') {
        k = childOf(r.categoryCode);
        lbl = label.get(k) ?? k;
        next = `cat:${k}`;
      } else if (level === 'place') {
        k = placeOf(r);
        lbl = k;
      } else {
        k = (r.counterparty ?? '').trim() || NO_PARTY;
        lbl = k;
      }
      let x = acc.get(k);
      if (!x) acc.set(k, (x = { key: next, label: lbl, cur: 0n, prev: 0n, count: 0, last: null }));
      if (c) {
        x.cur += r.amountTiyin;
        x.count += 1;
        total += r.amountTiyin;
        if (!x.last || r.date > x.last.date) x.last = { date: r.date, text: r.description };
      }
      if (p) {
        x.prev += r.amountTiyin;
        prevTotal += r.amountTiyin;
      }
    }
    let list = [...acc.values()].sort((l, r) => (r.cur > l.cur ? 1 : r.cur < l.cur ? -1 : r.prev > l.prev ? 1 : -1));
    // Kontragentlar ko'p bo'lsa — eng kattalari, qolgani bitta qatorda
    if (level !== 'cats' && list.length > TOP_PARTIES + 1) {
      const rest = list.slice(TOP_PARTIES);
      list = [
        ...list.slice(0, TOP_PARTIES),
        { key: null, label: `Boshqalar (${rest.length} ta)`, cur: rest.reduce((s, x) => s + x.cur, 0n), prev: rest.reduce((s, x) => s + x.prev, 0n), count: rest.reduce((s, x) => s + x.count, 0), last: null },
      ];
    }
    const items: PartDetailItem[] = list.map((x) => ({
      key: x.key,
      label: x.label,
      sub: level === 'party' && x.last?.text ? x.last.text.slice(0, 160) : null,
      amountTiyin: x.cur.toString(),
      previousTiyin: x.prev.toString(),
      count: x.count,
    }));
    return { unit, key, level, range, previousRange: previous, totalTiyin: total.toString(), previousTotalTiyin: prevTotal.toString(), items };
  }

  /** Birlik → yozuv shu birlik xarajatiga kiradimi (Solishtirma va siyosat bilan bir xil) */
  private unitMatcher(unit: string, depOf: (row: { categoryCode: string | null; departmentId: string | null }) => string | null) {
    const centerWritten = (e: Row) => !e.segment && (e.regionCode === 0 || (e.regionCode === null && e.departmentId !== null));
    const centerOwn = (e: Row, r: Routed) => (!r && centerWritten(e)) || (r?.key === 'center' && r.origin !== 'global');
    if (unit === 'center') return centerOwn;
    if (unit === 'center:regional') return (_e: Row, r: Routed) => r?.key === 'center' && r.origin === 'global';
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
      const k = segmentKey(seg);
      return (e: Row, r: Routed) => (r ? r.key === k : e.segment === seg);
    }
    throw new BadRequestException("Birlik noto'g'ri");
  }
}
