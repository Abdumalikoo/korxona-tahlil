import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { REGION_GENERAL } from '../../common/segments/segments';
import { latinize, parseAmount } from '../../common/text/parse';

const CENTRAL_REGION = 0;
const TASHKENT_OFFSET_HOURS = 5;
const SHEET_LABEL = 'List 1';

/**
 * Hududlar shablondagi tartibi (SOATO kodlari).
 * Andijon, Buxoro, Jizzax, Qashqadaryo, Navoiy, Namangan, Samarqand,
 * Surxondaryo, Sirdaryo, Toshkent shahri, Toshkent viloyati,
 * Farg'ona, Xorazm, Qoraqalpog'iston.
 * Ro'yxatda yo'q hudud bo'lsa — oxiriga qo'shiladi.
 */
const REGION_ORDER = [3, 6, 8, 10, 12, 14, 18, 22, 24, 26, 27, 30, 33, 35];

/** Hududiy xizmatlar — SRV_01 ... SRV_39 */
const REGIONAL_SERVICE_CODE = /^SRV_\d{2}$/;

/** Viloyat varag'idagi "tumansiz" ustun: viloyatning o'ziga tegishli tushum */
const UNASSIGNED_LABEL = "Tumanga bo'linmagan";

/**
 * Shablon oxiridagi raqamsiz qo'shimcha qatorlar (bepul xizmatlar).
 * Ma'lumot uchun — o'qishda jamiga qo'shilmaydi.
 */
const EXTRA_TEMPLATE_ROWS = [
  'Jismoniy shaxslarning jami yillik daromadi to\u2018g\u2018risidagi deklaratsiyani tuzish va soliq organlariga yuborish(Bepul)',
  "PF-95 bo'yicha bepul xizmat",
];

export interface ParsedRow {
  regionCode: number;
  regionName: string;
  /** Tuman kaliti "3-1"; null — faqat viloyat bo'yicha (eski shablon yoki tumansiz ustun) */
  districtId: string | null;
  districtName: string | null;
  categoryCode: string;
  categoryLabel: string;
  quantity: number | null;
  amountTiyin: bigint;
}

interface RegionRef {
  code: number;
  name: string;
}

interface DistrictRef {
  id: string;
  regionCode: number;
  code: number;
  name: string;
}

interface ServiceRef {
  code: string;
  label: string;
}

/** Ustun qaysi hudud/tumanga tegishli */
interface ColumnTarget {
  region: RegionRef;
  district: DistrictRef | null;
}

interface Accumulated {
  region: RegionRef;
  district: DistrictRef | null;
  service: ServiceRef;
  quantity: number | null;
  amountTiyin: bigint;
}

/**
 * Hududlar tushumi (Excel).
 *
 * Qabul qilinadigan ko'rinishlar:
 *  1) YANGI — tuman kesimida: har bir viloyat alohida varaqda, ustunlarda tumanlar
 *     (+ "Tumanga bo'linmagan" ustuni), qatorlarda xizmat turlari (Soni / Summasi);
 *  2) RO'YXAT — bitta varaqda ustunlar: Viloyat · Tuman · Xizmat turi · Soni · Summasi;
 *  3) ESKI — bitta varaq, ustunlarda viloyatlar (tumansiz).
 * Bitta faylda bir necha ko'rinish aralash bo'lsa ham o'qiladi.
 */
@Injectable()
export class RegionalIncomeService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════ Yordamchilar ═══════════

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
  }

  /** "2026-03" → { from: "2026-03-01", to: "2026-03-31" } */
  private periodBounds(period: string): { from: string; to: string } {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year ?? 2026, month ?? 1, 0)).getUTCDate();

    return {
      from: `${period}-01`,
      to: `${period}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  /** Davr oxirgi kuni — daromad sanasi */
  private periodEndDate(period: string): Date {
    const [year, month] = period.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : (month ?? 1) + 1;
    const nextYear = month === 12 ? (year ?? 2026) + 1 : (year ?? 2026);

    return new Date(
      Date.UTC(nextYear, nextMonth - 1, 1, -TASHKENT_OFFSET_HOURS) - 86_400_000,
    );
  }

  private cellValue(value: ExcelJS.CellValue): unknown {
    if (value && typeof value === 'object') {
      const record = value as unknown as Record<string, unknown>;

      if ('result' in record) return record.result;
      if ('text' in record) return record.text;
      if ('richText' in record && Array.isArray(record.richText)) {
        return (record.richText as { text: string }[]).map((part) => part.text).join('');
      }
    }
    return value;
  }

  private text(value: ExcelJS.CellValue): string {
    const raw = this.cellValue(value);
    return raw === null || raw === undefined ? '' : String(raw).trim();
  }

  /**
   * Solishtirish uchun matnni tozalaydi.
   * Tutuq belgilarining barcha turlari olib tashlanadi: O'zbekiston = Ozbekiston.
   */
  private normalize(value: string): string {
    // Kirill yozuvi va aralash harflar («Андижон», «Аndijon») ham lotindagidek solishtiriladi
    return latinize(value)
      .replace(/['`´ʻʼ‘’]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** "viloyati", "respublikasi", "tumani" siz kalit — "shahri" saqlanadi */
  private shortKey(value: string): string {
    return this.normalize(value)
      .replace(/\s(viloyati|respublikasi|tumani)$/, '')
      .trim();
  }

  /** Son. Bo'sh — null, manfiy yoki matn — null */
  private parseNumber(value: unknown): number | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;

    // Matn ko'rinishidagi summa: «1 234 567,89», «1,234,567.89», «1.234.567», «12 345 so'm»
    const parsed = parseAmount(value);

    return parsed !== null && parsed >= 0 ? parsed : null;
  }

  private percent(part: bigint, total: bigint): number {
    if (total === 0n) return 0;
    return Number((part * 10000n) / total) / 100;
  }

  /** Excel varaq nomi: 31 belgigacha, taqiqlangan belgilarsiz, chetida tutuq belgisisiz */
  private sheetName(name: string): string {
    const clean = name
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31)
      .replace(/^['‘’ʻʼ]+|['‘’ʻʼ]+$/g, '')
      .trim();
    return clean || 'Hudud';
  }

  /** Faol hududlar shablon tartibida, Markazsiz */
  private async loadRegions(): Promise<RegionRef[]> {
    const regions = await this.prisma.region.findMany({
      where: { isActive: true, code: { notIn: [CENTRAL_REGION, REGION_GENERAL] } },
      select: { code: true, name: true },
    });

    const position = (code: number) => {
      const index = REGION_ORDER.indexOf(code);
      return index === -1 ? 1000 + code : index;
    };

    return regions.sort((a, b) => position(a.code) - position(b.code));
  }

  /** Faol tumanlar (Markazsiz), kod tartibida */
  private async loadDistricts(): Promise<DistrictRef[]> {
    return this.prisma.district.findMany({
      where: { isActive: true, regionCode: { not: CENTRAL_REGION } },
      orderBy: [{ regionCode: 'asc' }, { code: 'asc' }],
      select: { id: true, regionCode: true, code: true, name: true },
    });
  }

  /** Faqat hududiy xizmatlar — formadan qo'shilganlar kirmaydi */
  private async loadServices(): Promise<ServiceRef[]> {
    const services = await this.prisma.incomeCategory.findMany({
      where: { isActive: true, code: { startsWith: 'SRV_' } },
      orderBy: { order: 'asc' },
      select: { code: true, label: true },
    });

    return services.filter((item) => REGIONAL_SERVICE_CODE.test(item.code));
  }

  // ═══════════ Shablon ═══════════

  /**
   * Respublika bo'yicha xizmatlar kesimidagi shablon (bitta varaq):
   *  1-2 qator — sarlavha va davr;
   *  3-4 qator — "Xizmat nomi", "O'lchov birligi", "Jami Respublika bo'yicha", "shundan," → viloyatlar;
   *  5-6 qator — "Jami ko'rsatilgan xizmatlar" (Soni / Summasi, formula);
   *  keyin har bir xizmat — ikki qator (Soni / Summasi), oxirida raqamsiz qo'shimcha qatorlar
   *  (bepul xizmatlar — o'qishda jamiga qo'shilmaydi).
   */
  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);

    const [regions, services] = await Promise.all([this.loadRegions(), this.loadServices()]);

    if (regions.length === 0 || services.length === 0) {
      throw new BadRequestException('Hududlar yoki xizmat turlari topilmadi');
    }

    const { from, to } = this.periodBounds(period);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';

    const sheet = workbook.addWorksheet('Sheet1', { views: [{ state: 'frozen', xSplit: 4, ySplit: 6 }] });

    const thin = { style: 'thin' as const };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const totalFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9EAD3' } };
    const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };

    const FIRST_COL = 5;
    const lastCol = FIRST_COL + regions.length - 1;
    const letter = (col: number) => sheet.getColumn(col).letter;

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 40;
    sheet.getColumn(3).width = 15;
    sheet.getColumn(4).width = 25;
    for (let col = FIRST_COL; col <= lastCol; col++) sheet.getColumn(col).width = 14;

    // 1-2 qatorlar: sarlavha va davr
    sheet.mergeCells(1, 2, 1, lastCol);
    const title = sheet.getCell(1, 2);
    title.value = `"Soliq-servis" AJ tomonidan ko'rsatilgan xizmatlar soni to'g'risida ma'lumot`;
    title.font = { bold: true, size: 14 };
    title.alignment = center;
    sheet.getRow(1).height = 30;

    sheet.mergeCells(2, 2, 2, lastCol);
    const subtitle = sheet.getCell(2, 2);
    subtitle.value = `Xizmatlar bo'yicha hisobot (${from} dan ${to} gacha)`;
    subtitle.font = { bold: true };
    subtitle.alignment = center;

    // 3-4 qatorlar: ustun sarlavhalari
    const headers: [number, string][] = [
      [2, 'Xizmat nomi'],
      [3, "O'lchov birligi"],
      [4, "Jami Respublika bo'yicha"],
    ];
    for (const [col, label] of headers) {
      sheet.mergeCells(3, col, 4, col);
      sheet.getCell(3, col).value = label;
    }
    sheet.mergeCells(3, FIRST_COL, 3, lastCol);
    sheet.getCell(3, FIRST_COL).value = 'shundan,';

    regions.forEach((region, index) => {
      const cell = sheet.getCell(4, FIRST_COL + index);
      cell.value = region.name;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { ...center, textRotation: 90 };
    });
    sheet.getRow(4).height = 129;

    for (let row = 3; row <= 4; row++) {
      for (let col = 2; col <= lastCol; col++) {
        const cell = sheet.getCell(row, col);
        cell.border = border;
        if (!(row === 4 && col >= FIRST_COL)) {
          cell.font = { bold: true };
          cell.alignment = center;
        }
      }
    }

    // Xizmatlar va qo'shimcha qatorlar — har biri ikki qator (Soni / Summasi)
    const FIRST_SERVICE_ROW = 7;
    const items: { number: number | null; label: string }[] = [
      ...services.map((service, index) => ({ number: index + 1, label: service.label })),
      ...EXTRA_TEMPLATE_ROWS.map((label) => ({ number: null, label })),
    ];

    const pair = (soniRow: number, number: number | string | null, label: string, bold: boolean) => {
      const summaRow = soniRow + 1;
      sheet.mergeCells(soniRow, 1, summaRow, 1);
      sheet.mergeCells(soniRow, 2, summaRow, 2);
      if (number !== null) sheet.getCell(soniRow, 1).value = number;
      sheet.getCell(soniRow, 2).value = label;
      sheet.getCell(soniRow, 3).value = 'Soni';
      sheet.getCell(summaRow, 3).value = 'Summasi';

      for (const row of [soniRow, summaRow]) {
        for (let col = 1; col <= lastCol; col++) {
          const cell = sheet.getCell(row, col);
          cell.border = border;
          if (bold) cell.font = { bold: true };
          if (col >= 4) cell.numFmt = '#,##0';
          if (col === 3) cell.alignment = { horizontal: 'center', vertical: 'middle' };
          if (col === 4) cell.fill = totalFill;
        }
      }
      sheet.getCell(soniRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getCell(soniRow, 2).alignment = bold ? center : { horizontal: 'left', vertical: 'middle', wrapText: true };
    };

    // 5-6: Jami ko'rsatilgan xizmatlar (faqat raqamli xizmatlar yig'indisi)
    pair(5, '№', "Jami ko'rsatilgan xizmatlar", true);
    const lastServiceRow = FIRST_SERVICE_ROW + services.length * 2 - 1;
    for (let col = 4; col <= lastCol; col++) {
      const range = `${letter(col)}$${FIRST_SERVICE_ROW}:${letter(col)}$${lastServiceRow}`;
      const labels = `$C$${FIRST_SERVICE_ROW}:$C$${lastServiceRow}`;
      sheet.getCell(5, col).value = { formula: `SUMIF(${labels},"Soni",${range})` };
      sheet.getCell(6, col).value = { formula: `SUMIF(${labels},"Summasi",${range})` };
      for (const row of [5, 6]) sheet.getCell(row, col).fill = totalFill;
    }

    let rowIndex = FIRST_SERVICE_ROW;
    for (const item of items) {
      pair(rowIndex, item.number, item.label, false);
      for (const row of [rowIndex, rowIndex + 1]) {
        sheet.getCell(row, 4).value = { formula: `SUM(${letter(FIRST_COL)}${row}:${letter(lastCol)}${row})` };
      }
      rowIndex += 2;
    }

    const data = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Hududiy-daromadlar-xizmatlar-${period}.xlsx` };
  }

  // ═══════════ O'qish: ustun sarlavhalarini topish ═══════════

  private regionMatcher(regions: RegionRef[]): (raw: string) => RegionRef | null {
    const byFull = new Map(regions.map((r) => [this.normalize(r.name), r]));
    const byShort = new Map(regions.map((r) => [this.shortKey(r.name), r]));
    return (raw: string) => byFull.get(this.normalize(raw)) ?? byShort.get(this.shortKey(raw)) ?? null;
  }

  private districtMatcher(districts: DistrictRef[]): (raw: string) => DistrictRef | null {
    const byFull = new Map<string, DistrictRef>();
    const byShort = new Map<string, DistrictRef>();
    for (const d of districts) {
      byFull.set(this.normalize(d.name), d);
      byShort.set(this.shortKey(d.name), d);
    }
    return (raw: string) => byFull.get(this.normalize(raw)) ?? byShort.get(this.shortKey(raw)) ?? null;
  }

  private isUnassignedHeader(raw: string): boolean {
    const key = this.normalize(raw);
    return key === this.normalize(UNASSIGNED_LABEL) || key.startsWith('tumanga bolinmagan') || key === 'tumansiz' || key === 'viloyatning ozi';
  }

  /** Sarlavhadagi e'tiborsiz so'zlar */
  private isServiceHeader(raw: string): boolean {
    const key = this.normalize(raw);
    return (
      ['№', 'xizmat turi', 'xizmat nomi', 'olchov birligi', 'korsatkich', 'shundan,', 'shundan', 'shundan, tumanlar:'].includes(key) ||
      key.startsWith('jami') ||
      key.startsWith('xizmatlar')
    );
  }

  /** Varaq qaysi viloyatniki: varaq nomi yoki 1-qatordagi sarlavha bo'yicha */
  private sheetRegion(sheet: ExcelJS.Worksheet, matchRegion: (raw: string) => RegionRef | null, regions: RegionRef[]): RegionRef | null {
    const byName = matchRegion(sheet.name);
    if (byName) return byName;

    const title = this.normalize(this.text(sheet.getRow(1).getCell(1).value));
    if (!title) return null;
    // Eng uzun mos nom (masalan, "Toshkent viloyati" "Toshkent shahri"dan farqlanadi)
    const hits = regions
      .filter((r) => title.startsWith(this.normalize(r.name)) || title.startsWith(`${this.shortKey(r.name)} `))
      .sort((a, b) => b.name.length - a.name.length);
    return hits[0] ?? null;
  }

  /** Tuman ustunlari joylashgan qator (eng ko'p mos kelgani) */
  private findDistrictColumns(sheet: ExcelJS.Worksheet, region: RegionRef, districts: DistrictRef[]) {
    const match = this.districtMatcher(districts.filter((d) => d.regionCode === region.code));
    let best = { row: 0, columns: new Map<number, ColumnTarget>(), unknown: [] as string[] };
    const limit = Math.min(sheet.rowCount, 15);

    for (let rowIndex = 1; rowIndex <= limit; rowIndex++) {
      const columns = new Map<number, ColumnTarget>();
      const unknown: string[] = [];
      const used = new Set<string>();
      let districtHits = 0;

      sheet.getRow(rowIndex).eachCell((cell, col) => {
        const raw = this.text(cell.value);
        if (!raw) return;

        if (this.isUnassignedHeader(raw)) {
          if (!used.has('-')) {
            columns.set(col, { region, district: null });
            used.add('-');
          }
          return;
        }

        const district = match(raw);
        if (district && !used.has(district.id)) {
          columns.set(col, { region, district });
          used.add(district.id);
          districtHits++;
          return;
        }

        if (!this.isServiceHeader(raw)) unknown.push(`${region.name}: ${raw}`);
      });

      if (districtHits > 0 && columns.size > best.columns.size) best = { row: rowIndex, columns, unknown };
    }

    return best;
  }

  /** Eski ko'rinish: viloyat ustunlari joylashgan qator */
  private findRegionColumns(sheet: ExcelJS.Worksheet, matchRegion: (raw: string) => RegionRef | null) {
    let best = { row: 0, columns: new Map<number, ColumnTarget>(), unknown: [] as string[] };
    const limit = Math.min(sheet.rowCount, 15);

    for (let rowIndex = 1; rowIndex <= limit; rowIndex++) {
      const columns = new Map<number, ColumnTarget>();
      const unknown: string[] = [];
      const used = new Set<number>();

      sheet.getRow(rowIndex).eachCell((cell, col) => {
        const raw = this.text(cell.value);
        if (!raw) return;

        const region = matchRegion(raw);
        if (region && !used.has(region.code)) {
          columns.set(col, { region, district: null });
          used.add(region.code);
          return;
        }

        if (!this.isServiceHeader(raw)) unknown.push(raw);
      });

      if (columns.size > best.columns.size) best = { row: rowIndex, columns, unknown };
    }

    return best;
  }

  /** "Soni" yozilgan ustun — ko'rsatkich ustuni */
  private findIndicatorColumn(sheet: ExcelJS.Worksheet, fromRow: number): number | null {
    const limit = Math.min(sheet.rowCount, fromRow + 30);

    for (let rowIndex = fromRow + 1; rowIndex <= limit; rowIndex++) {
      let found: number | null = null;

      sheet.getRow(rowIndex).eachCell((cell, col) => {
        if (found === null && this.normalize(this.text(cell.value)) === 'soni') {
          found = col;
        }
      });

      if (found !== null) return found;
    }

    return null;
  }

  /** Ro'yxat ko'rinishi: Viloyat · Tuman · Xizmat turi · Soni · Summasi ustunlari */
  private findListHeader(sheet: ExcelJS.Worksheet) {
    const limit = Math.min(sheet.rowCount, 10);
    for (let rowIndex = 1; rowIndex <= limit; rowIndex++) {
      const cols: { region?: number; district?: number; service?: number; quantity?: number; amount?: number } = {};
      sheet.getRow(rowIndex).eachCell((cell, col) => {
        const key = this.normalize(this.text(cell.value));
        if (!key) return;
        if (cols.region === undefined && (key.startsWith('viloyat') || key.startsWith('hudud'))) cols.region = col;
        else if (cols.district === undefined && key.startsWith('tuman')) cols.district = col;
        else if (cols.service === undefined && key.startsWith('xizmat')) cols.service = col;
        else if (cols.quantity === undefined && (key.startsWith('soni') || key === 'miqdori')) cols.quantity = col;
        else if (cols.amount === undefined && key.startsWith('summa')) cols.amount = col;
      });
      if (cols.region && cols.district && cols.service && cols.amount) {
        return { row: rowIndex, columns: cols as Required<Pick<typeof cols, 'region' | 'district' | 'service' | 'amount'>> & { quantity?: number } };
      }
    }
    return null;
  }

  // ═══════════ O'qish ═══════════

  /**
   * Faylni o'qiydi — bazaga hech narsa yozilmaydi.
   * Hudud/tuman nomi bo'yicha, xizmat nomi yoki tartib raqami bo'yicha topiladi.
   */
  async analyze(period: string, file: Express.Multer.File) {
    this.assertPeriod(period);

    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const workbook = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    if (workbook.worksheets.length === 0) {
      throw new BadRequestException('Faylda varaq topilmadi');
    }

    const [regions, districts, services] = await Promise.all([
      this.loadRegions(),
      this.loadDistricts(),
      this.loadServices(),
    ]);

    const matchRegion = this.regionMatcher(regions);
    const byLabel = new Map(services.map((s) => [this.normalize(s.label), s]));
    const matchService = (label: string): ServiceRef | null => byLabel.get(this.normalize(label)) ?? null;

    const values = new Map<string, Accumulated>();
    const unknownHeaders: string[] = [];
    const unknownServices: { sheet: string; rowIndex: number; label: string }[] = [];
    const invalidCells: { sheet: string; rowIndex: number; region: string }[] = [];
    const unknownPlaces: { sheet: string; rowIndex: number; value: string }[] = [];
    let recognizedSheets = 0;

    const addValue = (target: ColumnTarget, service: ServiceRef, indicator: 'soni' | 'summasi', number: number) => {
      const key = `${target.region.code}:${target.district?.id ?? '-'}:${service.code}`;
      const entry = values.get(key) ?? { region: target.region, district: target.district, service, quantity: null, amountTiyin: 0n };
      if (indicator === 'soni') entry.quantity = (entry.quantity ?? 0) + Math.round(number);
      else entry.amountTiyin += BigInt(Math.round(number * 100));
      values.set(key, entry);
    };

    for (const sheet of workbook.worksheets) {
      // ── 2) Ro'yxat ko'rinishi ──
      const list = this.findListHeader(sheet);
      if (list) {
        recognizedSheets++;
        for (let rowIndex = list.row + 1; rowIndex <= sheet.rowCount; rowIndex++) {
          const row = sheet.getRow(rowIndex);
          const regionRaw = this.text(row.getCell(list.columns.region).value);
          const districtRaw = this.text(row.getCell(list.columns.district).value);
          const serviceRaw = this.text(row.getCell(list.columns.service).value);
          if (!regionRaw && !districtRaw && !serviceRaw) continue;
          if (this.normalize(regionRaw).startsWith('jami')) continue;

          const region = /^\d+$/.test(regionRaw) ? regions.find((r) => r.code === Number(regionRaw)) ?? null : matchRegion(regionRaw);
          if (!region) {
            unknownPlaces.push({ sheet: sheet.name, rowIndex, value: regionRaw || '(bo‘sh viloyat)' });
            continue;
          }

          let district: DistrictRef | null = null;
          if (districtRaw && !this.isUnassignedHeader(districtRaw)) {
            district = /^\d+$/.test(districtRaw)
              ? districts.find((d) => d.id === `${region.code}-${Number(districtRaw)}`) ?? null
              : this.districtMatcher(districts.filter((d) => d.regionCode === region.code))(districtRaw);
            if (!district) {
              unknownPlaces.push({ sheet: sheet.name, rowIndex, value: `${region.name}: ${districtRaw}` });
              continue;
            }
          }

          const service = matchService(serviceRaw);
          if (!service) {
            unknownServices.push({ sheet: sheet.name, rowIndex, label: serviceRaw || '(nomsiz)' });
            continue;
          }

          const target = { region, district };
          const amountRaw = this.cellValue(row.getCell(list.columns.amount).value);
          const amount = this.parseNumber(amountRaw);
          if (amount === null && String(amountRaw ?? '').trim() !== '') {
            invalidCells.push({ sheet: sheet.name, rowIndex, region: region.name });
            continue;
          }
          if (amount !== null) addValue(target, service, 'summasi', amount);

          if (list.columns.quantity) {
            const quantity = this.parseNumber(this.cellValue(row.getCell(list.columns.quantity).value));
            if (quantity !== null) addValue(target, service, 'soni', quantity);
          }
        }
        continue;
      }

      // ── 1) Tuman kesimi yoki 3) eski ko'rinish ──
      const region = this.sheetRegion(sheet, matchRegion, regions);
      let header = region ? this.findDistrictColumns(sheet, region, districts) : null;
      if (!header || header.columns.size === 0) header = this.findRegionColumns(sheet, matchRegion);
      if (header.columns.size === 0) {
        if (region) unknownHeaders.push(`${sheet.name}: tuman ustunlari topilmadi — varaq o'tkazib yuborildi`);
        continue;
      }

      recognizedSheets++;
      unknownHeaders.push(...header.unknown);

      const indicatorCol = this.findIndicatorColumn(sheet, header.row);
      if (indicatorCol === null || indicatorCol < 3) {
        throw new BadRequestException(
          `"${sheet.name}" varag'ida "Soni" / "Summasi" ustuni topilmadi. Shablon tuzilishini o'zgartirmang`,
        );
      }

      const labelCol = indicatorCol - 1;
      const numberCol = indicatorCol - 2;

      // Xizmatlar raqamlangan bo'lsa — raqamsiz qatorlar qo'shimcha (bepul) ma'lumot, jamiga kirmaydi
      let numbered = false;
      for (let rowIndex = header.row + 1; rowIndex <= sheet.rowCount && !numbered; rowIndex++) {
        const row = sheet.getRow(rowIndex);
        if (this.normalize(this.text(row.getCell(indicatorCol).value)) !== 'soni') continue;
        const number = this.parseNumber(this.cellValue(row.getCell(numberCol).value));
        numbered = number !== null && Number.isInteger(number) && number >= 1;
      }

      const resolveService = (row: ExcelJS.Row): ServiceRef | 'skip' | 'extra' | null => {
        const label = this.text(row.getCell(labelCol).value);
        if (this.normalize(label).startsWith('jami')) return 'skip';
        if (numbered && String(this.cellValue(row.getCell(numberCol).value) ?? '').trim() === '') return 'extra';

        const byName = matchService(label);
        if (byName) return byName;

        const number = this.parseNumber(this.cellValue(row.getCell(numberCol).value));
        if (number !== null && Number.isInteger(number) && number >= 1) {
          return services[number - 1] ?? null;
        }
        return null;
      };

      for (let rowIndex = header.row + 1; rowIndex <= sheet.rowCount; rowIndex++) {
        const row = sheet.getRow(rowIndex);
        const indicator = this.normalize(this.text(row.getCell(indicatorCol).value));
        if (indicator !== 'soni' && indicator !== 'summasi') continue;

        const service = resolveService(row);
        if (service === 'skip') continue;
        if (service === 'extra') {
          const filled = [...header.columns.keys()].some((col) => (this.parseNumber(this.cellValue(row.getCell(col).value)) ?? 0) > 0);
          if (filled) {
            const label = this.text(row.getCell(labelCol).value) || '(nomsiz)';
            unknownHeaders.push(`${sheet.name}: "${label}" — raqamsiz qo'shimcha qator, jamiga qo'shilmadi`);
          }
          continue;
        }

        if (!service) {
          // Bir xizmat ikki qator — faqat bir marta qayd etamiz
          if (indicator === 'soni') {
            unknownServices.push({ sheet: sheet.name, rowIndex, label: this.text(row.getCell(labelCol).value) || '(nomsiz)' });
          }
          continue;
        }

        for (const [col, target] of header.columns) {
          const raw = this.cellValue(row.getCell(col).value);
          if (raw === null || raw === undefined || String(raw).trim() === '') continue;

          const number = this.parseNumber(raw);
          if (number === null) {
            invalidCells.push({ sheet: sheet.name, rowIndex, region: target.district?.name ?? target.region.name });
            continue;
          }
          addValue(target, service, indicator, number);
        }
      }
    }

    if (recognizedSheets === 0) {
      throw new BadRequestException(
        "Hudud yoki tuman ustunlari topilmadi. Shablondagi viloyat va tuman nomlarini o'zgartirmang",
      );
    }

    // Faqat summasi bor yozuvlar saqlanadi
    const rows: ParsedRow[] = [...values.values()]
      .filter((entry) => entry.amountTiyin > 0n)
      .map((entry) => ({
        regionCode: entry.region.code,
        regionName: entry.region.name,
        districtId: entry.district?.id ?? null,
        districtName: entry.district?.name ?? null,
        categoryCode: entry.service.code,
        categoryLabel: entry.service.label,
        quantity: entry.quantity,
        amountTiyin: entry.amountTiyin,
      }));

    const quantityWithoutAmount = [...values.values()].filter(
      (entry) => entry.amountTiyin === 0n && (entry.quantity ?? 0) > 0,
    ).length;

    if (rows.length === 0) {
      throw new BadRequestException('Faylda summasi kiritilgan qator topilmadi');
    }

    // Hududlar bo'yicha yig'indi — shablon tartibida, tumanlar soni bilan
    const regionGroups = new Map<
      number,
      {
        regionCode: number;
        name: string;
        count: number;
        quantity: number;
        totalTiyin: bigint;
        districtIds: Set<string>;
        unassignedTiyin: bigint;
      }
    >();

    for (const row of rows) {
      const group = regionGroups.get(row.regionCode) ?? {
        regionCode: row.regionCode,
        name: row.regionName,
        count: 0,
        quantity: 0,
        totalTiyin: 0n,
        districtIds: new Set<string>(),
        unassignedTiyin: 0n,
      };
      group.count += 1;
      group.quantity += row.quantity ?? 0;
      group.totalTiyin += row.amountTiyin;
      if (row.districtId) group.districtIds.add(row.districtId);
      else group.unassignedTiyin += row.amountTiyin;
      regionGroups.set(row.regionCode, group);
    }

    const orderedRegions = regions
      .map((region) => regionGroups.get(region.code))
      .filter((group): group is NonNullable<typeof group> => Boolean(group))
      .map(({ districtIds, ...group }) => ({ ...group, districtCount: districtIds.size }));

    const previousCount = await this.prisma.income.count({
      where: { deletedAt: null, period, source: 'IMPORT', regionCode: { not: null } },
    });
    const anomalies = await this.anomalies(period, rows);

    return {
      period,
      fileName: file.originalname,
      fileHash: createHash('sha256').update(file.buffer).digest('hex'),
      totalRows: rows.length,
      totalTiyin: rows.reduce((sum, row) => sum + row.amountTiyin, 0n),
      /** Tuman kesimidagi yozuvlar (qolgani — faqat viloyat bo'yicha) */
      districtRows: rows.filter((row) => row.districtId !== null).length,
      /** Tanilmagan ustun sarlavhalari */
      unknownSheets: [...new Set(unknownHeaders)],
      unknownServices,
      unknownPlaces,
      invalidCells,
      quantityWithoutAmount,
      /** G'alati qiymatlar (saqlashdan oldin ko'rib chiqish uchun): bir dona narxi odatdagidan 20 marta farq, juda kichik summa */
      anomalies,
      hasPrevious: previousCount > 0,
      previousCount,
      regions: orderedRegions,
      rows,
    };
  }

  /**
   * G'alati qiymatlar: shu xizmatning o'tgan 12 oydagi bir dona narxi medianasidan 20 baravardan ko'p farq (son va summa
   * ustunlari adashgani yoki raqam noto'g'ri o'qilgani belgisi) yoki 1 000 so'mdan kichik summa. Faqat ogohlantirish.
   */
  private async anomalies(period: string, rows: ParsedRow[]) {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const from = `${y - 1}-${String(m).padStart(2, '0')}`;
    const history = await this.prisma.income.findMany({
      where: { deletedAt: null, source: 'IMPORT', regionCode: { not: null }, period: { gte: from, lt: period }, quantity: { gt: 0 }, categoryCode: { in: [...new Set(rows.map((r) => r.categoryCode))] } },
      select: { categoryCode: true, amountTiyin: true, quantity: true },
    });
    const prices = new Map<string, number[]>();
    for (const h of history) prices.set(h.categoryCode, [...(prices.get(h.categoryCode) ?? []), Number(h.amountTiyin) / h.quantity!]);
    const median = new Map<string, number>();
    for (const [code, list] of prices) {
      // Kam tarix (5 tadan oz) — medianaga ishonilmaydi
      if (list.length < 5) continue;
      list.sort((a, b) => a - b);
      median.set(code, list[Math.floor(list.length / 2)]!);
    }
    const out: { regionName: string; districtName: string | null; categoryLabel: string; quantity: number | null; amountTiyin: bigint; unitTiyin: bigint | null; usualUnitTiyin: bigint | null; reason: string }[] = [];
    for (const r of rows) {
      const unit = r.quantity && r.quantity > 0 ? Number(r.amountTiyin) / r.quantity : null;
      const med = median.get(r.categoryCode) ?? null;
      let reason: string | null = null;
      if (r.amountTiyin > 0n && r.amountTiyin < 100_000n) reason = "Summa 1 000 so'mdan kichik — ming so'mda yozilganmi?";
      else if (unit !== null && med !== null && (unit > med * 20 || unit < med / 20)) reason = `Bir dona narxi odatdagidan ${unit > med ? Math.round(unit / med) : Math.round(med / unit)} baravar ${unit > med ? 'qimmat' : 'arzon'} — soni yoki summasi to'g'rimi?`;
      if (reason) out.push({ regionName: r.regionName, districtName: r.districtName, categoryLabel: r.categoryLabel, quantity: r.quantity, amountTiyin: r.amountTiyin, unitTiyin: unit !== null ? BigInt(Math.round(unit)) : null, usualUnitTiyin: med !== null ? BigInt(Math.round(med)) : null, reason });
    }
    return out;
  }

  // ═══════════ Saqlash ═══════════

  async commit(period: string, rows: ParsedRow[], userId: string, replacePrevious = false) {
    this.assertPeriod(period);

    if (rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const [regions, districts, services] = await Promise.all([
      this.loadRegions(),
      this.loadDistricts(),
      this.loadServices(),
    ]);

    const regionCodes = new Set(regions.map((r) => r.code));
    const districtById = new Map(districts.map((d) => [d.id, d]));
    const serviceCodes = new Set(services.map((s) => s.code));

    for (const row of rows) {
      if (!regionCodes.has(row.regionCode)) {
        throw new BadRequestException(`Hudud topilmadi: ${row.regionCode}`);
      }
      if (row.districtId !== null) {
        const district = districtById.get(row.districtId);
        if (!district || district.regionCode !== row.regionCode) {
          throw new BadRequestException(`Tuman topilmadi yoki boshqa viloyatniki: ${row.districtId}`);
        }
      }
      if (!serviceCodes.has(row.categoryCode)) {
        throw new BadRequestException(`Xizmat turi topilmadi: ${row.categoryCode}`);
      }
      if (row.amountTiyin <= 0n) {
        throw new BadRequestException(`Notogri summa: ${row.regionName} - ${row.categoryLabel}`);
      }
    }

    const date = this.periodEndDate(period);
    const startedAt = new Date();
    const expectedTiyin = rows.reduce((sum, row) => sum + row.amountTiyin, 0n);

    const created = await this.prisma.$transaction(
      async (tx) => {
        if (replacePrevious) {
          await tx.income.updateMany({
            where: { deletedAt: null, period, source: 'IMPORT', regionCode: { not: null } },
            data: { deletedAt: new Date() },
          });
        }

        await tx.income.createMany({
          data: rows.map((row) => {
            const districtName = row.districtId ? districtById.get(row.districtId)?.name ?? null : null;
            return {
              date,
              period,
              amountTiyin: row.amountTiyin,
              paidTiyin: row.amountTiyin,
              paymentStatus: 'PAID' as const,
              paymentMethod: 'BANK' as const,
              categoryCode: row.categoryCode,
              regionCode: row.regionCode,
              districtId: row.districtId,
              quantity: row.quantity,
              description: districtName
                ? `${row.regionName} — ${districtName} — ${row.categoryLabel}`
                : `${row.regionName} — ${row.categoryLabel}`,
              source: 'IMPORT' as const,
              createdById: userId,
            };
          }),
        });

        const result = await tx.income.aggregate({
          where: {
            deletedAt: null,
            period,
            source: 'IMPORT',
            regionCode: { not: null },
            createdAt: { gte: startedAt },
          },
          _sum: { amountTiyin: true },
          _count: { _all: true },
        });

        if (result._count._all !== rows.length || (result._sum.amountTiyin ?? 0n) !== expectedTiyin) {
          throw new BadRequestException(
            `Yaratishda xato: kutilgan ${rows.length} ta, yaratilgan ${result._count._all} ta`,
          );
        }

        return result;
      },
      { timeout: 60_000 },
    );

    return {
      success: true as const,
      created: created._count._all,
      totalTiyin: created._sum.amountTiyin ?? 0n,
      districtRows: rows.filter((row) => row.districtId !== null).length,
      replacedPrevious: replacePrevious,
    };
  }

  // ═══════════ Yig'indilar ═══════════

  async summaryByRegion(period: string) {
    this.assertPeriod(period);

    const [grouped, regions] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['regionCode'],
        where: { deletedAt: null, period, source: 'IMPORT', regionCode: { not: null } },
        _sum: { amountTiyin: true, quantity: true },
        _count: { _all: true },
      }),
      this.loadRegions(),
    ]);

    const total = grouped.reduce((sum, row) => sum + (row._sum.amountTiyin ?? 0n), 0n);
    const byCode = new Map(grouped.map((row) => [row.regionCode, row]));

    // Shablon tartibida
    const rows = regions
      .map((region) => {
        const row = byCode.get(region.code);
        if (!row) return null;

        const amount = row._sum.amountTiyin ?? 0n;

        return {
          regionCode: region.code,
          name: region.name,
          amountTiyin: amount,
          quantity: row._sum.quantity ?? 0,
          count: row._count._all,
          sharePercent: this.percent(amount, total),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return { rows, totalTiyin: total };
  }

  /** Xizmat turi × viloyat: qatorlar — xizmatlar (kattasidan), ustunlar — viloyatlar (shablon tartibida), kataklar — summa */
  async summaryMatrix(period: string) {
    this.assertPeriod(period);
    const [grouped, regions, services] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['categoryCode', 'regionCode'],
        where: { deletedAt: null, period, source: 'IMPORT', regionCode: { not: null } },
        _sum: { amountTiyin: true, quantity: true },
      }),
      this.loadRegions(),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
    ]);
    const labels = new Map(services.map((s) => [s.code, s.label]));
    const used = new Set(grouped.map((g) => g.regionCode));
    const cols = regions.filter((r) => used.has(r.code)).map((r) => ({ regionCode: r.code, name: r.name }));
    const byService = new Map<string, { categoryCode: string; label: string; totalTiyin: bigint; quantity: number; cells: Record<number, bigint> }>();
    const regionTotals: Record<number, bigint> = {};
    let total = 0n;
    for (const g of grouped) {
      const amount = g._sum.amountTiyin ?? 0n;
      const code = g.regionCode!;
      const row = byService.get(g.categoryCode) ?? { categoryCode: g.categoryCode, label: labels.get(g.categoryCode) ?? g.categoryCode, totalTiyin: 0n, quantity: 0, cells: {} };
      row.cells[code] = (row.cells[code] ?? 0n) + amount;
      row.totalTiyin += amount;
      row.quantity += g._sum.quantity ?? 0;
      byService.set(g.categoryCode, row);
      regionTotals[code] = (regionTotals[code] ?? 0n) + amount;
      total += amount;
    }
    const rows = [...byService.values()].sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : b.totalTiyin < a.totalTiyin ? -1 : 0));
    return { regions: cols, rows, regionTotals, totalTiyin: total };
  }

  /** Bitta viloyat tumanlari bo'yicha; tumansiz yozuvlar — "Tumanga bo'linmagan" qatori */
  async summaryByDistrict(period: string, regionCode: number) {
    this.assertPeriod(period);
    if (!Number.isInteger(regionCode)) throw new BadRequestException('Viloyat kodi noto‘g‘ri');

    const [grouped, districts] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['districtId'],
        where: { deletedAt: null, period, source: 'IMPORT', regionCode },
        _sum: { amountTiyin: true, quantity: true },
        _count: { _all: true },
      }),
      this.prisma.district.findMany({ where: { regionCode }, select: { id: true, name: true, code: true } }),
    ]);

    const names = new Map(districts.map((d) => [d.id, d]));
    const total = grouped.reduce((sum, row) => sum + (row._sum.amountTiyin ?? 0n), 0n);

    const rows = grouped
      .map((row) => {
        const amount = row._sum.amountTiyin ?? 0n;
        const district = row.districtId ? names.get(row.districtId) : undefined;
        return {
          districtId: row.districtId,
          name: district?.name ?? UNASSIGNED_LABEL,
          amountTiyin: amount,
          quantity: row._sum.quantity ?? 0,
          count: row._count._all,
          sharePercent: this.percent(amount, total),
          order: district?.code ?? 1_000_000,
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...row }) => row);

    return { rows, totalTiyin: total };
  }

  async summaryByService(period: string, regionCode?: number, districtId?: string) {
    this.assertPeriod(period);

    const [grouped, services] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['categoryCode'],
        where: {
          deletedAt: null,
          period,
          source: 'IMPORT',
          regionCode: regionCode !== undefined ? regionCode : { not: null },
          ...(districtId !== undefined ? { districtId: districtId === '-' ? null : districtId } : {}),
        },
        _sum: { amountTiyin: true, quantity: true },
        _count: { _all: true },
      }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
    ]);

    const labels = new Map(services.map((s) => [s.code, s.label]));
    const total = grouped.reduce((sum, row) => sum + (row._sum.amountTiyin ?? 0n), 0n);

    const rows = grouped
      .map((row) => {
        const amount = row._sum.amountTiyin ?? 0n;
        const quantity = row._sum.quantity ?? 0;

        return {
          categoryCode: row.categoryCode,
          label: labels.get(row.categoryCode) ?? row.categoryCode,
          amountTiyin: amount,
          quantity,
          averageTiyin: quantity > 0 ? amount / BigInt(quantity) : null,
          count: row._count._all,
          sharePercent: this.percent(amount, total),
        };
      })
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    return { rows, totalTiyin: total };
  }
}