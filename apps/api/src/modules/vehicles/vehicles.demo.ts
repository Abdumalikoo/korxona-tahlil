import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from './vehicles.service';
import {
  CENTRAL_REGION,
  VEHICLE_CATEGORIES,
  type PaymentMethodValue,
  type VehicleFuelTypeValue,
  type VehicleRecordKindValue,
} from './vehicles.types';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Demo: 13 ta namunaviy mashina (4 guruh) va oxirgi 3 oy xarajatlari.
// Hammasi haqiqiy yozuv sifatida bazaga tushadi (Xarajatlarga ham) — bo'limni sinab ko'rish uchun.
// Belgi: davlat raqami «DEMO …», izoh «[DEMO] …», xarajat izohi «demo».
// «Demoni o'chirish» — mashinalar, ularning yozuvlari va Xarajatlardagi yozuvlar butunlay o'chadi.
// ═══════════════════════════════════════════════════════════

export const DEMO_MARK = '[DEMO]';
const DEMO_NOTE = `${DEMO_MARK} Namuna ma'lumot — Mashinalar › Ro'yxat › «Demoni o'chirish» bilan o'chadi`;
const DEMO_TEXT = 'demo';

interface DemoCar {
  plate: string;
  model: string;
  year: number;
  color: string;
  fuel: VehicleFuelTypeValue;
  norm: number;
  group: 'TOSHKENT' | 'MARKSHEYDER' | 'RAHBARIYAT' | 'QOSHIMCHA';
  driver: string;
  /** Kuniga o'rtacha km */
  kmPerDay: number;
  /** Haqiqiy sarf / me'yor (1.15 — me'yordan oshgan, hisobotda qizil chiqadi) */
  factor: number;
  odometer: number;
}

const CARS: DemoCar[] = [
  { plate: 'DEMO 01', model: 'Chevrolet Cobalt', year: 2021, color: 'Oq', fuel: 'AI92', norm: 7.5, group: 'TOSHKENT', driver: 'Karimov Jasur', kmPerDay: 85, factor: 1.02, odometer: 84_300 },

  { plate: 'DEMO 02', model: 'LADA Niva (4x4)', year: 2020, color: 'Yashil', fuel: 'AI92', norm: 11, group: 'MARKSHEYDER', driver: 'Toshmatov Bobur', kmPerDay: 120, factor: 1.0, odometer: 121_500 },
  { plate: 'DEMO 03', model: 'UAZ Patriot', year: 2019, color: 'Kulrang', fuel: 'AI92', norm: 15, group: 'MARKSHEYDER', driver: 'Rahimov Sardor', kmPerDay: 110, factor: 1.16, odometer: 163_200 },
  { plate: 'DEMO 04', model: 'Chevrolet Damas', year: 2022, color: 'Oq', fuel: 'METAN', norm: 9, group: 'MARKSHEYDER', driver: 'Yusupov Akmal', kmPerDay: 95, factor: 0.98, odometer: 58_900 },
  { plate: 'DEMO 05', model: 'Chevrolet Tracker', year: 2023, color: 'Qora', fuel: 'AI92', norm: 8, group: 'MARKSHEYDER', driver: 'Nazarov Otabek', kmPerDay: 100, factor: 1.04, odometer: 41_700 },

  { plate: 'DEMO 06', model: 'Chevrolet Malibu 2', year: 2022, color: 'Qora', fuel: 'AI95', norm: 9.5, group: 'RAHBARIYAT', driver: 'Ergashev Shoxrux', kmPerDay: 65, factor: 1.03, odometer: 67_400 },
  { plate: 'DEMO 07', model: 'Chevrolet Captiva', year: 2021, color: 'Kulrang', fuel: 'AI95', norm: 11, group: 'RAHBARIYAT', driver: 'Qodirov Dilshod', kmPerDay: 55, factor: 0.99, odometer: 92_800 },
  { plate: 'DEMO 08', model: 'Chevrolet Tracker', year: 2023, color: 'Oq', fuel: 'AI92', norm: 8, group: 'RAHBARIYAT', driver: 'Saidov Ulug\'bek', kmPerDay: 60, factor: 1.12, odometer: 33_100 },
  { plate: 'DEMO 09', model: 'Chevrolet Onix', year: 2024, color: 'Kumush', fuel: 'AI92', norm: 6.5, group: 'RAHBARIYAT', driver: 'Mirzayev Aziz', kmPerDay: 50, factor: 1.01, odometer: 18_600 },

  { plate: 'DEMO 10', model: 'Chevrolet Damas', year: 2020, color: 'Oq', fuel: 'METAN', norm: 9, group: 'QOSHIMCHA', driver: 'Xolmatov Behzod', kmPerDay: 75, factor: 1.05, odometer: 139_700 },
  { plate: 'DEMO 11', model: 'Chevrolet Labo', year: 2021, color: 'Oq', fuel: 'PROPAN', norm: 10, group: 'QOSHIMCHA', driver: 'Abdullayev Sherzod', kmPerDay: 70, factor: 1.0, odometer: 97_200 },
  { plate: 'DEMO 12', model: 'Chevrolet Cobalt', year: 2019, color: 'Kumush', fuel: 'METAN', norm: 8, group: 'QOSHIMCHA', driver: 'Tursunov Farrux', kmPerDay: 80, factor: 1.18, odometer: 176_400 },
  { plate: 'DEMO 13', model: 'Chevrolet Gentra', year: 2020, color: 'Oq', fuel: 'AI92', norm: 8.5, group: 'QOSHIMCHA', driver: 'Hasanov Islom', kmPerDay: 70, factor: 1.03, odometer: 128_900 },
];

/** 1 litr (m³) narxi, so'm */
const FUEL_PRICE: Record<VehicleFuelTypeValue, number> = {
  AI80: 8_500,
  AI92: 10_400,
  AI95: 12_600,
  DIZEL: 11_200,
  METAN: 4_600,
  PROPAN: 6_300,
  ELEKTR: 1_000,
};
const FUEL_PLACES: Record<VehicleFuelTypeValue, string[]> = {
  AI80: ['UzGazOil AZS'],
  AI92: ['UzGazOil AZS', 'Mustang AZS', 'Lukoil AZS'],
  AI95: ['Lukoil AZS', 'Mustang AZS'],
  DIZEL: ['UzGazOil AZS'],
  METAN: ['Metan shoxobchasi (Sergeli)', 'Metan shoxobchasi (Qo\'yliq)'],
  PROPAN: ['Propan shoxobchasi'],
  ELEKTR: ['Zaryadlash stansiyasi'],
};
const WASHES = ['Avtomoyka «Chilonzor»', 'Avtomoyka «Yunusobod»'];
const SERVICES = ['Chevrolet rasmiy servis', 'Avtoservis «Usta»'];
const REPAIRS: Array<[string, number, number]> = [
  ['Tormoz kolodkalari almashtirildi', 280_000, 450_000],
  ['Akkumulyator almashtirildi', 900_000, 1_300_000],
  ['Shina ta\'mirlandi (vulkanizatsiya)', 60_000, 120_000],
  ['Old amortizator almashtirildi', 650_000, 1_100_000],
  ['Generator tasmasi almashtirildi', 180_000, 320_000],
];

/** Takrorlanuvchi tasodifiy sonlar (har safar bir xil demo chiqsin) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tashkentToday(): Date {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** So'mni 100 ga yaxlitlab tiyinga */
function toTiyin(som: number): bigint {
  return BigInt(Math.round(som / 100) * 100) * 100n;
}

interface DemoRecord {
  kind: VehicleRecordKindValue;
  date: Date;
  amountTiyin: bigint;
  liters: number | null;
  odometerKm: number | null;
  counterparty: string;
  description: string;
  paymentMethod: PaymentMethodValue;
}

export interface DemoStatus {
  vehicles: number;
  records: number;
  totalTiyin: string;
}

@Injectable()
export class VehiclesDemo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly audit: AuditService,
  ) {}

  private demoWhere() {
    return { note: { startsWith: DEMO_MARK } };
  }

  async status(): Promise<DemoStatus> {
    const cars = await this.prisma.vehicle.findMany({ where: this.demoWhere(), select: { id: true } });
    if (cars.length === 0) return { vehicles: 0, records: 0, totalTiyin: '0' };
    const records = await this.prisma.vehicleRecord.findMany({
      where: { vehicleId: { in: cars.map((c) => c.id) }, deletedAt: null },
      select: { amountTiyin: true },
    });
    const total = records.reduce((sum, r) => sum + r.amountTiyin, 0n);
    return { vehicles: cars.length, records: records.length, totalTiyin: total.toString() };
  }

  /** Bir mashina uchun 3 oylik yozuvlar: yoqilg'i (4–6 kunda), moyka (~2 haftada), texnik xizmat, ta'mir */
  private recordsFor(car: DemoCar, index: number, start: Date, today: Date): DemoRecord[] {
    const rand = rng(20261007 + index * 7919);
    const between = (min: number, max: number) => min + rand() * (max - min);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
    const result: DemoRecord[] = [];

    // Yoqilg'i: har quyishda oldingi quyishdan beri yurilgan km bo'yicha
    let odometer = car.odometer;
    let day = start;
    const fuelPlace = pick(FUEL_PLACES[car.fuel]);
    let first = true;
    while (day <= today) {
      const gap = first ? 0 : Math.round(between(4, 6));
      const date = addDays(day, gap);
      if (date > today) break;
      const km = first ? 0 : Math.round(car.kmPerDay * gap * between(0.85, 1.15));
      odometer += km;
      const liters = first
        ? Math.round(between(25, 40) * 10) / 10
        : Math.round(((km * car.norm) / 100) * car.factor * between(0.97, 1.03) * 10) / 10;
      result.push({
        kind: 'FUEL',
        date,
        amountTiyin: toTiyin(liters * FUEL_PRICE[car.fuel]),
        liters,
        odometerKm: odometer,
        counterparty: rand() < 0.8 ? fuelPlace : pick(FUEL_PLACES[car.fuel]),
        description: DEMO_TEXT,
        paymentMethod: 'CARD',
      });
      day = date;
      first = false;
    }

    // Moyka: ~har 2 haftada
    for (let d = addDays(start, Math.round(between(2, 8))); d <= today; d = addDays(d, Math.round(between(11, 17)))) {
      result.push({
        kind: 'WASH',
        date: d,
        amountTiyin: toTiyin(car.group === 'RAHBARIYAT' ? between(60_000, 80_000) : between(35_000, 55_000)),
        liters: null,
        odometerKm: null,
        counterparty: pick(WASHES),
        description: DEMO_TEXT,
        paymentMethod: 'CASH',
      });
    }

    // Texnik xizmat (moy, filtrlar): 3 oyda bir marta
    const fuelDays = result.filter((r) => r.kind === 'FUEL');
    const serviceAt = fuelDays[Math.floor(between(0.2, 0.8) * fuelDays.length)];
    if (serviceAt) {
      result.push({
        kind: 'SERVICE',
        date: serviceAt.date,
        amountTiyin: toTiyin(between(450_000, 850_000)),
        liters: null,
        odometerKm: serviceAt.odometerKm,
        counterparty: pick(SERVICES),
        description: `Moy va filtrlar almashtirildi — ${DEMO_TEXT}`,
        paymentMethod: 'BANK',
      });
    }

    // Ta'mir: har ikkinchi mashinada bittadan
    if (index % 2 === 0 || car.factor > 1.1) {
      const at = fuelDays[Math.floor(rand() * fuelDays.length)];
      const [what, min, max] = pick(REPAIRS);
      if (at) {
        result.push({
          kind: 'REPAIR',
          date: at.date,
          amountTiyin: toTiyin(between(min, max)),
          liters: null,
          odometerKm: null,
          counterparty: pick(SERVICES),
          description: `${what} — ${DEMO_TEXT}`,
          paymentMethod: 'CASH',
        });
      }
    }

    return result;
  }

  async create(userId: string): Promise<DemoStatus> {
    const existing = await this.prisma.vehicle.count({ where: this.demoWhere() });
    if (existing > 0) throw new ConflictException("Demo allaqachon qo'shilgan. Avval «Demoni o'chirish»ni bosing");

    const plates = await this.prisma.vehicle.findMany({ where: { deletedAt: null }, select: { plateNumber: true } });
    const taken = new Set(plates.map((p) => p.plateNumber.replace(/[\s-]/g, '')));
    const clash = CARS.find((c) => taken.has(c.plate.replace(/[\s-]/g, '')));
    if (clash) throw new ConflictException(`${clash.plate} raqamli mashina bor — demo qo'shilmadi`);

    await this.vehicles.ensureCategories();

    const today = tashkentToday();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    const now = Date.now();

    const vehicleRows: Array<Record<string, unknown>> = [];
    const expenseRows: Array<Record<string, unknown>> = [];
    const recordRows: Array<Record<string, unknown>> = [];

    CARS.forEach((car, index) => {
      const vehicleId = randomUUID();
      vehicleRows.push({
        id: vehicleId,
        plateNumber: car.plate,
        model: car.model,
        year: car.year,
        color: car.color,
        fuelType: car.fuel,
        fuelNorm: car.norm,
        regionCode: CENTRAL_REGION,
        driverName: car.driver,
        initialOdometerKm: car.odometer,
        isActive: true,
        note: DEMO_NOTE,
        fleetGroup: car.group,
        createdById: userId,
      });

      this.recordsFor(car, index, start, today).forEach((r, n) => {
        const expenseId = randomUUID();
        const createdAt = new Date(now + index * 1000 + n);
        expenseRows.push({
          id: expenseId,
          date: r.date,
          period: periodOf(r.date),
          amountTiyin: r.amountTiyin,
          categoryCode: VEHICLE_CATEGORIES[r.kind].code,
          regionCode: CENTRAL_REGION,
          description: this.vehicles.expenseText({ plateNumber: car.plate, model: car.model }, r.kind, r.liters, r.description),
          paymentMethod: r.paymentMethod,
          counterparty: r.counterparty,
          paymentStatus: 'PAID',
          source: 'VEHICLE',
          section: 'DOIMIY',
          createdById: userId,
          createdAt,
        });
        recordRows.push({
          vehicleId,
          kind: r.kind,
          date: r.date,
          period: periodOf(r.date),
          amountTiyin: r.amountTiyin,
          liters: r.liters,
          odometerKm: r.odometerKm,
          description: r.description,
          counterparty: r.counterparty,
          paymentMethod: r.paymentMethod,
          expenseId,
          createdById: userId,
          createdAt,
        });
      });
    });

    await this.prisma.$transaction(
      async (tx) => {
        await tx.vehicle.createMany({ data: vehicleRows as never });
        await tx.expense.createMany({ data: expenseRows as never });
        await tx.vehicleRecord.createMany({ data: recordRows as never });
      },
      { timeout: 120_000 },
    );

    const status = await this.status();
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'vehicle',
      entityId: 'demo',
      summary: `Mashinalar demo qo'shildi: ${status.vehicles} ta mashina, ${status.records} ta xarajat — ${BigInt(status.totalTiyin) / 100n} so'm`,
    });
    return status;
  }

  /** Demo mashinalar, ularning yozuvlari va Xarajatlardagi yozuvlar butunlay o'chiriladi */
  async remove(userId: string): Promise<DemoStatus> {
    const before = await this.status();
    const cars = await this.prisma.vehicle.findMany({ where: this.demoWhere(), select: { id: true } });
    if (cars.length === 0) return before;
    const ids = cars.map((c) => c.id);
    const records = await this.prisma.vehicleRecord.findMany({
      where: { vehicleId: { in: ids } },
      select: { expenseId: true },
    });
    const expenseIds = records.map((r) => r.expenseId).filter((id): id is string => Boolean(id));

    await this.prisma.$transaction(
      async (tx) => {
        await tx.vehicleRecord.deleteMany({ where: { vehicleId: { in: ids } } });
        if (expenseIds.length) await tx.expense.deleteMany({ where: { id: { in: expenseIds }, source: 'VEHICLE' } });
        await tx.vehicle.deleteMany({ where: { id: { in: ids } } });
      },
      { timeout: 120_000 },
    );

    await this.audit.log({
      userId,
      action: 'DELETE',
      entity: 'vehicle',
      entityId: 'demo',
      summary: `Mashinalar demo o'chirildi: ${before.vehicles} ta mashina, ${before.records} ta xarajat`,
    });
    return { vehicles: 0, records: 0, totalTiyin: '0' };
  }
}