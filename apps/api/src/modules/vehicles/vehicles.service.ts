import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Vehicle, VehicleRecord } from '@prisma/client';
import { isSegment, segmentLabel, type SegmentCode } from '../../common/segments/segments';
import { PrismaService } from '../prisma/prisma.service';
import {
  VEHICLE_BODY_TYPES,
  VEHICLE_GROUPS,
  CENTRAL_REGION,
  FUEL_TYPE_LABELS,
  PAYMENT_METHODS,
  RECORD_KIND_LABELS,
  VEHICLE_CATEGORIES,
  VEHICLE_FUEL_TYPES,
  VEHICLE_PARENT_CATEGORY,
  VEHICLE_PARENT_LABEL,
  VEHICLE_RECORD_KINDS,
  type PaymentMethodValue,
  type RecordFilter,
  type RecordInput,
  type RecordItem,
  type SummaryVehicleRow,
  type VehicleFuelTypeValue,
  type VehicleInput,
  type VehicleListItem,
  type VehicleListResult,
  type VehicleLookups,
  type VehicleRecordKindValue,
  type VehicleSummary,
} from './vehicles.types';

// ═══════════════════════════════════════════════════════════
// Yordamchilar
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_ODOMETER = 5_000_000;

function tashkentNow(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000);
}

function currentPeriod(): string {
  const now = tashkentNow();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function todayIso(): string {
  return tashkentNow().toISOString().slice(0, 10);
}

function assertPeriod(value: unknown, label: string): string {
  if (typeof value !== 'string' || !PERIOD_RE.test(value)) {
    throw new BadRequestException(`${label} noto'g'ri (YYYY-MM)`);
  }
  return value;
}

function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** shiftPeriod("2026-03", -11) → "2025-04" */
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function periodsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  for (let p = from; p <= to && result.length < 120; p = nextPeriod(p)) result.push(p);
  return result;
}

/** Bo'sh satr → null; uzunlik tekshiriladi */
function text(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim().replace(/\s+/g, ' ');
  if (!result) return null;
  if (result.length > max) throw new BadRequestException(`${label} ${max} belgidan oshmasin`);
  return result;
}

function required(value: unknown, label: string, max: number): string {
  const result = text(value, label, max);
  if (!result) throw new BadRequestException(`${label} kiritilishi shart`);
  return result;
}

function int(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const result = Number(String(value).replace(/\s/g, ''));
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new BadRequestException(`${label} ${min} dan ${max} gacha butun son bo'lishi kerak`);
  }
  return result;
}

function float(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const result = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(result) || result <= min || result > max) {
    throw new BadRequestException(`${label} ${min} dan katta va ${max} dan oshmasligi kerak`);
  }
  return Math.round(result * 100) / 100;
}

function tiyin(value: unknown): bigint {
  let result: bigint;
  try {
    result = BigInt(String(value ?? '').trim());
  } catch {
    throw new BadRequestException("Summa noto'g'ri");
  }
  if (result <= 0n) throw new BadRequestException("Summa noldan katta bo'lishi kerak");
  if (result > 100_000_000_000_00n) throw new BadRequestException('Summa juda katta');
  return result;
}

function oneOf<T extends string>(value: unknown, list: readonly T[], label: string): T {
  if (typeof value !== 'string' || !list.includes(value as T)) {
    throw new BadRequestException(`${label} noto'g'ri`);
  }
  return value as T;
}

/** "YYYY-MM-DD" → UTC yarim tun va davr; kelajak sanasi rad etiladi */
function parseDate(value: unknown): { date: Date; period: string; iso: string } {
  const match = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!match) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d)) {
    throw new BadRequestException("Sana noto'g'ri");
  }
  const iso = `${y}-${m}-${d}`;
  if (iso > todayIso()) throw new BadRequestException("Kelajakdagi sanani kiritib bo'lmaydi");
  if (Number(y) < 2000) throw new BadRequestException("Sana noto'g'ri");
  return { date, period: `${y}-${m}`, iso };
}

/** Davlat raqami: katta harf, bitta bo'shliq */
function normalizePlate(value: unknown): string {
  const plate = required(value, 'Davlat raqami', 20).toUpperCase();
  if (!/^[0-9A-Z\s-]+$/.test(plate)) {
    throw new BadRequestException("Davlat raqamida faqat lotin harflari va raqamlar bo'lsin");
  }
  return plate;
}

function plateKey(plate: string): string {
  return plate.replace(/[\s-]/g, '');
}

function emptyKinds(): Record<VehicleRecordKindValue, bigint> {
  return { FUEL: 0n, WASH: 0n, REPAIR: 0n, SERVICE: 0n, OTHER: 0n };
}

function kindsToStrings(kinds: Record<VehicleRecordKindValue, bigint>): Record<VehicleRecordKindValue, string> {
  return {
    FUEL: kinds.FUEL.toString(),
    WASH: kinds.WASH.toString(),
    REPAIR: kinds.REPAIR.toString(),
    SERVICE: kinds.SERVICE.toString(),
    OTHER: kinds.OTHER.toString(),
  };
}

function formatDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type RecordWithVehicle = VehicleRecord & { vehicle: { plateNumber: string; model: string } };

interface ValidRecord {
  vehicle: Vehicle;
  kind: VehicleRecordKindValue;
  date: Date;
  period: string;
  amountTiyin: bigint;
  liters: number | null;
  odometerKm: number | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: PaymentMethodValue;
}

// ═══════════════════════════════════════════════════════════
// Mashina qaysi bo'limniki (xarajati qayerga yoziladi)
//  • Markaz bo'limi yoki hudud — mashinaning o'z maydonlarida (regionCode, departmentId);
//  • yo'nalish (Tax free, Marksheyder …) va izoh — «vehicles.places» sozlamasida (migratsiyasiz).
// Biriktirilganda mashinaning BOR xarajatlari (yoki tanlangan oydan boshlab) ko'chadi, keyingi
// yuklashlar (benzin hisoboti, qo'lda kiritish) avtomatik shu joyga yoziladi.
// ═══════════════════════════════════════════════════════════

const PLACES_KEY = 'vehicles.places';

export interface VehiclePlaceMeta {
  segment: SegmentCode | null;
  comment: string | null;
  at: string;
  by: string;
}

export type VehicleUnit = 'CENTER' | 'REGION' | SegmentCode;

export interface VehiclePlaceInput {
  id?: unknown;
  unit?: unknown;
  regionCode?: unknown;
  departmentId?: unknown;
  comment?: unknown;
}

export interface VehiclePlaceRow {
  id: string;
  plateNumber: string;
  model: string;
  driverName: string | null;
  fleetGroup: string | null;
  fleetGroupLabel: string | null;
  isActive: boolean;
  unit: VehicleUnit;
  regionCode: number;
  regionName: string;
  departmentId: string | null;
  departmentName: string | null;
  segment: SegmentCode | null;
  /** Joy matni: «Markaz › Buxgalteriya», «Andijon viloyati», «Marksheyder» */
  placeLabel: string;
  comment: string | null;
  commentAt: string | null;
  /** Tanlangan davrdagi xarajat */
  totalTiyin: string;
  count: number;
  /** Oylar bo'yicha (davr ichida) */
  months: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

/**
 * Mashinalar: yoqilg'i, moyka, ta'mirlash.
 *
 * Har bir xarajat yozuvi "Xarajatlar"da (Doimiy bo'limi, manba VEHICLE)
 * bitta yozuv yaratadi. Xarajatlar ro'yxatida bu yozuvlar qulflangan —
 * faqat shu sahifadan tahrirlanadi va o'chiriladi.
 */
@Injectable()
export class VehiclesService {
  private categoriesReady: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════ Kategoriyalar ═══════════

  /** "Mashinalar" kategoriyasi va uning 5 ta bolasi — bir marta yaratiladi */
  ensureCategories(): Promise<void> {
    if (!this.categoriesReady) {
      this.categoriesReady = (async () => {
        await this.prisma.category.upsert({
          where: { code: VEHICLE_PARENT_CATEGORY },
          update: {},
          create: { code: VEHICLE_PARENT_CATEGORY, label: VEHICLE_PARENT_LABEL, isLeaf: false, order: 55 },
        });
        let order = 551;
        for (const kind of VEHICLE_RECORD_KINDS) {
          const category = VEHICLE_CATEGORIES[kind];
          await this.prisma.category.upsert({
            where: { code: category.code },
            update: {},
            create: {
              code: category.code,
              label: category.label,
              parentCode: VEHICLE_PARENT_CATEGORY,
              isLeaf: true,
              behavior: category.behavior,
              order: order++,
            },
          });
        }
      })().catch((error: unknown) => {
        this.categoriesReady = null;
        throw error;
      });
    }
    return this.categoriesReady;
  }

  // ═══════════ Ma'lumotnomalar ═══════════

  private async names(): Promise<{ regions: Map<number, string>; departments: Map<string, string> }> {
    const [regions, departments] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const regionMap = new Map(regions.map((r) => [r.code, r.name]));
    if (!regionMap.has(CENTRAL_REGION)) regionMap.set(CENTRAL_REGION, 'Markaz');
    return { regions: regionMap, departments: new Map(departments.map((d) => [d.id, d.name])) };
  }

  /** Oldingi yozuvlardagi AZS, moyka, servis nomlari (tur bo'yicha, oxirgisi birinchi) */
  async counterparties(kind?: string): Promise<string[]> {
    const rows = await this.prisma.vehicleRecord.findMany({
      where: { deletedAt: null, counterparty: { not: null }, ...(kind && (VEHICLE_RECORD_KINDS as readonly string[]).includes(kind) ? { kind: kind as VehicleRecordKindValue } : {}) },
      select: { counterparty: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const seen = new Map<string, string>();
    for (const r of rows) {
      const name = (r.counterparty ?? '').trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    return [...seen.values()].slice(0, 50);
  }

  async lookups(): Promise<VehicleLookups> {
    const [regions, departments] = await Promise.all([
      this.prisma.region.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const list = regions.some((r) => r.code === CENTRAL_REGION)
      ? regions
      : [{ code: CENTRAL_REGION, name: 'Markaz' }, ...regions];
    return {
      regions: list,
      departments,
      fuelTypes: VEHICLE_FUEL_TYPES.map((value) => ({ value, label: FUEL_TYPE_LABELS[value] })),
      kinds: VEHICLE_RECORD_KINDS.map((value) => ({ value, label: RECORD_KIND_LABELS[value] })),
      groups: VEHICLE_GROUPS.map((g) => ({ value: g.value, label: g.label })),
    };
  }

  // ═══════════ Mashinalar ═══════════

  private async findVehicle(id: string): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!vehicle) throw new NotFoundException('Mashina topilmadi');
    return vehicle;
  }

  /** Kiritilgan ma'lumotni tekshiradi; tahrirlashda bor qiymatlar asos bo'ladi */
  private async buildVehicle(input: VehicleInput, base?: Vehicle) {
    const pick = <K extends keyof VehicleInput>(key: K, fallback: unknown) =>
      input[key] !== undefined ? input[key] : fallback;

    const plateNumber = normalizePlate(pick('plateNumber', base?.plateNumber));
    const model = required(pick('model', base?.model), 'Rusumi', 80);
    const year = int(pick('year', base?.year), 'Ishlab chiqarilgan yil', 1970, tashkentNow().getUTCFullYear() + 1);
    const color = text(pick('color', base?.color), 'Rangi', 40);
    const fuelType = oneOf(pick('fuelType', base?.fuelType ?? 'AI92'), VEHICLE_FUEL_TYPES, "Yoqilg'i turi");
    const fuelNorm = float(pick('fuelNorm', base?.fuelNorm), "Yoqilg'i me'yori", 0, 100);
    const regionCode = int(pick('regionCode', base?.regionCode ?? CENTRAL_REGION), 'Hudud', 0, 999) ?? CENTRAL_REGION;
    const departmentId = text(pick('departmentId', base?.departmentId), "Bo'lim", 60);
    const driverName = text(pick('driverName', base?.driverName), 'Haydovchi', 120);
    const driverPhone = text(pick('driverPhone', base?.driverPhone), 'Telefon', 30);
    const initialOdometerKm = int(
      pick('initialOdometerKm', base?.initialOdometerKm),
      "Boshlang'ich probeg",
      0,
      MAX_ODOMETER,
    );
    const isActive = input.isActive !== undefined ? input.isActive === true : (base?.isActive ?? true);
    const note = text(pick('note', base?.note), 'Izoh', 500);
    const groupRaw = pick('fleetGroup', base?.fleetGroup);
    const fleetGroup = groupRaw === null || groupRaw === undefined || groupRaw === '' ? null : String(groupRaw);
    if (fleetGroup && !VEHICLE_GROUPS.some((g) => g.value === fleetGroup)) throw new BadRequestException("Guruh noto'g'ri");
    const cardRaw = pick('fuelCardNo', base?.fuelCardNo);
    const fuelCardNo = cardRaw === null || cardRaw === undefined || String(cardRaw).trim() === '' ? null : String(cardRaw).trim().replace(/\s+/g, '').slice(0, 40);
    const bodyRaw = pick('bodyType', base?.bodyType);
    const bodyType = bodyRaw === null || bodyRaw === undefined || bodyRaw === '' ? null : String(bodyRaw).toUpperCase();
    if (bodyType && !(VEHICLE_BODY_TYPES as readonly string[]).includes(bodyType)) throw new BadRequestException("Kuzov turi noto'g'ri");

    if (regionCode !== CENTRAL_REGION) {
      const region = await this.prisma.region.findUnique({ where: { code: regionCode } });
      if (!region) throw new BadRequestException('Hudud topilmadi');
    }
    if (departmentId) {
      const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
      if (!department) throw new BadRequestException("Bo'lim topilmadi");
    }

    // Davlat raqami takrorlanmasin (o'chirilganlar hisobga olinmaydi)
    const others = await this.prisma.vehicle.findMany({
      where: { deletedAt: null, ...(base ? { id: { not: base.id } } : {}) },
      select: { plateNumber: true },
    });
    if (others.some((v) => plateKey(v.plateNumber) === plateKey(plateNumber))) {
      throw new ConflictException(`${plateNumber} raqamli mashina allaqachon kiritilgan`);
    }

    return {
      plateNumber,
      model,
      year,
      color,
      fuelType,
      fuelNorm,
      regionCode,
      departmentId,
      driverName,
      driverPhone,
      initialOdometerKm,
      isActive,
      note,
      fleetGroup,
      fuelCardNo,
      bodyType,
    };
  }

  async list(periodInput?: string): Promise<VehicleListResult> {
    const period = periodInput ? assertPeriod(periodInput, 'Oy') : currentPeriod();

    const metas = await this.placeMeta();
    const [vehicles, monthGroups, odometers, counts, names] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { plateNumber: 'asc' }],
      }),
      this.prisma.vehicleRecord.groupBy({
        by: ['vehicleId', 'kind'],
        where: { deletedAt: null, period },
        _sum: { amountTiyin: true, liters: true },
        _count: { _all: true },
      }),
      this.prisma.vehicleRecord.groupBy({
        by: ['vehicleId'],
        where: { deletedAt: null, odometerKm: { not: null } },
        _max: { odometerKm: true },
      }),
      this.prisma.vehicleRecord.groupBy({
        by: ['vehicleId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.names(),
    ]);

    const lastOdometer = new Map(odometers.map((o) => [o.vehicleId, o._max.odometerKm]));
    const recordCount = new Map(counts.map((c) => [c.vehicleId, c._count._all]));

    const totals = { total: 0n, count: 0, liters: 0, byKind: emptyKinds() };

    const items: VehicleListItem[] = vehicles.map((vehicle) => {
      const byKind = emptyKinds();
      let total = 0n;
      let count = 0;
      let liters = 0;
      for (const group of monthGroups) {
        if (group.vehicleId !== vehicle.id) continue;
        const kind = group.kind as VehicleRecordKindValue;
        const sum = group._sum.amountTiyin ?? 0n;
        byKind[kind] += sum;
        total += sum;
        count += group._count._all;
        liters += group._sum.liters ?? 0;
        totals.byKind[kind] += sum;
      }
      totals.total += total;
      totals.count += count;
      totals.liters += liters;

      const lastKm = lastOdometer.get(vehicle.id) ?? null;
      return {
        id: vehicle.id,
        plateNumber: vehicle.plateNumber,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        fuelType: vehicle.fuelType as VehicleFuelTypeValue,
        fuelNorm: vehicle.fuelNorm,
        regionCode: vehicle.regionCode,
        regionName: names.regions.get(vehicle.regionCode) ?? `Hudud ${vehicle.regionCode}`,
        departmentId: vehicle.departmentId,
        departmentName: vehicle.departmentId ? (names.departments.get(vehicle.departmentId) ?? null) : null,
        segment: metas[vehicle.id]?.segment ?? null,
        segmentLabel: metas[vehicle.id]?.segment ? segmentLabel(metas[vehicle.id]!.segment!) : null,
        placeComment: metas[vehicle.id]?.comment ?? null,
        driverName: vehicle.driverName,
        driverPhone: vehicle.driverPhone,
        initialOdometerKm: vehicle.initialOdometerKm,
        isActive: vehicle.isActive,
        note: vehicle.note,
        fleetGroup: vehicle.fleetGroup,
        fleetGroupLabel: VEHICLE_GROUPS.find((g) => g.value === vehicle.fleetGroup)?.label ?? null,
        fuelCardNo: vehicle.fuelCardNo,
        bodyType: vehicle.bodyType,
        lastOdometerKm: lastKm ?? vehicle.initialOdometerKm,
        month: {
          totalTiyin: total.toString(),
          count,
          liters: round(liters, 2),
          byKind: kindsToStrings(byKind),
        },
        recordCount: recordCount.get(vehicle.id) ?? 0,
      };
    });

    return {
      period,
      items,
      totals: {
        totalTiyin: totals.total.toString(),
        count: totals.count,
        liters: round(totals.liters, 2),
        byKind: kindsToStrings(totals.byKind),
      },
    };
  }

  async create(input: VehicleInput, userId: string) {
    const data = await this.buildVehicle(input ?? {});
    const vehicle = await this.prisma.vehicle.create({ data: { ...data, createdById: userId } });
    return { id: vehicle.id, plateNumber: vehicle.plateNumber };
  }

  /**
   * Tahrirlash. Hudud yoki bo'lim o'zgarsa — bog'langan xarajat yozuvlari ham
   * yangilanadi, aks holda hududlar tahlili noto'g'ri chiqadi.
   */
  async update(id: string, input: VehicleInput) {
    const existing = await this.findVehicle(id);
    const data = await this.buildVehicle(input ?? {}, existing);

    const placeChanged =
      data.regionCode !== existing.regionCode || data.departmentId !== existing.departmentId;
    const labelChanged = data.plateNumber !== existing.plateNumber || data.model !== existing.model;
    // Formada hudud/bo'lim o'zgardi — yo'nalish biriktiruvi bekor bo'ladi (mashina endi o'sha joyniki)
    const metas = await this.placeMeta();
    let meta = metas[id] ?? null;
    if (placeChanged && meta?.segment) {
      meta = { ...meta, segment: null };
      metas[id] = meta;
      await this.savePlaceMeta(metas);
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.vehicle.update({ where: { id }, data });
        if (!placeChanged && !labelChanged) return;

        const records = await tx.vehicleRecord.findMany({
          where: { vehicleId: id, deletedAt: null, expenseId: { not: null } },
        });
        for (const record of records) {
          await tx.expense.updateMany({
            where: { id: record.expenseId!, deletedAt: null },
            data: {
              regionCode: meta?.segment ? null : data.regionCode,
              departmentId: meta?.segment ? null : data.departmentId,
              segment: meta?.segment ?? null,
              description: this.expenseText(
                { plateNumber: data.plateNumber, model: data.model },
                record.kind as VehicleRecordKindValue,
                record.liters,
                record.description,
                meta?.comment ?? null,
              ),
            },
          });
        }
      },
      { timeout: 60_000 },
    );

    return { id, plateNumber: data.plateNumber };
  }

  /** O'chirish — faqat xarajati yo'q mashina. Aks holda "Faol emas" qilinadi. */
  async remove(id: string) {
    await this.findVehicle(id);
    const records = await this.prisma.vehicleRecord.count({ where: { vehicleId: id, deletedAt: null } });
    if (records > 0) {
      throw new ConflictException(
        `Bu mashinada ${records} ta xarajat yozuvi bor. O'chirish o'rniga "Faol emas" deb belgilang — tarix saqlanib qoladi`,
      );
    }
    await this.prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id };
  }

  // ═══════════ Xarajat yozuvlari ═══════════

  expenseText(
    vehicle: { plateNumber: string; model: string },
    kind: VehicleRecordKindValue,
    liters: number | null,
    description: string | null,
    comment: string | null = null,
  ): string {
    let result = `${RECORD_KIND_LABELS[kind]}: ${vehicle.plateNumber} (${vehicle.model})`;
    if (kind === 'FUEL' && liters) result += ` · ${String(liters).replace('.', ',')} l`;
    if (description) result += ` — ${description}`;
    if (comment) result += ` · Izoh: ${comment}`;
    return result.slice(0, 500);
  }

  private mapRecord(record: RecordWithVehicle): RecordItem {
    return {
      id: record.id,
      vehicleId: record.vehicleId,
      plateNumber: record.vehicle.plateNumber,
      model: record.vehicle.model,
      kind: record.kind as VehicleRecordKindValue,
      date: record.date.toISOString().slice(0, 10),
      period: record.period,
      amountTiyin: record.amountTiyin.toString(),
      liters: record.liters,
      odometerKm: record.odometerKm,
      description: record.description,
      counterparty: record.counterparty,
      documentNo: record.documentNo,
      paymentMethod: record.paymentMethod as PaymentMethodValue,
      expenseId: record.expenseId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /** Spidometr ketma-ketligi: oldingi yozuvdan kam, keyingisidan ko'p bo'lmasin */
  private async checkOdometer(vehicle: Vehicle, date: Date, odometerKm: number, excludeId?: string) {
    if (vehicle.initialOdometerKm !== null && odometerKm < vehicle.initialOdometerKm) {
      throw new BadRequestException(
        `Spidometr ${odometerKm} km — boshlang'ich probeg (${vehicle.initialOdometerKm} km) dan kam bo'lishi mumkin emas`,
      );
    }
    const base: Prisma.VehicleRecordWhereInput = {
      vehicleId: vehicle.id,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    };
    const [before, after] = await Promise.all([
      this.prisma.vehicleRecord.findFirst({
        where: { ...base, date: { lt: date }, odometerKm: { gt: odometerKm } },
        orderBy: { odometerKm: 'desc' },
      }),
      this.prisma.vehicleRecord.findFirst({
        where: { ...base, date: { gt: date }, odometerKm: { lt: odometerKm } },
        orderBy: { odometerKm: 'asc' },
      }),
    ]);
    if (before) {
      throw new BadRequestException(
        `Spidometr ${odometerKm} km — ${formatDate(before.date)} dagi ${before.odometerKm} km dan kam bo'lishi mumkin emas`,
      );
    }
    if (after) {
      throw new BadRequestException(
        `Spidometr ${odometerKm} km — ${formatDate(after.date)} dagi ${after.odometerKm} km dan ko'p bo'lishi mumkin emas`,
      );
    }
  }

  private async buildRecord(input: RecordInput, base?: VehicleRecord): Promise<ValidRecord> {
    const pick = <K extends keyof RecordInput>(key: K, fallback: unknown) =>
      input[key] !== undefined ? input[key] : fallback;

    const vehicleId = required(pick('vehicleId', base?.vehicleId), 'Mashina', 60);
    const vehicle = await this.findVehicle(vehicleId);
    if (!vehicle.isActive && (!base || base.vehicleId !== vehicle.id)) {
      throw new BadRequestException(`${vehicle.plateNumber} faol emas — avval uni faollashtiring`);
    }

    const kind = oneOf(pick('kind', base?.kind), VEHICLE_RECORD_KINDS, 'Xarajat turi');
    const { date, period } = parseDate(
      pick('date', base ? base.date.toISOString().slice(0, 10) : undefined),
    );
    const amountTiyin = tiyin(pick('amountTiyin', base?.amountTiyin?.toString()));
    const liters =
      kind === 'FUEL' ? float(pick('liters', base?.liters), 'Litr', 0, 2000) : null;
    const odometerKm = int(pick('odometerKm', base?.odometerKm), 'Spidometr', 0, MAX_ODOMETER);
    const description = text(pick('description', base?.description), 'Izoh', 300);
    const counterparty = text(pick('counterparty', base?.counterparty), 'Qayerda (AZS, servis)', 150);
    const documentNo = text(pick('documentNo', base?.documentNo), 'Chek / hujjat raqami', 60);
    const paymentMethod = oneOf(
      pick('paymentMethod', base?.paymentMethod ?? 'CASH'),
      PAYMENT_METHODS,
      "To'lov usuli",
    );

    if (odometerKm !== null) await this.checkOdometer(vehicle, date, odometerKm, base?.id);

    return {
      vehicle,
      kind,
      date,
      period,
      amountTiyin,
      liters,
      odometerKm,
      description,
      counterparty,
      documentNo,
      paymentMethod,
    };
  }

  /** Xarajat yozuvi maydonlari (createdById alohida qo'shiladi); meta — mashina yo'nalishi va izohi */
  private expenseData(record: ValidRecord, meta?: VehiclePlaceMeta | null) {
    const segment = meta?.segment ?? null;
    return {
      date: record.date,
      period: record.period,
      amountTiyin: record.amountTiyin,
      categoryCode: VEHICLE_CATEGORIES[record.kind].code,
      // Yo'nalish mashinasi — hudud/bo'limsiz, `segment` bilan (yo'nalish xarajati)
      departmentId: segment ? null : record.vehicle.departmentId,
      regionCode: segment ? null : record.vehicle.regionCode,
      segment,
      description: this.expenseText(record.vehicle, record.kind, record.liters, record.description, meta?.comment ?? null),
      paymentMethod: record.paymentMethod,
      documentNo: record.documentNo,
      counterparty: record.counterparty,
      paymentStatus: 'PAID' as const,
      source: 'VEHICLE' as const,
      section: 'DOIMIY' as const,
    };
  }

  private recordData(record: ValidRecord) {
    return {
      vehicleId: record.vehicle.id,
      kind: record.kind,
      date: record.date,
      period: record.period,
      amountTiyin: record.amountTiyin,
      liters: record.liters,
      odometerKm: record.odometerKm,
      description: record.description,
      counterparty: record.counterparty,
      documentNo: record.documentNo,
      paymentMethod: record.paymentMethod,
    };
  }

  async records(filter: RecordFilter): Promise<RecordItem[]> {
    const period = filter.period ? assertPeriod(filter.period, 'Oy') : currentPeriod();
    const kind = filter.kind ? oneOf(filter.kind, VEHICLE_RECORD_KINDS, 'Xarajat turi') : undefined;

    const rows = await this.prisma.vehicleRecord.findMany({
      where: {
        deletedAt: null,
        period,
        ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
        ...(kind ? { kind } : {}),
      },
      include: { vehicle: { select: { plateNumber: true, model: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return rows.map((row) => this.mapRecord(row));
  }

  async createRecord(input: RecordInput, userId: string): Promise<RecordItem> {
    const record = await this.buildRecord(input ?? {});
    await this.ensureCategories();
    const meta = (await this.placeMeta())[record.vehicle.id] ?? null;

    const created = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: { ...this.expenseData(record, meta), createdById: userId },
        select: { id: true },
      });
      return tx.vehicleRecord.create({
        data: { ...this.recordData(record), expenseId: expense.id, createdById: userId },
        include: { vehicle: { select: { plateNumber: true, model: true } } },
      });
    });
    return this.mapRecord(created);
  }

  /** Fayldan (yoqilg'i hisoboti) kelgan yozuv: importKey bilan — qayta yuklanganda takrorlanmaydi */
  async createImportedFuel(input: RecordInput, importKey: string, userId: string): Promise<RecordItem> {
    const record = await this.buildRecord(input ?? {});
    await this.ensureCategories();
    // Mashina avval biriktirilgan joyga (bo'lim, hudud yoki yo'nalish) — avtomatik
    const meta = (await this.placeMeta())[record.vehicle.id] ?? null;
    const created = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: { ...this.expenseData(record, meta), createdById: userId },
        select: { id: true },
      });
      return tx.vehicleRecord.create({
        data: { ...this.recordData(record), expenseId: expense.id, importKey, createdById: userId },
        include: { vehicle: { select: { plateNumber: true, model: true } } },
      });
    });
    return this.mapRecord(created);
  }

  async updateRecord(id: string, input: RecordInput, userId: string): Promise<RecordItem> {
    const existing = await this.prisma.vehicleRecord.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Xarajat yozuvi topilmadi');

    const record = await this.buildRecord(input ?? {}, existing);
    await this.ensureCategories();
    const meta = (await this.placeMeta())[record.vehicle.id] ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      let expenseId = existing.expenseId;
      const alive = expenseId
        ? await tx.expense.findFirst({ where: { id: expenseId, deletedAt: null }, select: { id: true } })
        : null;

      if (alive) {
        await tx.expense.update({ where: { id: alive.id }, data: this.expenseData(record, meta) });
      } else {
        // Xarajat yozuvi yo'qolgan bo'lsa (masalan, savatdan o'chirilgan) — qayta yaratiladi
        const expense = await tx.expense.create({
          data: { ...this.expenseData(record, meta), createdById: userId },
          select: { id: true },
        });
        expenseId = expense.id;
      }

      return tx.vehicleRecord.update({
        where: { id },
        data: { ...this.recordData(record), expenseId },
        include: { vehicle: { select: { plateNumber: true, model: true } } },
      });
    });
    return this.mapRecord(updated);
  }

  async removeRecord(id: string) {
    const existing = await this.prisma.vehicleRecord.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Xarajat yozuvi topilmadi');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleRecord.update({ where: { id }, data: { deletedAt: now, importKey: null } });
      if (existing.expenseId) {
        await tx.expense.updateMany({
          where: { id: existing.expenseId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
    });
    return { id };
  }

  // ═══════════ Tahlil ═══════════

  /**
   * Davr bo'yicha: oylar kesimida tur summalari va har mashina uchun
   * masofa, 100 km ga sarf (to'liq bak usuli) va 1 km narxi.
   */
  // ═══════════ Bo'limlarga biriktirish ═══════════

  /** Qisqa kesh: benzin hisoboti yuklanganda har yozuv uchun sozlama qayta o'qilmasin */
  private metaCache: { at: number; value: Record<string, VehiclePlaceMeta> } | null = null;

  private async placeMeta(): Promise<Record<string, VehiclePlaceMeta>> {
    if (this.metaCache && Date.now() - this.metaCache.at < 5_000) return { ...this.metaCache.value };
    const value = await this.readPlaceMeta();
    this.metaCache = { at: Date.now(), value };
    return { ...value };
  }

  private async readPlaceMeta(): Promise<Record<string, VehiclePlaceMeta>> {
    const row = await this.prisma.setting.findUnique({ where: { key: PLACES_KEY } });
    const v = row?.value;
    const out: Record<string, VehiclePlaceMeta> = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
        const m = (raw ?? {}) as Partial<VehiclePlaceMeta>;
        out[k] = {
          segment: isSegment(m.segment) ? m.segment : null,
          comment: typeof m.comment === 'string' && m.comment.trim() ? m.comment.trim().slice(0, 300) : null,
          at: typeof m.at === 'string' ? m.at : '',
          by: typeof m.by === 'string' ? m.by : '',
        };
      }
    }
    return out;
  }

  private async savePlaceMeta(map: Record<string, VehiclePlaceMeta>, tx: Pick<PrismaService, 'setting'> = this.prisma) {
    const clean: Record<string, VehiclePlaceMeta> = {};
    for (const [k, m] of Object.entries(map)) if (m.segment || m.comment) clean[k] = m;
    const value = clean as unknown as Prisma.InputJsonValue;
    await tx.setting.upsert({ where: { key: PLACES_KEY }, create: { key: PLACES_KEY, value }, update: { value } });
    this.metaCache = null;
  }

  /** Mashinalar va ularning joyi, tanlangan davrdagi xarajati (oylar bilan) */
  async places(fromInput?: string, toInput?: string): Promise<{ from: string; to: string; months: string[]; items: VehiclePlaceRow[] }> {
    const to = toInput ? assertPeriod(toInput, 'Tugash oyi') : currentPeriod();
    const from = fromInput ? assertPeriod(fromInput, 'Boshlanish oyi') : shiftPeriod(to, -8);
    if (from > to) throw new BadRequestException('Boshlanish oyi tugash oyidan keyin');
    const months = periodsBetween(from, to);
    if (months.length > 36) throw new BadRequestException('Davr 36 oydan oshmasin');
    const [vehicles, groups, names, metas] = await Promise.all([
      this.prisma.vehicle.findMany({ where: { deletedAt: null }, orderBy: [{ isActive: 'desc' }, { plateNumber: 'asc' }] }),
      this.prisma.vehicleRecord.groupBy({ by: ['vehicleId', 'period'], where: { deletedAt: null, period: { gte: from, lte: to } }, _sum: { amountTiyin: true }, _count: { _all: true } }),
      this.names(),
      this.placeMeta(),
    ]);
    const items = vehicles.map((v): VehiclePlaceRow => {
      const meta = metas[v.id] ?? null;
      const mine = groups.filter((g) => g.vehicleId === v.id);
      const monthMap: Record<string, string> = {};
      let total = 0n;
      let count = 0;
      for (const g of mine) {
        const sum = g._sum.amountTiyin ?? 0n;
        monthMap[g.period] = sum.toString();
        total += sum;
        count += g._count._all;
      }
      const segment = meta?.segment ?? null;
      const regionName = names.regions.get(v.regionCode) ?? `Hudud ${v.regionCode}`;
      const departmentName = v.departmentId ? (names.departments.get(v.departmentId) ?? null) : null;
      const unit: VehicleUnit = segment ?? (v.regionCode === CENTRAL_REGION ? 'CENTER' : 'REGION');
      const placeLabel = segment ? segmentLabel(segment) : v.regionCode === CENTRAL_REGION ? `Markaz${departmentName ? ` › ${departmentName}` : ''}` : `${regionName}${departmentName ? ` › ${departmentName}` : ''}`;
      return {
        id: v.id,
        plateNumber: v.plateNumber,
        model: v.model,
        driverName: v.driverName,
        fleetGroup: v.fleetGroup,
        fleetGroupLabel: VEHICLE_GROUPS.find((g) => g.value === v.fleetGroup)?.label ?? null,
        isActive: v.isActive,
        unit,
        regionCode: v.regionCode,
        regionName,
        departmentId: v.departmentId,
        departmentName,
        segment,
        placeLabel,
        comment: meta?.comment ?? null,
        commentAt: meta?.at || null,
        totalTiyin: total.toString(),
        count,
        months: monthMap,
      };
    });
    return { from, to, months, items };
  }

  /**
   * Biriktirish: mashina(lar) → Markaz bo'limi / hudud / yo'nalish, izoh bilan.
   * Bog'langan xarajatlar (hammasi yoki fromPeriod dan boshlab) ko'chiriladi; keyingi yuklashlar — shu joyga.
   */
  async setPlaces(body: { items?: unknown; fromPeriod?: unknown }, userId: string): Promise<{ vehicles: number; expenses: number }> {
    const list = Array.isArray(body?.items) ? (body.items as VehiclePlaceInput[]) : [];
    if (!list.length) throw new BadRequestException('Mashina tanlanmagan');
    if (list.length > 500) throw new BadRequestException("Bir martada 500 tagacha mashina");
    const fromPeriod = body.fromPeriod ? assertPeriod(String(body.fromPeriod), 'Qaysi oydan') : null;
    const [metas, names] = await Promise.all([this.placeMeta(), this.names()]);
    const at = new Date().toISOString();
    let moved = 0;
    const plan: { vehicle: Vehicle; regionCode: number; departmentId: string | null; meta: VehiclePlaceMeta }[] = [];
    for (const it of list) {
      const id = typeof it.id === 'string' ? it.id : '';
      const vehicle = await this.findVehicle(id);
      const unit = String(it.unit ?? '');
      const comment = typeof it.comment === 'string' && it.comment.trim() ? it.comment.trim().slice(0, 300) : null;
      let regionCode = CENTRAL_REGION;
      let departmentId: string | null = null;
      let segment: SegmentCode | null = null;
      if (unit === 'CENTER') {
        departmentId = typeof it.departmentId === 'string' && it.departmentId ? it.departmentId : null;
        if (departmentId && !names.departments.has(departmentId)) throw new BadRequestException(`${vehicle.plateNumber}: bo'lim topilmadi`);
      } else if (unit === 'REGION') {
        const code = Number(it.regionCode);
        if (!Number.isInteger(code) || code <= 0 || !names.regions.has(code)) throw new BadRequestException(`${vehicle.plateNumber}: hudud tanlanmagan`);
        regionCode = code;
      } else if (isSegment(unit)) {
        segment = unit;
      } else {
        throw new BadRequestException(`${vehicle.plateNumber}: qayerga biriktirilishi noto'g'ri`);
      }
      plan.push({ vehicle, regionCode, departmentId, meta: { segment, comment, at, by: userId } });
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const p of plan) {
          await tx.vehicle.update({ where: { id: p.vehicle.id }, data: { regionCode: p.regionCode, departmentId: p.departmentId } });
          metas[p.vehicle.id] = p.meta;
          const records = await tx.vehicleRecord.findMany({
            where: { vehicleId: p.vehicle.id, deletedAt: null, expenseId: { not: null }, ...(fromPeriod ? { period: { gte: fromPeriod } } : {}) },
          });
          for (const r of records) {
            const res = await tx.expense.updateMany({
              where: { id: r.expenseId!, deletedAt: null },
              data: {
                regionCode: p.meta.segment ? null : p.regionCode,
                departmentId: p.meta.segment ? null : p.departmentId,
                segment: p.meta.segment,
                description: this.expenseText(p.vehicle, r.kind as VehicleRecordKindValue, r.liters, r.description, p.meta.comment),
              },
            });
            moved += res.count;
          }
        }
        await this.savePlaceMeta(metas, tx);
      },
      { timeout: 120_000 },
    );
    return { vehicles: plan.length, expenses: moved };
  }

  async summary(fromInput: string, toInput: string): Promise<VehicleSummary> {
    const to = toInput ? assertPeriod(toInput, 'Tugash oyi') : currentPeriod();
    const from = fromInput ? assertPeriod(fromInput, 'Boshlanish oyi') : shiftPeriod(to, -11);
    if (from > to) throw new BadRequestException('Boshlanish oyi tugash oyidan keyin');
    const months = periodsBetween(from, to);
    if (months.length > 60) throw new BadRequestException("Davr 60 oydan oshmasin");

    const records = await this.prisma.vehicleRecord.findMany({
      where: { deletedAt: null, period: { gte: from, lte: to } },
      select: {
        vehicleId: true,
        kind: true,
        period: true,
        date: true,
        amountTiyin: true,
        liters: true,
        odometerKm: true,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    const vehicleIds = [...new Set(records.map((r) => r.vehicleId))];
    const vehicles = await this.prisma.vehicle.findMany({
      where: { OR: [{ deletedAt: null }, { id: { in: vehicleIds } }] },
      orderBy: [{ isActive: 'desc' }, { plateNumber: 'asc' }],
    });

    const monthMap = new Map(months.map((p) => [p, { total: 0n, byKind: emptyKinds() }]));
    const totals = { total: 0n, byKind: emptyKinds(), liters: 0 };

    for (const record of records) {
      const kind = record.kind as VehicleRecordKindValue;
      const month = monthMap.get(record.period);
      if (month) {
        month.total += record.amountTiyin;
        month.byKind[kind] += record.amountTiyin;
      }
      totals.total += record.amountTiyin;
      totals.byKind[kind] += record.amountTiyin;
      totals.liters += record.liters ?? 0;
    }

    const rows: SummaryVehicleRow[] = vehicles.map((vehicle) => {
      const own = records.filter((r) => r.vehicleId === vehicle.id);
      const byKind = emptyKinds();
      let total = 0n;
      let liters = 0;
      for (const record of own) {
        byKind[record.kind as VehicleRecordKindValue] += record.amountTiyin;
        total += record.amountTiyin;
        liters += record.liters ?? 0;
      }

      // Masofa: davrdagi eng kichik va eng katta spidometr ko'rsatkichi
      const readings = own.map((r) => r.odometerKm).filter((v): v is number => v !== null);
      const distance =
        readings.length >= 2 ? Math.max(...readings) - Math.min(...readings) : null;

      // To'liq bak usuli: birinchi quyishdan keyingi litrlar / bosib o'tilgan masofa
      const fills = own
        .filter((r) => r.kind === 'FUEL' && r.odometerKm !== null && (r.liters ?? 0) > 0)
        .sort((a, b) => a.odometerKm! - b.odometerKm!);
      let consumption: number | null = null;
      if (fills.length >= 2) {
        const km = fills[fills.length - 1]!.odometerKm! - fills[0]!.odometerKm!;
        const used = fills.slice(1).reduce((sum, r) => sum + (r.liters ?? 0), 0);
        if (km > 0) consumption = round((used / km) * 100, 2);
      }

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        model: vehicle.model,
        isActive: vehicle.isActive && vehicle.deletedAt === null,
        fuelNorm: vehicle.fuelNorm,
        totalTiyin: total.toString(),
        byKind: kindsToStrings(byKind),
        liters: round(liters, 2),
        distanceKm: distance && distance > 0 ? distance : null,
        consumptionPer100: consumption,
        costPerKmSom: distance && distance > 0 ? Math.round(Number(total) / 100 / distance) : null,
      };
    });

    return {
      from,
      to,
      months: months.map((period) => {
        const month = monthMap.get(period)!;
        return { period, totalTiyin: month.total.toString(), byKind: kindsToStrings(month.byKind) };
      }),
      vehicles: rows,
      totals: {
        totalTiyin: totals.total.toString(),
        byKind: kindsToStrings(totals.byKind),
        liters: round(totals.liters, 2),
      },
    };
  }
}