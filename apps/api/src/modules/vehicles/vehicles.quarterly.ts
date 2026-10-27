import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { isXls, readXls, type XlsCell } from '../../common/xls/biff';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatPlate, plateKeyOf } from './vehicles.fuel-import';
import { VehiclesService } from './vehicles.service';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Choraklik hisobot («24-ilova»: xizmat avtotransport vositalari to'g'risida MA'LUMOTLAR).
//   • Ustunlar: T/r · Tashkilot · Rusumi · Davlat raqami · Ishlab chiqarilgan yili · Balansga olingan vaqti ·
//     Soni · Balans qiymati · Saqlash xarajatlari · Jihozlash xarajatlari · Harakatlangan masofa (davrda, jami).
//   • XARAJATGA faqat «Jihozlash xarajatlari» yoziladi — mashinaning TA'MIRLASH xarajati (chorak oxirgi kuni),
//     mashina biriktirilgan bo'limga avtomatik. «Saqlash xarajatlari» — benzin bilan bir xil (benzin hisobotidan
//     allaqachon yozilgan), shuning uchun hisobga olinmaydi.
//   • Qolgan ustunlar (balans qiymati, masofa, yili …) — statistika/manba sifatida saqlanadi (vehicles.quarterly).
//   • Qayta yuklash — o'sha chorak almashtiriladi (ikki marta yozilmaydi).
// Summalar shaklda odatda MING so'mda.
// ═══════════════════════════════════════════════════════════

const KEY = 'vehicles.quarterly';
const MAX_FILE = 10 * 1024 * 1024;

export type QuarterScale = 'THOUSAND' | 'SOM';

export interface QuarterRow {
  n: number;
  org: string;
  model: string;
  plate: string;
  plateKey: string;
  madeYear: number | null;
  balanceYear: number | null;
  count: number | null;
  /** Tiyin (shkala qo'llangan) */
  balanceValueTiyin: string;
  storageTiyin: string;
  equipTiyin: string;
  distancePeriodKm: number | null;
  distanceTotalKm: number | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
}

export interface QuarterAnalysis {
  year: number | null;
  quarter: number | null;
  scale: QuarterScale;
  rows: QuarterRow[];
  warnings: string[];
  exists: boolean;
}

export interface QuarterStored {
  key: string;
  year: number;
  quarter: number;
  fileName: string;
  scale: QuarterScale;
  savedAt: string;
  savedBy: string;
  rows: QuarterRow[];
  /** Ta'mirlashga yozilgan jami (tiyin) */
  repairTiyin: string;
  records: number;
}

const str = (v: XlsCell | undefined) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

/** «51 375,71» · 1371.4 · «1 371,4» → son */
function num(v: XlsCell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[\s ]/g, '');
  if (!t) return null;
  const normalized = /,\d{1,3}$/.test(t) && !/\.\d/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const int = (v: XlsCell | undefined) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

const lastDay = (year: number, quarter: number) => {
  const month = quarter * 3;
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const qKey = (year: number, quarter: number) => `${year}-Q${quarter}`;

@Injectable()
export class VehicleQuarterlyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly audit: AuditService,
  ) {}

  private async readRows(buffer: Buffer): Promise<XlsCell[][]> {
    if (isXls(buffer)) {
      try {
        const best = readXls(buffer).sort((a, b) => b.rows.length - a.rows.length)[0];
        if (!best) throw new Error('Varaq topilmadi');
        return best.rows;
      } catch (e) {
        throw new BadRequestException(`Faylni o'qib bo'lmadi: ${(e as Error).message}`);
      }
    }
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(buffer);
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
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
        if (v instanceof Date) v = v.getUTCFullYear();
        out[c - 1] = v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'boolean' ? (v as number) : String(v);
      });
      rows[n - 1] = out;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return rows;
  }

  private async store(): Promise<Record<string, QuarterStored>> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const v = row?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as unknown as Record<string, QuarterStored>) : {};
  }

  private async save(map: Record<string, QuarterStored>) {
    const value = map as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  }

  /** Fayl o'qiladi — hech narsa yozilmaydi */
  async analyze(file: { buffer: Buffer; size: number; originalname?: string } | undefined, scaleInput?: string): Promise<QuarterAnalysis> {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_FILE) throw new BadRequestException('Fayl 10 MB dan katta');
    const rows = await this.readRows(file.buffer);
    const warnings: string[] = [];
    const lower = (r: XlsCell[]) => r.map((c) => str(c).toLowerCase());

    // Yil va chorak: «2026-yilining 1 choragi»
    let year: number | null = null;
    let quarter: number | null = null;
    for (const r of rows.slice(0, 12)) {
      for (const c of r) {
        const m = /(\d{4})\s*-?\s*yil\S*\s*(\d)\s*-?\s*chorag/i.exec(str(c));
        if (m) {
          year = Number(m[1]);
          quarter = Number(m[2]);
        }
      }
    }
    if (quarter !== null && (quarter < 1 || quarter > 4)) quarter = null;

    const headIdx = rows.findIndex((r) => lower(r).some((x) => x.includes('davlat raqami')));
    if (headIdx < 0) throw new BadRequestException("«Davlat raqami» ustuni topilmadi — choraklik hisobot (24-ilova) shaklidagi fayl yuklang");
    const head = lower(rows[headIdx]!);
    const sub = lower(rows[headIdx + 1] ?? []);
    const col = (test: (x: string) => boolean, list = head) => list.findIndex(test);
    const cols = {
      n: col((x) => x.startsWith('t/r') || x === '№', lower(rows[headIdx - 1] ?? [])) >= 0 ? col((x) => x.startsWith('t/r') || x === '№', lower(rows[headIdx - 1] ?? [])) : 0,
      org: Math.max(col((x) => x.includes('tashkilot'), lower(rows[headIdx - 1] ?? [])), 1),
      model: col((x) => x.includes('rusum')),
      plate: col((x) => x.includes('davlat raqami')),
      made: col((x) => x.includes('ishlab chiqarilgan')),
      balanceYear: col((x) => x.includes('balansga olingan vaqti') && !x.includes('qiymat')),
      count: col((x) => x === 'soni'),
      value: col((x) => x.includes('qiymat')),
      storage: col((x) => x.includes('saqlash')),
      equip: col((x) => x.includes('jixozlash') || x.includes('jihozlash')),
      distPeriod: col((x) => x.includes('hisobot davrida'), sub),
      distTotal: col((x) => x.includes('jami harak'), sub),
    };
    if (cols.equip < 0) throw new BadRequestException("«Jihozlash xarajatlari» ustuni topilmadi");
    if (cols.distPeriod < 0) {
      const k = col((x) => x.includes('harakatlangan masofa'));
      if (k >= 0) {
        cols.distPeriod = k;
        cols.distTotal = k + 1;
      }
    }
    const scale: QuarterScale = scaleInput === 'SOM' ? 'SOM' : 'THOUSAND';
    const toTiyin = (v: number | null) => (v === null ? 0n : BigInt(Math.round(v * (scale === 'THOUSAND' ? 1000 : 1) * 100)));

    const vehicles = await this.prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true, model: true } });
    const byPlate = new Map(vehicles.map((v) => [plateKeyOf(v.plateNumber), v]));

    const out: QuarterRow[] = [];
    for (let i = headIdx + 2; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const plateRaw = str(r[cols.plate]);
      if (!plateRaw) continue;
      const key = plateKeyOf(plateRaw);
      if (key.length < 5) continue;
      const v = byPlate.get(key) ?? null;
      out.push({
        n: int(r[cols.n]) ?? out.length + 1,
        org: str(r[cols.org]),
        model: str(r[cols.model]),
        plate: formatPlate(plateRaw),
        plateKey: key,
        madeYear: cols.made >= 0 ? int(r[cols.made]) : null,
        balanceYear: cols.balanceYear >= 0 ? int(r[cols.balanceYear]) : null,
        count: cols.count >= 0 ? int(r[cols.count]) : null,
        balanceValueTiyin: toTiyin(cols.value >= 0 ? num(r[cols.value]) : null).toString(),
        storageTiyin: toTiyin(cols.storage >= 0 ? num(r[cols.storage]) : null).toString(),
        equipTiyin: toTiyin(num(r[cols.equip])).toString(),
        distancePeriodKm: cols.distPeriod >= 0 ? int(r[cols.distPeriod]) : null,
        distanceTotalKm: cols.distTotal >= 0 ? int(r[cols.distTotal]) : null,
        vehicleId: v?.id ?? null,
        vehicleLabel: v ? `${v.plateNumber} · ${v.model}` : null,
      });
    }
    if (!out.length) throw new BadRequestException('Faylda mashina qatorlari topilmadi');
    if (year === null || quarter === null) warnings.push("Yil va chorak topilmadi («2026-yilining 1 choragi» kabi) — qo'lda tanlang");
    const missing = out.filter((r) => !r.vehicleId).length;
    if (missing) warnings.push(`${missing} ta mashina ro'yxatda yo'q — saqlashda yangi mashina bo'lib qo'shiladi`);
    const exists = year !== null && quarter !== null ? Boolean((await this.store())[qKey(year, quarter)]) : false;
    return { year, quarter, scale, rows: out, warnings, exists };
  }

  /** Saqlash: jihozlash → ta'mirlash xarajati (mashina bo'limiga), qolgani — statistika */
  async commit(body: { year?: unknown; quarter?: unknown; scale?: unknown; fileName?: unknown; rows?: unknown }, userId: string) {
    const year = Number(body.year);
    const quarter = Number(body.quarter);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Yil noto'g'ri");
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new BadRequestException("Chorak noto'g'ri (1–4)");
    const rows = Array.isArray(body.rows) ? (body.rows as QuarterRow[]) : [];
    if (!rows.length) throw new BadRequestException("Qatorlar yo'q");
    if (rows.length > 1000) throw new BadRequestException("Qatorlar juda ko'p");
    const scale: QuarterScale = body.scale === 'SOM' ? 'SOM' : 'THOUSAND';
    const key = qKey(year, quarter);
    const date = lastDay(year, quarter);
    const label = `${year}-yil ${quarter}-chorak`;

    // Mashinalar: bor bo'lsa — topiladi, yo'q bo'lsa — qo'shiladi
    const vehicles = await this.prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true } });
    const byPlate = new Map(vehicles.map((v) => [plateKeyOf(v.plateNumber), v.id]));
    let created = 0;
    const clean: QuarterRow[] = [];
    for (const r of rows) {
      const plateKey = plateKeyOf(String(r.plate ?? ''));
      if (plateKey.length < 5) continue;
      let vehicleId = byPlate.get(plateKey) ?? null;
      if (!vehicleId) {
        const made = Number(r.madeYear);
        const res = await this.vehicles.create(
          { plateNumber: formatPlate(String(r.plate)), model: String(r.model || 'Rusumi kiritilmagan').slice(0, 80), year: Number.isInteger(made) && made > 1970 ? made : null, note: `Choraklik hisobotdan (${label}) qo'shildi` },
          userId,
        );
        vehicleId = res.id;
        byPlate.set(plateKey, vehicleId);
        created++;
      }
      const big = (v: unknown) => {
        try {
          return BigInt(String(v ?? '0'));
        } catch {
          return 0n;
        }
      };
      clean.push({ ...r, plateKey, vehicleId, balanceValueTiyin: big(r.balanceValueTiyin).toString(), storageTiyin: big(r.storageTiyin).toString(), equipTiyin: big(r.equipTiyin).toString() });
    }

    // Ta'mirlash yozuvlari: importKey bilan — qayta yuklanganda almashtiriladi
    const prefix = `quarter:${key}:`;
    const existing = await this.prisma.vehicleRecord.findMany({ where: { deletedAt: null, importKey: { startsWith: prefix } }, select: { id: true, importKey: true } });
    const byKey = new Map(existing.map((e) => [e.importKey!, e.id]));
    const keep = new Set<string>();
    let repair = 0n;
    let records = 0;
    for (const r of clean) {
      const amount = BigInt(r.equipTiyin);
      if (amount <= 0n || !r.vehicleId) continue;
      const importKey = `${prefix}${r.vehicleId}`;
      keep.add(importKey);
      const input = {
        vehicleId: r.vehicleId,
        kind: 'REPAIR',
        date,
        amountTiyin: amount.toString(),
        description: `Jihozlash xarajati — choraklik hisobot (${label})`,
        paymentMethod: 'BANK',
      };
      const id = byKey.get(importKey);
      if (id) await this.vehicles.updateRecord(id, input, userId);
      else await this.vehicles.createImportedFuel(input, importKey, userId);
      repair += amount;
      records++;
    }
    // Avvalgi yuklashda bor edi, endi yo'q (yoki 0) — o'chiriladi
    for (const [k, id] of byKey) if (!keep.has(k)) await this.vehicles.removeRecord(id);

    const map = await this.store();
    map[key] = { key, year, quarter, fileName: String(body.fileName ?? '').slice(0, 200), scale, savedAt: new Date().toISOString(), savedBy: userId, rows: clean, repairTiyin: repair.toString(), records };
    await this.save(map);
    await this.audit.log({ userId, action: 'CREATE', entity: 'vehicle_quarterly', entityId: key, summary: `Choraklik hisobot ${label}: ${clean.length} ta mashina, ta'mirlash ${records} ta yozuv` });
    return { key, vehicles: clean.length, createdVehicles: created, records, repairTiyin: repair.toString() };
  }

  /** Saqlangan choraklar (yangisi birinchi) */
  async list(): Promise<QuarterStored[]> {
    return Object.values(await this.store()).sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  }

  /** Chorakni bekor qilish: ta'mirlash yozuvlari va statistika o'chiriladi */
  async remove(key: string, userId: string) {
    const map = await this.store();
    if (!map[key]) throw new BadRequestException('Chorak topilmadi');
    const recs = await this.prisma.vehicleRecord.findMany({ where: { deletedAt: null, importKey: { startsWith: `quarter:${key}:` } }, select: { id: true } });
    for (const r of recs) await this.vehicles.removeRecord(r.id);
    delete map[key];
    await this.save(map);
    await this.audit.log({ userId, action: 'DELETE', entity: 'vehicle_quarterly', entityId: key, summary: `Choraklik hisobot ${key} bekor qilindi (${recs.length} ta ta'mirlash yozuvi)` });
    return { key, removed: recs.length };
  }

  /** Bo'sh shablon — «24-ilova» shakli, mashinalar ro'yxati bilan */
  async template(yearInput?: string, quarterInput?: string): Promise<{ buffer: Buffer; filename: string }> {
    const now = new Date(Date.now() + 5 * 3600_000);
    const year = Number(yearInput) || now.getUTCFullYear();
    const quarter = Math.min(4, Math.max(1, Number(quarterInput) || Math.floor(now.getUTCMonth() / 3) + 1));
    const list = await this.prisma.vehicle.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { plateNumber: 'asc' }, select: { plateNumber: true, model: true, year: true } });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Лист1');
    const widths = [5, 24, 18, 14, 12, 12, 7, 16, 14, 14, 16, 16];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const thin = { style: 'thin' as const };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    ws.mergeCells('D2:J2');
    ws.getCell('D2').value = '"Soliq-servis" AJ tasarrufidagi xizmat avtotransport vositalari to\'g\'risida MA\'LUMOTLAR';
    ws.getCell('D2').font = { bold: true };
    ws.getCell('D2').alignment = { horizontal: 'center', wrapText: true };
    ws.getCell('L2').value = '24-ilova';
    ws.mergeCells('A3:A5');
    ws.getCell('A3').value = 'T/r';
    ws.mergeCells('B3:B5');
    ws.getCell('B3').value = 'Tashkilot nomi';
    ws.mergeCells('C3:J3');
    ws.getCell('C3').value = `${year}-yilining ${quarter} choragi`;
    const heads: [string, string][] = [
      ['C', 'Rusumi'],
      ['D', 'Davlat raqami'],
      ['E', 'Ishlab chiqarilgan yili'],
      ['F', 'Balansga olingan vaqti'],
      ['G', 'Soni'],
      ['H', 'Balansga olingan vaqtida qiymati'],
      ['I', 'Saqlash xarajatlari'],
      ['J', 'Jixozlash xarajatlari'],
    ];
    for (const [c, label] of heads) {
      ws.mergeCells(`${c}4:${c}5`);
      ws.getCell(`${c}4`).value = label;
    }
    ws.mergeCells('K4:L4');
    ws.getCell('K4').value = 'Harakatlangan masofa';
    ws.getCell('K5').value = 'Hisobot davrida harakatlangan masofa';
    ws.getCell('L5').value = 'Jami harakatrlangan masofa';
    for (let r = 3; r <= 5; r++)
      for (let c = 1; c <= 12; c++) {
        const cell = ws.getCell(r, c);
        cell.border = border;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
    ws.getRow(5).height = 42;
    list.forEach((v, i) => {
      const r = 6 + i;
      const row = ws.getRow(r);
      row.values = [i + 1, ' "Soliq - servis" AJ', v.model, v.plateNumber, v.year ?? null, null, 1, null, null, null, null, null];
      for (let c = 1; c <= 12; c++) {
        const cell = ws.getCell(r, c);
        cell.border = border;
        if (c >= 8) cell.numFmt = '#,##0.00';
      }
    });
    const foot = 6 + list.length + 2;
    ws.getCell(foot, 2).value = ' "Soliq - servis" AJ direktori';
    ws.getCell(6 + list.length + 3, 2).value = "Summalar — ming so'mda. Xarajatga faqat «Jixozlash xarajatlari» (ta'mirlash) yoziladi; «Saqlash xarajatlari» — benzin, hisobga olinmaydi.";
    ws.getCell(6 + list.length + 3, 2).font = { italic: true, size: 9, color: { argb: 'FF64718B' } };
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Choraklik-hisobot-${year}-${quarter}-chorak.xlsx` };
  }
}
