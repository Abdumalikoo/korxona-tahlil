import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { isXls, readXls, type XlsCell } from '../../common/xls/biff';
import { PrismaService } from '../prisma/prisma.service';
import { VEHICLE_GROUPS, type PaymentMethodValue, type VehicleFuelTypeValue } from './vehicles.types';
import { VehiclesService } from './vehicles.service';

// ═══════════════════════════════════════════════════════════
// Yoqilg'i kartasi hisoboti (AZS: «ОТЧЕТ ПО ПРОДАЖАМ») → mashina xarajatlari (benzin).
// Fayl tuzilishi (doim shunday):
//   «Период с 01.01.2026 по 31.01.2026»; «Всего продажи по ГСМ» — yoqilg'i turlari bo'yicha jami;
//   «Продажи по датам»: Дата | АЗС | ГСМ | Количество | Цена | Сумма | В т.ч. НДС | В т.ч. Акциз
//   tashkilot qatori (shartnoma) → karta qatori «003668 (01 054 OEA)» (karta raqami + davlat raqami)
//   → shu kartaning quyishlari (sana-vaqt, AZS, yoqilg'i, litr, narx, summa).
// Mashina: avval karta raqami, keyin davlat raqami bo'yicha topiladi; topilmasa — yangi mashina yoki tanlash.
// Har quyish — bitta mashina xarajati (FUEL) va Xarajatlarda bitta yozuv. Qayta yuklansa takrorlanmaydi.
// .xls (Excel 97–2003) va .xlsx o'qiladi.
// ═══════════════════════════════════════════════════════════

const MAX_FILE = 10 * 1024 * 1024;

export interface FuelRow {
  key: string;
  /** "2026-01-02T21:02:12" */
  at: string;
  date: string;
  time: string;
  station: string;
  fuel: string;
  fuelType: VehicleFuelTypeValue | null;
  liters: number;
  priceTiyin: string;
  amountTiyin: string;
  vatTiyin: string;
  exists: boolean;
  /** Kelajak sanasi va boshqa sabablar bilan yozilmaydigan qator */
  error: string | null;
}

export interface FuelCard {
  key: string;
  label: string;
  cardNo: string | null;
  plate: string | null;
  liters: number;
  amountTiyin: string;
  /** Fayldagi karta jami (tekshiruv) */
  fileTotalTiyin: string | null;
  totalOk: boolean;
  count: number;
  newCount: number;
  existsCount: number;
  fuels: { fuel: string; liters: number; amountTiyin: string }[];
  firstDate: string | null;
  lastDate: string | null;
  match: { vehicleId: string; plateNumber: string; model: string; by: 'card' | 'plate'; isActive: boolean } | null;
  rows: FuelRow[];
}

export interface FuelAnalysis {
  fileName: string;
  periodFrom: string | null;
  periodTo: string | null;
  organization: string | null;
  totals: { liters: number; amountTiyin: string; vatTiyin: string; count: number; newCount: number; existsCount: number };
  /** Fayldagi «Всего» bilan solishtirish */
  check: { fileTotalTiyin: string | null; ok: boolean };
  byFuel: { fuel: string; liters: number; amountTiyin: string }[];
  cards: FuelCard[];
  warnings: string[];
}

export interface FuelCommitInput {
  fileName?: string;
  paymentMethod?: string;
  cards?: {
    key: string;
    cardNo?: string | null;
    plate?: string | null;
    /** vehicle — bor mashina; new — yangi mashina yaratiladi; skip — o'tkazib yuboriladi */
    action?: 'vehicle' | 'new' | 'skip';
    vehicleId?: string | null;
    newVehicle?: { model?: string; fleetGroup?: string | null; regionCode?: number | null } | null;
    rows?: FuelRow[];
  }[];
}

export interface FuelCommitResult {
  created: number;
  skipped: number;
  vehiclesCreated: number;
  cardsLinked: number;
  amountTiyin: string;
  liters: number;
  errors: { card: string; reason: string }[];
}

// ─────────── Yordamchilar ───────────

const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

/** Davlat raqami kaliti: «01 054 OEA», «01054OEA», kirillcha «01 054 ОЕА» — bir xil */
export function plateKeyOf(value: string): string {
  return [...value.toUpperCase()].map((ch) => LOOKALIKE[ch] ?? ch).join('').replace(/[^0-9A-Z]/g, '');
}

/** «01054OEA» → «01 054 OEA», «01A123BC» → «01 A 123 BC» */
export function formatPlate(value: string): string {
  const k = plateKeyOf(value);
  let m = /^(\d{2})(\d{3})([A-Z]{3})$/.exec(k);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  m = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/.exec(k);
  if (m) return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function fuelTypeOf(name: string): VehicleFuelTypeValue | null {
  const t = name.toUpperCase().replace(/\s+/g, '');
  if (/(АИ|AI|A)-?80/.test(t)) return 'AI80';
  if (/(АИ|AI|A)-?9[12]/.test(t)) return 'AI92';
  if (/(АИ|AI|A)-?9[5-8]|(АИ|AI)-?100/.test(t)) return 'AI95';
  if (/ДТ|ДИЗ|DIZ|DIES|ДИЗЕЛ/.test(t)) return 'DIZEL';
  if (/МЕТАН|METAN|CNG/.test(t)) return 'METAN';
  if (/ПРОПАН|PROPAN|LPG|СУГ/.test(t)) return 'PROPAN';
  return null;
}

function str(v: XlsCell | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function num(v: XlsCell | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = str(v).replace(/[\s ]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toTiyin(som: number): bigint {
  return BigInt(Math.round(som * 100));
}

/** «02.01.2026 21:02:12» | Excel seriya soni | Date → {date, time} */
function parseStamp(v: XlsCell | Date | undefined): { date: string; time: string } | null {
  if (v instanceof Date) {
    const iso = v.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400000);
    const iso = new Date(ms).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(str(v as XlsCell));
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  const day = Number(d);
  const month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(Number(y), month - 1, day));
  if (check.getUTCDate() !== day) return null;
  const p2 = (x: string | number | undefined) => String(x ?? 0).padStart(2, '0');
  return { date: `${y}-${p2(month)}-${p2(day)}`, time: `${p2(h)}:${p2(mi)}:${p2(s)}` };
}

function dmyToIso(t: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function todayIso(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

const HEAD: Record<string, string[]> = {
  date: ['дата', 'sana', 'date'],
  station: ['азс', 'azs', 'заправка', 'shoxobcha'],
  fuel: ['гсм', 'топливо', "yoqilg'i", 'yoqilgi', 'mahsulot'],
  qty: ['количество', 'литр', 'miqdori', 'litr', 'hajmi'],
  price: ['цена', 'narxi', 'narx'],
  sum: ['сумма', 'summa', 'jami'],
  vat: ['в т.ч. ндс', 'ндс', 'qqs'],
};

/** Kartaning sarlavha qatori: «003668 (01 054 OEA)» */
function parseCardLabel(label: string): { cardNo: string | null; plate: string | null } {
  const m = /^\s*([0-9A-Za-z-]{3,})\s*\(\s*([^)]+?)\s*\)\s*$/.exec(label);
  if (m) {
    const inside = m[2]!;
    const looksPlate = /\d/.test(inside) && /[A-Za-zА-Яа-я]/.test(inside) && plateKeyOf(inside).length >= 6;
    return { cardNo: m[1]!, plate: looksPlate ? formatPlate(inside) : null };
  }
  const k = plateKeyOf(label);
  if (/^\d{2}([A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$/.test(k)) return { cardNo: null, plate: formatPlate(label) };
  if (/^\d{4,}$/.test(label.trim())) return { cardNo: label.trim(), plate: null };
  return { cardNo: null, plate: null };
}

@Injectable()
export class VehicleFuelImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly audit: AuditService,
  ) {}

  private async readRows(file: { buffer: Buffer; originalname?: string }): Promise<XlsCell[][]> {
    if (isXls(file.buffer)) {
      try {
        const sheets = readXls(file.buffer);
        const best = sheets.sort((a, b) => b.rows.length - a.rows.length)[0];
        if (!best) throw new Error('Varaq topilmadi');
        return best.rows;
      } catch (e) {
        throw new BadRequestException(`Faylni o'qib bo'lmadi: ${(e as Error).message}`);
      }
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xls yoki .xlsx bo'lsin");
    }
    const ws = wb.worksheets.sort((a, b) => b.rowCount - a.rowCount)[0];
    if (!ws) throw new BadRequestException('Faylda varaq yo‘q');
    const rows: XlsCell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const out: XlsCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        let v = cell.value as unknown;
        if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result;
        if (v && typeof v === 'object' && 'richText' in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
        if (v instanceof Date) {
          const iso = v.toISOString();
          v = `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
        }
        out[c - 1] = v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
      });
      rows[n - 1] = out;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return rows;
  }

  async analyze(file: { buffer: Buffer; size: number; originalname?: string } | undefined): Promise<FuelAnalysis> {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_FILE) throw new BadRequestException('Fayl 10 MB dan katta');
    const rows = await this.readRows(file);
    const warnings: string[] = [];

    // Sarlavha qatori
    const lower = (r: XlsCell[]) => r.map((c) => str(c).toLowerCase());
    const headIdx = rows.findIndex((r) => {
      const l = lower(r);
      return HEAD.date!.some((h) => l.includes(h)) && (HEAD.station!.some((h) => l.includes(h)) || HEAD.fuel!.some((h) => l.includes(h)));
    });
    if (headIdx < 0) throw new BadRequestException("Hisobot shakli tanilmadi: «Дата | АЗС | ГСМ | Количество | Цена | Сумма» sarlavhasi topilmadi");
    const head = lower(rows[headIdx]!);
    const col = (k: keyof typeof HEAD) => {
      const i = head.findIndex((h) => HEAD[k]!.some((x) => h === x));
      return i >= 0 ? i : head.findIndex((h) => HEAD[k]!.some((x) => h.startsWith(x)));
    };
    const C = { date: col('date'), station: col('station'), fuel: col('fuel'), qty: col('qty'), price: col('price'), sum: col('sum'), vat: col('vat') };
    if (C.date < 0 || C.qty < 0 || C.sum < 0) throw new BadRequestException('Sana, miqdor yoki summa ustuni topilmadi');

    // Davr va «Всего»
    let periodFrom: string | null = null;
    let periodTo: string | null = null;
    let fileTotal: bigint | null = null;
    for (let i = 0; i < headIdx; i++) {
      const t = rows[i]!.map(str).join(' ');
      const p = /(\d{2}\.\d{2}\.\d{4})\D+(\d{2}\.\d{2}\.\d{4})/.exec(t);
      if (p && /период|davr|с\s/i.test(t) && !periodFrom) {
        periodFrom = dmyToIso(p[1]!);
        periodTo = dmyToIso(p[2]!);
      }
      if (/^(всего|jami)$/i.test(str(rows[i]![0]))) {
        const nums = rows[i]!.map((c) => (typeof c === 'number' ? c : null)).filter((x): x is number => x !== null);
        // «Всего»: Количество, Сумма, НДС, Акциз — summa ikkinchi son
        if (nums.length >= 2) fileTotal = toTiyin(nums[1]!);
      }
    }

    // Kartalar va quyishlar
    const vehicles = await this.prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true, model: true, fuelCardNo: true, isActive: true } });
    const byCard = new Map(vehicles.filter((v) => v.fuelCardNo).map((v) => [v.fuelCardNo!.replace(/\s+/g, ''), v]));
    const byPlate = new Map(vehicles.map((v) => [plateKeyOf(v.plateNumber), v]));

    let organization: string | null = null;
    const cards: (FuelCard & { _sum: bigint })[] = [];
    let current: (FuelCard & { _sum: bigint }) | null = null;
    const today = todayIso();

    for (let i = headIdx + 1; i < rows.length; i++) {
      const r = rows[i]!;
      const first = r[C.date];
      const stamp = parseStamp(first ?? undefined);
      const qty = num(r[C.qty]);
      const sum = num(r[C.sum]);
      const station = C.station >= 0 ? str(r[C.station]) : '';
      const fuel = C.fuel >= 0 ? str(r[C.fuel]) : '';
      if (!stamp) {
        const label = str(first);
        if (!label) continue;
        if (/^(всего|итого|jami)/i.test(label)) continue;
        const parsed = parseCardLabel(label);
        if (!parsed.cardNo && !parsed.plate) {
          // Tashkilot / shartnoma qatori
          if (!organization) organization = label;
          continue;
        }
        const key = parsed.cardNo ? `card:${parsed.cardNo}` : `plate:${plateKeyOf(parsed.plate!)}`;
        const prev = cards.find((c) => c.key === key);
        if (prev) {
          current = prev;
          if (sum !== null) prev.fileTotalTiyin = (BigInt(prev.fileTotalTiyin ?? '0') + toTiyin(sum)).toString();
          continue;
        }
        const v = (parsed.cardNo ? byCard.get(parsed.cardNo) : undefined) ?? (parsed.plate ? byPlate.get(plateKeyOf(parsed.plate)) : undefined);
        current = {
          key,
          label,
          cardNo: parsed.cardNo,
          plate: parsed.plate,
          liters: 0,
          amountTiyin: '0',
          fileTotalTiyin: sum !== null ? toTiyin(sum).toString() : null,
          totalOk: true,
          count: 0,
          newCount: 0,
          existsCount: 0,
          fuels: [],
          firstDate: null,
          lastDate: null,
          match: v ? { vehicleId: v.id, plateNumber: v.plateNumber, model: v.model, by: parsed.cardNo && byCard.get(parsed.cardNo) ? 'card' : 'plate', isActive: v.isActive } : null,
          rows: [],
          _sum: 0n,
        };
        cards.push(current);
        continue;
      }
      if (qty === null || sum === null) continue;
      if (!current) {
        warnings.push(`${i + 1}-qator: karta (mashina) qatoridan oldin keldi — o'tkazib yuborildi`);
        continue;
      }
      const amount = toTiyin(sum);
      const price = C.price >= 0 ? num(r[C.price]) : null;
      const vat = C.vat >= 0 ? num(r[C.vat]) : null;
      const at = `${stamp.date}T${stamp.time}`;
      const ident = current.cardNo ?? plateKeyOf(current.plate ?? '');
      const key = `FUEL:${ident}:${at}:${qty}:${amount}`;
      current.rows.push({
        key,
        at,
        date: stamp.date,
        time: stamp.time,
        station: station.replace(/\s+/g, ' '),
        fuel,
        fuelType: fuelTypeOf(fuel),
        liters: qty,
        priceTiyin: price !== null ? toTiyin(price).toString() : qty ? (amount / BigInt(Math.max(1, Math.round(qty)))).toString() : '0',
        amountTiyin: amount.toString(),
        vatTiyin: vat !== null ? toTiyin(vat).toString() : '0',
        exists: false,
        error: stamp.date > today ? 'kelajak sanasi' : amount <= 0n ? "summa 0" : null,
      });
      current._sum += amount;
    }

    // Bazada bormi (importKey)
    const allKeys = cards.flatMap((c) => c.rows.map((r) => r.key));
    const existing = new Set<string>();
    for (let i = 0; i < allKeys.length; i += 1000) {
      const part = allKeys.slice(i, i + 1000);
      const found = await this.prisma.vehicleRecord.findMany({ where: { importKey: { in: part }, deletedAt: null }, select: { importKey: true } });
      for (const f of found) existing.add(f.importKey!);
    }

    const byFuel = new Map<string, { liters: number; amount: bigint }>();
    let totalLiters = 0;
    let total = 0n;
    let vatTotal = 0n;
    let count = 0;
    let newCount = 0;
    let existsCount = 0;
    for (const c of cards) {
      const fuels = new Map<string, { liters: number; amount: bigint }>();
      for (const r of c.rows) {
        r.exists = existing.has(r.key);
        c.count += 1;
        c.liters += r.liters;
        if (r.exists) c.existsCount += 1;
        else if (!r.error) c.newCount += 1;
        const f = fuels.get(r.fuel) ?? { liters: 0, amount: 0n };
        f.liters += r.liters;
        f.amount += BigInt(r.amountTiyin);
        fuels.set(r.fuel, f);
        const g = byFuel.get(r.fuel) ?? { liters: 0, amount: 0n };
        g.liters += r.liters;
        g.amount += BigInt(r.amountTiyin);
        byFuel.set(r.fuel, g);
        vatTotal += BigInt(r.vatTiyin);
        c.firstDate = !c.firstDate || r.date < c.firstDate ? r.date : c.firstDate;
        c.lastDate = !c.lastDate || r.date > c.lastDate ? r.date : c.lastDate;
      }
      c.amountTiyin = c._sum.toString();
      c.liters = Math.round(c.liters * 1000) / 1000;
      c.totalOk = c.fileTotalTiyin === null || c.fileTotalTiyin === c.amountTiyin;
      if (!c.totalOk) warnings.push(`${c.label}: fayldagi jami ${Number(c.fileTotalTiyin) / 100} so'm, quyishlar yig'indisi ${Number(c.amountTiyin) / 100} so'm — farq bor`);
      if (c.match && !c.match.isActive) warnings.push(`${c.label}: ${c.match.plateNumber} faol emas — yozish uchun avval faollashtiring yoki boshqa mashinani tanlang`);
      c.fuels = [...fuels.entries()].map(([fuel, v]) => ({ fuel, liters: Math.round(v.liters * 1000) / 1000, amountTiyin: v.amount.toString() }));
      totalLiters += c.liters;
      total += c._sum;
      count += c.count;
      newCount += c.newCount;
      existsCount += c.existsCount;
    }
    if (!cards.length) throw new BadRequestException("Faylda karta (mashina) qatorlari topilmadi");
    const futures = cards.reduce((s, c) => s + c.rows.filter((r) => r.error === 'kelajak sanasi').length, 0);
    if (futures) warnings.push(`${futures} ta quyish kelajak sanasida — yozilmaydi`);
    const ok = fileTotal === null || fileTotal === total;
    if (!ok) warnings.unshift(`Fayldagi «Всего» ${Number(fileTotal) / 100} so'm, quyishlar yig'indisi ${Number(total) / 100} so'm — fayl to'liq emas bo'lishi mumkin`);

    return {
      fileName: (file.originalname ?? 'fayl').slice(0, 200),
      periodFrom,
      periodTo,
      organization,
      totals: { liters: Math.round(totalLiters * 1000) / 1000, amountTiyin: total.toString(), vatTiyin: vatTotal.toString(), count, newCount, existsCount },
      check: { fileTotalTiyin: fileTotal === null ? null : fileTotal.toString(), ok },
      byFuel: [...byFuel.entries()].map(([fuel, v]) => ({ fuel, liters: Math.round(v.liters * 1000) / 1000, amountTiyin: v.amount.toString() })),
      cards: cards.map(({ _sum, ...c }) => c),
      warnings,
    };
  }

  async commit(input: FuelCommitInput, userId: string): Promise<FuelCommitResult> {
    const cards = Array.isArray(input?.cards) ? input.cards : [];
    if (!cards.length) throw new BadRequestException("Yoziladigan karta yo'q");
    const method = (['CASH', 'BANK', 'CARD', 'OTHER'] as const).includes(input.paymentMethod as PaymentMethodValue) ? (input.paymentMethod as PaymentMethodValue) : 'BANK';
    const result: FuelCommitResult = { created: 0, skipped: 0, vehiclesCreated: 0, cardsLinked: 0, amountTiyin: '0', liters: 0, errors: [] };
    let amount = 0n;
    let liters = 0;
    const today = todayIso();

    for (const card of cards) {
      const label = card.cardNo ? `Karta ${card.cardNo}` : (card.plate ?? card.key);
      if (card.action === 'skip') {
        result.skipped += card.rows?.length ?? 0;
        continue;
      }
      const rows = (Array.isArray(card.rows) ? card.rows : []).filter((r) => r && typeof r.key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= today);
      if (!rows.length) continue;

      // Mashina
      let vehicleId: string | null = null;
      if (card.action === 'new') {
        const plate = card.plate ? formatPlate(card.plate) : null;
        if (!plate) {
          result.errors.push({ card: label, reason: "davlat raqami yo'q — mavjud mashinani tanlang" });
          continue;
        }
        const fuelCount = new Map<string, number>();
        for (const r of rows) if (r.fuelType) fuelCount.set(r.fuelType, (fuelCount.get(r.fuelType) ?? 0) + r.liters);
        const fuelType = [...fuelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'AI92';
        const group = card.newVehicle?.fleetGroup && VEHICLE_GROUPS.some((g) => g.value === card.newVehicle!.fleetGroup) ? card.newVehicle.fleetGroup : null;
        try {
          const created = await this.vehicles.create(
            {
              plateNumber: plate.replace(/[^0-9A-Z ]/g, ''),
              model: card.newVehicle?.model?.trim() || "Rusumi kiritilmagan",
              fuelType,
              regionCode: card.newVehicle?.regionCode ?? 0,
              fleetGroup: group,
              fuelCardNo: card.cardNo ?? null,
              note: `Yoqilg'i hisobotidan yaratildi (${input.fileName ?? 'fayl'})`.slice(0, 500),
            },
            userId,
          );
          vehicleId = created.id;
          result.vehiclesCreated += 1;
        } catch (e) {
          result.errors.push({ card: label, reason: (e as Error).message });
          continue;
        }
      } else {
        const v = card.vehicleId ? await this.prisma.vehicle.findFirst({ where: { id: card.vehicleId, deletedAt: null } }) : null;
        if (!v) {
          result.errors.push({ card: label, reason: 'mashina tanlanmagan' });
          continue;
        }
        if (!v.isActive) {
          result.errors.push({ card: label, reason: `${v.plateNumber} faol emas` });
          continue;
        }
        vehicleId = v.id;
        if (card.cardNo && v.fuelCardNo !== card.cardNo) {
          // Karta boshqa mashinada bo'lsa — o'sha yerdan olinadi (karta bir mashinada)
          await this.prisma.vehicle.updateMany({ where: { fuelCardNo: card.cardNo, id: { not: v.id } }, data: { fuelCardNo: null } });
          await this.prisma.vehicle.update({ where: { id: v.id }, data: { fuelCardNo: card.cardNo } });
          result.cardsLinked += 1;
        }
      }

      // Quyishlar
      const keys = rows.map((r) => r.key);
      const found = await this.prisma.vehicleRecord.findMany({ where: { importKey: { in: keys } }, select: { id: true, importKey: true, deletedAt: true } });
      // O'chirilgan yozuvning kaliti bo'shatiladi — qayta yozish mumkin
      const freed = found.filter((x) => x.deletedAt).map((x) => x.id);
      if (freed.length) await this.prisma.vehicleRecord.updateMany({ where: { id: { in: freed } }, data: { importKey: null } });
      const have = new Set(found.filter((x) => !x.deletedAt).map((x) => x.importKey!));
      for (const r of rows) {
        if (have.has(r.key)) {
          result.skipped += 1;
          continue;
        }
        const sum = BigInt(String(r.amountTiyin).replace(/\D/g, '') || '0');
        if (sum <= 0n || !(r.liters > 0) || r.liters > 2000) {
          result.skipped += 1;
          continue;
        }
        const price = Number(r.priceTiyin) / 100;
        const desc = `${r.fuel || "Yoqilg'i"} · ${r.liters} l × ${price.toLocaleString('ru-RU').replace(/,/g, ' ')} · ${r.time.slice(0, 5)}`;
        try {
          await this.vehicles.createImportedFuel(
            {
              vehicleId: vehicleId!,
              kind: 'FUEL',
              date: r.date,
              amountTiyin: sum.toString(),
              liters: r.liters,
              description: desc.slice(0, 300),
              counterparty: r.station ? `AZS: ${r.station}`.slice(0, 150) : null,
              documentNo: card.cardNo ? `Karta ${card.cardNo}` : null,
              paymentMethod: method,
            },
            r.key.slice(0, 190),
            userId,
          );
          result.created += 1;
          amount += sum;
          liters += r.liters;
        } catch (e) {
          result.errors.push({ card: label, reason: `${r.date} ${r.time}: ${(e as Error).message}` });
        }
      }
    }
    result.amountTiyin = amount.toString();
    result.liters = Math.round(liters * 1000) / 1000;
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'vehicle_record',
      entityId: (input.fileName ?? 'fuel').slice(0, 100),
      summary: `Yoqilg'i hisoboti yuklandi: ${result.created} ta quyish, ${result.liters} l, ${Number(amount) / 100} so'm${result.vehiclesCreated ? `, yangi mashina: ${result.vehiclesCreated}` : ''}`,
    });
    return result;
  }
}