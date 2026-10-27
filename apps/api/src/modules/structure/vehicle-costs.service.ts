import { BadRequestException, Injectable } from '@nestjs/common';
import { isSegment, segmentOfKey } from '../../common/segments/segments';
import { PrismaService } from '../prisma/prisma.service';
import { bounds, compareRange, parseDay } from './structure.engine';
import type { CompareMode, DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichma-ich: «Mashina xarajatlari» moddasi ichi — qaysi mashinaga qancha (o'tgan davr bilan),
// har mashina: turlari (yoqilg'i, ta'mirlash, moyka …) va bo'limga biriktirish izohi.
// Birlik — yozuv yozilgan joy bo'yicha (Markaz, Markaz bo'limi, hudud, tuman, yo'nalish).
// ═══════════════════════════════════════════════════════════

const KIND_LABELS: Record<string, string> = { FUEL: "Yoqilg'i", WASH: 'Moyka', REPAIR: "Ta'mirlash", SERVICE: 'Texnik xizmat', OTHER: 'Boshqa' };
const MAX_DAYS = 3 * 366;

export interface VehicleCostKind {
  kind: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export interface VehicleCostItem {
  vehicleId: string | null;
  plateNumber: string;
  model: string;
  driverName: string | null;
  comment: string | null;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  kinds: VehicleCostKind[];
}

export interface VehicleCosts {
  unit: string;
  range: DateRange;
  previousRange: DateRange;
  totalTiyin: string;
  previousTotalTiyin: string;
  items: VehicleCostItem[];
}

@Injectable()
export class VehicleCostsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Birlik kaliti → xarajat filtri */
  private unitWhere(unit: string): Record<string, unknown> {
    if (unit === 'all') return {};
    if (unit === 'center') return { segment: null, OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }] };
    if (unit.startsWith('dep:')) return { segment: null, departmentId: unit.slice(4), OR: [{ regionCode: 0 }, { regionCode: null }] };
    if (unit.startsWith('dist:')) return { segment: null, districtId: unit.slice(5) };
    // Hudud — tumanga bo'linmagan; Markaz — bo'limga biriktirilmagan
    if (unit.startsWith('rnd:')) return { segment: null, regionCode: Number(unit.slice(4)), districtId: null };
    if (unit === 'cnd') return { segment: null, departmentId: null, regionCode: 0 };
    if (unit.startsWith('r:')) {
      const code = Number(unit.slice(2));
      if (!Number.isInteger(code) || code <= 0) throw new BadRequestException("Hudud noto'g'ri");
      return { segment: null, regionCode: code };
    }
    const seg = segmentOfKey(unit) ?? (isSegment(unit) ? unit : null);
    if (seg) return { segment: seg };
    throw new BadRequestException("Birlik noto'g'ri");
  }

  async costs(query: { unit?: string; from?: string; to?: string; compare?: string; section?: string }): Promise<VehicleCosts> {
    const unit = String(query.unit ?? 'all');
    const range = { from: String(query.from ?? ''), to: String(query.to ?? '') };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b || (b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException("Davr noto'g'ri");
    const compare: CompareMode = query.compare === 'yoy' ? 'yoy' : 'prev';
    const section: SectionFilter = query.section === 'DOIMIY' || query.section === 'BOSHQA' ? query.section : 'ALL';
    const previous = compareRange(range, compare);
    const cur = bounds(range);
    const prev = bounds(previous);
    const start = new Date(Math.min(cur.start.getTime(), prev.start.getTime()));
    const end = new Date(Math.max(cur.end.getTime(), prev.end.getTime()));

    const expenses = await this.prisma.expense.findMany({
      where: { deletedAt: null, source: 'VEHICLE', date: { gte: start, lt: end }, ...(section !== 'ALL' ? { section } : {}), ...this.unitWhere(unit) },
      select: { id: true, date: true, amountTiyin: true, description: true },
    });
    const ids = expenses.map((e) => e.id);
    const [records, setting] = await Promise.all([
      ids.length
        ? this.prisma.vehicleRecord.findMany({ where: { expenseId: { in: ids } }, select: { expenseId: true, kind: true, vehicleId: true, vehicle: { select: { plateNumber: true, model: true, driverName: true } } } })
        : Promise.resolve([]),
      this.prisma.setting.findUnique({ where: { key: 'vehicles.places' } }),
    ]);
    const byExpense = new Map(records.map((r) => [r.expenseId!, r]));
    const meta = (setting?.value && typeof setting.value === 'object' ? setting.value : {}) as Record<string, { comment?: string | null }>;

    const acc = new Map<string, { item: VehicleCostItem; cur: bigint; prev: bigint; kinds: Map<string, { cur: bigint; prev: bigint }> }>();
    let total = 0n;
    let prevTotal = 0n;
    for (const e of expenses) {
      const c = e.date >= cur.start && e.date < cur.end;
      const p = e.date >= prev.start && e.date < prev.end;
      if (!c && !p) continue;
      const r = byExpense.get(e.id);
      const key = r?.vehicleId ?? '-';
      let x = acc.get(key);
      if (!x) {
        x = {
          item: {
            vehicleId: r?.vehicleId ?? null,
            plateNumber: r?.vehicle.plateNumber ?? 'Mashina aniqlanmagan',
            model: r?.vehicle.model ?? '',
            driverName: r?.vehicle.driverName ?? null,
            comment: r?.vehicleId ? (meta[r.vehicleId]?.comment ?? null) : null,
            amountTiyin: '0',
            previousTiyin: '0',
            count: 0,
            kinds: [],
          },
          cur: 0n,
          prev: 0n,
          kinds: new Map(),
        };
        acc.set(key, x);
      }
      const kind = r?.kind ?? 'OTHER';
      const k = x.kinds.get(kind) ?? { cur: 0n, prev: 0n };
      if (c) {
        x.cur += e.amountTiyin;
        x.item.count += 1;
        k.cur += e.amountTiyin;
        total += e.amountTiyin;
      }
      if (p) {
        x.prev += e.amountTiyin;
        k.prev += e.amountTiyin;
        prevTotal += e.amountTiyin;
      }
      x.kinds.set(kind, k);
    }
    const items = [...acc.values()]
      .map((x) => ({
        ...x.item,
        amountTiyin: x.cur.toString(),
        previousTiyin: x.prev.toString(),
        kinds: [...x.kinds.entries()]
          .map(([kind, v]) => ({ kind, label: KIND_LABELS[kind] ?? kind, amountTiyin: v.cur.toString(), previousTiyin: v.prev.toString() }))
          .sort((a, b) => Number(BigInt(b.amountTiyin) - BigInt(a.amountTiyin))),
      }))
      .sort((a, b) => Number(BigInt(b.amountTiyin) - BigInt(a.amountTiyin)) || a.plateNumber.localeCompare(b.plateNumber));
    return { unit, range, previousRange: previous, totalTiyin: total.toString(), previousTotalTiyin: prevTotal.toString(), items };
  }
}
