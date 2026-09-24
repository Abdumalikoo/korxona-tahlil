import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';

// ─────── Ustama qoidasi ───────
const LOW_PERCENT = 80;
const HIGH_PERCENT = 95;
const MID_RATE = 25n;
const HIGH_RATE = 45n;

/** Fayldagi va hisoblangan ustama farqi shundan katta bo'lsa — ogohlantirish (1 so'm) */
const BONUS_TOLERANCE_TIYIN = 100n;

/** Shablonda formulali bo'sh qatorlar soni */
const TEMPLATE_ROWS = 450;

/** Hududlar tartibi — hisobotlardagi kabi */
const REGION_ORDER = [0, 3, 6, 8, 10, 12, 14, 18, 22, 24, 26, 27, 30, 33, 35];

export type EmploymentKind = 'SHTAT' | 'SHARTNOMA';

/** Saqlash uchun qator */
export interface ResultRow {
  pinfl: string;
  regionCode: number;
  districtId: string | null;
  employmentType: EmploymentKind;
  planTiyin: bigint;
  factTiyin: bigint;
  bonusTiyin: bigint;
}

type ColumnKey = 'region' | 'district' | 'pinfl' | 'fullName' | 'type' | 'plan' | 'fact' | 'bonus';
type ColumnMap = Partial<Record<ColumnKey, number>>;

export interface RegionRef {
  code: number;
  name: string;
}

export interface DistrictRef {
  id: string;
  regionCode: number;
  code: number;
  name: string;
}

export interface ParsedLine {
  rowIndex: number;
  pinfl: string;
  fileName: string;
  region: RegionRef;
  district: DistrictRef | null;
  fileType: EmploymentKind | null;
  planTiyin: bigint;
  factTiyin: bigint;
  fileBonusTiyin: bigint | null;
}

export interface AnalyzedRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: EmploymentKind;
  planTiyin: bigint;
  factTiyin: bigint;
  percent: number | null;
  bonusTiyin: bigint;
  expectedBonusTiyin: bigint;
}

export interface RegionTotal {
  regionCode: number;
  name: string;
  count: number;
  planTiyin: bigint;
  factTiyin: bigint;
  bonusTiyin: bigint;
  percent: number | null;
}

const TYPE_LABELS: Record<EmploymentKind, string> = {
  SHTAT: 'Asosiy shtat',
  SHARTNOMA: 'Shartnoma',
};

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  // ═══════════ Yordamchilar ═══════════

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
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

  private isBlank(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === '';
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\u0027\u0060\u00B4\u02BB\u02BC\u2018\u2019]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** "viloyati", "respublikasi", "tumani" siz — "shahri" saqlanadi */
  private shortKey(value: string): string {
    return this.normalize(value)
      .replace(/\s(viloyati|respublikasi|tumani)$/, '')
      .trim();
  }

  private parsePinfl(value: unknown): string | null {
    if (this.isBlank(value)) return null;
    const digits = String(value).replace(/\D/g, '');
    return /^\d{14}$/.test(digits) ? digits : null;
  }

  /** So'mdagi summa → tiyin. Bo'sh — 0, noto'g'ri — null */
  private parseMoney(value: unknown): bigint | null {
    if (this.isBlank(value)) return 0n;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      return BigInt(Math.round(value * 100));
    }

    const text = String(value).replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
    const parsed = Number(text);

    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return BigInt(Math.round(parsed * 100));
  }

  /**
   * Xodim turi: 1 — asosiy shtat, 2 — shartnoma.
   * Bo'sh — null (reestrdagi olinadi), boshqa qiymat — 'invalid'.
   */
  private parseType(value: unknown): EmploymentKind | null | 'invalid' {
    if (this.isBlank(value)) return null;

    const key = this.normalize(String(value));

    if (key === '1' || key === 'shtat' || key === 'asosiy shtat' || key === 'asosiy') {
      return 'SHTAT';
    }
    if (key === '2' || key === 'shartnoma') {
      return 'SHARTNOMA';
    }
    return 'invalid';
  }

  /** Bajarilish foizi — reja nol bo'lsa null */
  private percentOf(plan: bigint, fact: bigint): number | null {
    if (plan <= 0n) return null;
    return Number((fact * 10000n) / plan) / 100;
  }

  /** Ustama qoida bo'yicha: <80% — 0, 80–95% — 25%, >95% — 45% */
  private expectedBonus(plan: bigint, fact: bigint): bigint {
    const percent = this.percentOf(plan, fact);

    if (percent === null || percent < LOW_PERCENT) return 0n;
    if (percent <= HIGH_PERCENT) return (fact * MID_RATE) / 100n;
    return (fact * HIGH_RATE) / 100n;
  }

  private regionPosition(code: number): number {
    const index = REGION_ORDER.indexOf(code);
    return index === -1 ? 1000 + code : index;
  }

  private async loadReferences(): Promise<{ regions: RegionRef[]; districts: DistrictRef[] }> {
    const [regions, districts] = await Promise.all([
      this.prisma.region.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
      }),
      this.prisma.district.findMany({
        select: { id: true, regionCode: true, code: true, name: true },
      }),
    ]);

    regions.sort((a, b) => this.regionPosition(a.code) - this.regionPosition(b.code));

    return { regions, districts };
  }

  // ═══════════ Shablon ═══════════

  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);

    const { regions, districts } = await this.loadReferences();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';

    const sheet = workbook.addWorksheet('Natijalar', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    const headers = [
      '№',
      'Hudud',
      'Tuman',
      'PINFL',
      'Xodim F.I.Sh',
      'Turi\n(1 - asosiy shtat,\n2 - shartnoma)',
      'Oylik reja',
      'Reja bajarilishi\n(tushum)',
      'Foizda',
      "Ustama miqdori\n(tushum rejaga nisbatan 80%dan past bo'lganda=0, " +
        "80-95% bo'lganda = tushumning 25%, 95%dan ortiq bo'lganda tushumning 45%)",
    ];
    const widths = [6, 22, 24, 18, 40, 14, 16, 18, 10, 26];

    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    // ─── 1-qator: sarlavhalar ───
    const headerRow = sheet.getRow(1);
    headers.forEach((label, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
    });
    headerRow.height = 95;

    const first = 3;
    const last = first + TEMPLATE_ROWS - 1;

    // ─── 2-qator: Jami ───
    const totalRow = sheet.getRow(2);
    totalRow.getCell(1).value = 'Jami';
    totalRow.getCell(7).value = { formula: `SUM(G${first}:G${last})` };
    totalRow.getCell(8).value = { formula: `SUM(H${first}:H${last})` };
    totalRow.getCell(9).value = { formula: 'IF(G2>0,ROUND(H2/G2*100,0),0)' };
    totalRow.getCell(10).value = { formula: `SUM(J${first}:J${last})` };

    for (let col = 1; col <= 10; col++) {
      const cell = totalRow.getCell(col);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF28A745' } };
      cell.border = border;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (col === 7 || col === 8 || col === 10) cell.numFmt = '#,##0';
    }

    // ─── Ma'lumot qatorlari: №, foiz va ustama formulasi tayyor ───
    for (let r = first; r <= last; r++) {
      const row = sheet.getRow(r);

      row.getCell(1).value = { formula: `IF(D${r}="","",ROW()-2)` };
      row.getCell(4).numFmt = '@';

      // Turi — faqat 1 yoki 2
      row.getCell(6).dataValidation = {
        type: 'whole',
        operator: 'between',
        allowBlank: true,
        formulae: [1, 2],
        showErrorMessage: true,
        errorTitle: 'Xodim turi',
        error: '1 - asosiy shtat, 2 - shartnoma',
      };
      row.getCell(6).alignment = { horizontal: 'center' };

      row.getCell(9).value = {
        formula: `IF(OR(G${r}="",H${r}="",G${r}=0),"",ROUND(H${r}/G${r}*100,0))`,
      };
      row.getCell(10).value = {
        formula:
          `IF(OR(G${r}="",H${r}="",G${r}=0),"",` +
          `IF(H${r}/G${r}*100<${LOW_PERCENT},0,` +
          `IF(H${r}/G${r}*100<=${HIGH_PERCENT},H${r}*0.25,H${r}*0.45)))`,
      };

      row.getCell(7).numFmt = '#,##0';
      row.getCell(8).numFmt = '#,##0';
      row.getCell(10).numFmt = '#,##0';

      for (let col = 1; col <= 10; col++) {
        row.getCell(col).border = border;
      }
    }

    // ─── Kodlar varag'i ───
    const codes = workbook.addWorksheet('Kodlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    codes.columns = [
      { header: 'Hudud kodi', key: 'regionCode', width: 12 },
      { header: 'Hudud', key: 'regionName', width: 30 },
      { header: 'Tuman kodi', key: 'districtCode', width: 12 },
      { header: 'Tuman', key: 'districtName', width: 34 },
    ];

    const codesHeader = codes.getRow(1);
    codesHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    codesHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };

    for (const region of regions) {
      const list = districts
        .filter((district) => district.regionCode === region.code)
        .sort((a, b) => a.code - b.code);

      if (list.length === 0) {
        codes.addRow({ regionCode: region.code, regionName: region.name });
        continue;
      }

      for (const district of list) {
        codes.addRow({
          regionCode: region.code,
          regionName: region.name,
          districtCode: district.code,
          districtName: district.name,
        });
      }
    }

    codes.autoFilter = { from: 'A1', to: `D${codes.rowCount}` };

    const data = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Xodim-natijalari-${period}.xlsx` };
  }

  // ═══════════ Fayl o'qish ═══════════

  /** Sarlavha qatorini topib, ustunlarni matni bo'yicha aniqlaydi */
  private detectColumns(sheet: ExcelJS.Worksheet): { headerRow: number; columns: ColumnMap } {
    const limit = Math.min(sheet.rowCount, 10);

    for (let rowIndex = 1; rowIndex <= limit; rowIndex++) {
      const row = sheet.getRow(rowIndex);
      const columns: ColumnMap = {};

      row.eachCell((cell, col) => {
        const key = this.normalize(this.text(cell.value));
        if (!key) return;

        // Tartib muhim: "ustama" matnida "tushum" so'zi ham bor
        if (key === 'pinfl') columns.pinfl ??= col;
        else if (key.startsWith('ustama')) columns.bonus ??= col;
        else if (key.startsWith('hudud')) columns.region ??= col;
        else if (key.startsWith('tuman')) columns.district ??= col;
        else if (key.includes('f.i.sh') || key.includes('fish') || key.startsWith('xodim')) {
          columns.fullName ??= col;
        } else if (key.startsWith('turi') || key.includes('shtat') || key.includes('shartnoma')) {
          columns.type ??= col;
        } else if (key.includes('bajarilishi') || key.includes('tushum')) columns.fact ??= col;
        else if (key.includes('reja')) columns.plan ??= col;
      });

      if (!columns.pinfl) continue;

      // Turi sarlavhasiz bo'lsa — F.I.Sh dan keyingi bo'sh sarlavhali ustun
      if (!columns.type && columns.fullName) {
        const next = columns.fullName + 1;
        if (!this.text(row.getCell(next).value)) {
          columns.type = next;
        }
      }

      return { headerRow: rowIndex, columns };
    }

    throw new BadRequestException('"PINFL" sarlavhasi topilmadi. Shablon tuzilishini saqlang');
  }

  async analyze(period: string, file: Express.Multer.File) {
    this.assertPeriod(period);

    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Faylda varaq topilmadi');
    }

    const { headerRow, columns } = this.detectColumns(sheet);

    const required: [ColumnKey, string][] = [
      ['region', 'Hudud'],
      ['plan', 'Oylik reja'],
      ['fact', 'Reja bajarilishi (tushum)'],
    ];

    for (const [key, label] of required) {
      if (!columns[key]) {
        throw new BadRequestException(`"${label}" ustuni topilmadi`);
      }
    }

    const { regions, districts } = await this.loadReferences();

    const regionByCode = new Map<number, RegionRef>(regions.map((r) => [r.code, r]));
    const regionByName = new Map<string, RegionRef>();
    for (const region of regions) {
      regionByName.set(this.normalize(region.name), region);
      regionByName.set(this.shortKey(region.name), region);
    }

    const districtById = new Map<string, DistrictRef>(districts.map((d) => [d.id, d]));

    const resolveRegion = (raw: string): RegionRef | null => {
      if (/^\d+$/.test(raw)) return regionByCode.get(Number(raw)) ?? null;
      return regionByName.get(this.normalize(raw)) ?? regionByName.get(this.shortKey(raw)) ?? null;
    };

    const resolveDistrict = (regionCode: number, raw: string): DistrictRef | null => {
      if (/^\d+$/.test(raw)) return districtById.get(`${regionCode}-${Number(raw)}`) ?? null;

      const full = this.normalize(raw);
      const short = this.shortKey(raw);

      return (
        districts.find(
          (d) =>
            d.regionCode === regionCode &&
            (this.normalize(d.name) === full || this.shortKey(d.name) === short),
        ) ?? null
      );
    };

    const invalidRows: { rowIndex: number; reason: string }[] = [];
    const unknownDistricts: { rowIndex: number; region: string; value: string }[] = [];
    const parsed: ParsedLine[] = [];
    const seen = new Set<string>();

    for (let rowIndex = headerRow + 1; rowIndex <= sheet.rowCount; rowIndex++) {
      const row = sheet.getRow(rowIndex);
      const cell = (key: ColumnKey) => {
        const col = columns[key];
        return col ? row.getCell(col).value : null;
      };

      const rawPinfl = this.cellValue(cell('pinfl'));

      // PINFL bo'sh — "Jami" yoki bo'sh qator
      if (this.isBlank(rawPinfl)) continue;

      const pinfl = this.parsePinfl(rawPinfl);
      if (!pinfl) {
        invalidRows.push({ rowIndex, reason: 'PINFL notogri' });
        continue;
      }

      if (seen.has(pinfl)) {
        invalidRows.push({ rowIndex, reason: `PINFL takrorlangan: ${pinfl}` });
        continue;
      }

      const regionText = this.text(cell('region'));
      const region = resolveRegion(regionText);

      if (!region) {
        invalidRows.push({ rowIndex, reason: `Hudud topilmadi: "${regionText}"` });
        continue;
      }

      let district: DistrictRef | null = null;
      const districtText = this.text(cell('district'));

      if (districtText) {
        district = resolveDistrict(region.code, districtText);
        if (!district) {
          unknownDistricts.push({ rowIndex, region: region.name, value: districtText });
        }
      }

      const fileType = this.parseType(this.cellValue(cell('type')));
      if (fileType === 'invalid') {
        invalidRows.push({ rowIndex, reason: 'Turi notogri: 1 yoki 2 bolishi kerak' });
        continue;
      }

      const planTiyin = this.parseMoney(this.cellValue(cell('plan')));
      if (planTiyin === null) {
        invalidRows.push({ rowIndex, reason: 'Oylik reja notogri' });
        continue;
      }

      const factTiyin = this.parseMoney(this.cellValue(cell('fact')));
      if (factTiyin === null) {
        invalidRows.push({ rowIndex, reason: 'Tushum notogri' });
        continue;
      }

      let fileBonusTiyin: bigint | null = null;
      if (columns.bonus) {
        const bonus = this.parseMoney(this.cellValue(cell('bonus')));
        if (bonus === null) {
          invalidRows.push({ rowIndex, reason: 'Ustama notogri' });
          continue;
        }
        fileBonusTiyin = bonus;
      }

      seen.add(pinfl);
      parsed.push({
        rowIndex,
        pinfl,
        fileName: this.text(cell('fullName')),
        region,
        district,
        fileType,
        planTiyin,
        factTiyin,
        fileBonusTiyin,
      });
    }

    if (parsed.length === 0) {
      throw new BadRequestException('Faylda yaroqli qator topilmadi');
    }

    // ─── Reestr bilan solishtirish ───
    const employees = await this.prisma.employee.findMany({
      where: { pinfl: { in: parsed.map((row) => row.pinfl) } },
      select: {
        pinfl: true,
        fullName: true,
        regionCode: true,
        districtId: true,
        employmentType: true,
        region: { select: { name: true } },
        district: { select: { name: true } },
      },
    });

    type RegistryEmployee = (typeof employees)[number];
    const employeeMap = new Map<string, RegistryEmployee>(employees.map((e) => [e.pinfl, e]));

    const missing: { rowIndex: number; pinfl: string; fullName: string }[] = [];
    const nameMismatches: { rowIndex: number; pinfl: string; fileName: string; registryName: string }[] = [];
    const locationChanges: { pinfl: string; fullName: string; from: string; to: string }[] = [];
    const typeChanges: { pinfl: string; fullName: string; from: string; to: string }[] = [];
    const bonusMismatches: {
      rowIndex: number;
      pinfl: string;
      fullName: string;
      percent: number | null;
      fileTiyin: bigint;
      expectedTiyin: bigint;
    }[] = [];

    const rows: AnalyzedRow[] = [];

    const describe = (region: string, district: string | null | undefined) =>
      district ? `${region} / ${district}` : region;

    for (const line of parsed) {
      const employee = employeeMap.get(line.pinfl);

      if (!employee) {
        missing.push({ rowIndex: line.rowIndex, pinfl: line.pinfl, fullName: line.fileName });
        continue;
      }

      if (line.fileName && this.normalize(line.fileName) !== this.normalize(employee.fullName)) {
        nameMismatches.push({
          rowIndex: line.rowIndex,
          pinfl: line.pinfl,
          fileName: line.fileName,
          registryName: employee.fullName,
        });
      }

      const regionChanged = employee.regionCode !== line.region.code;
      const districtChanged = line.district !== null && employee.districtId !== line.district.id;

      if (regionChanged || districtChanged) {
        locationChanges.push({
          pinfl: line.pinfl,
          fullName: employee.fullName,
          from: describe(employee.region.name, employee.district?.name),
          to: describe(line.region.name, line.district?.name),
        });
      }

      const registryType = employee.employmentType as EmploymentKind;
      const employmentType = line.fileType ?? registryType;

      if (line.fileType && line.fileType !== registryType) {
        typeChanges.push({
          pinfl: line.pinfl,
          fullName: employee.fullName,
          from: TYPE_LABELS[registryType] ?? registryType,
          to: TYPE_LABELS[line.fileType],
        });
      }

      const expected = this.expectedBonus(line.planTiyin, line.factTiyin);
      const bonus = line.fileBonusTiyin ?? expected;
      const percent = this.percentOf(line.planTiyin, line.factTiyin);

      if (line.fileBonusTiyin !== null) {
        const diff = line.fileBonusTiyin - expected;
        if ((diff < 0n ? -diff : diff) > BONUS_TOLERANCE_TIYIN) {
          bonusMismatches.push({
            rowIndex: line.rowIndex,
            pinfl: line.pinfl,
            fullName: employee.fullName,
            percent,
            fileTiyin: line.fileBonusTiyin,
            expectedTiyin: expected,
          });
        }
      }

      rows.push({
        rowIndex: line.rowIndex,
        pinfl: line.pinfl,
        fullName: employee.fullName,
        regionCode: line.region.code,
        regionName: line.region.name,
        districtId: line.district?.id ?? null,
        districtName: line.district?.name ?? null,
        employmentType,
        planTiyin: line.planTiyin,
        factTiyin: line.factTiyin,
        percent,
        bonusTiyin: bonus,
        expectedBonusTiyin: expected,
      });
    }

    const regionTotals = this.buildRegionTotals(rows);

    const totals = rows.reduce(
      (acc, row) => ({
        planTiyin: acc.planTiyin + row.planTiyin,
        factTiyin: acc.factTiyin + row.factTiyin,
        bonusTiyin: acc.bonusTiyin + row.bonusTiyin,
      }),
      { planTiyin: 0n, factTiyin: 0n, bonusTiyin: 0n },
    );

    const previousCount = await this.prisma.resultBatch.count({
      where: { period, cancelledAt: null },
    });

    return {
      period,
      fileName: file.originalname,
      totalRows: parsed.length + invalidRows.length,
      matchedRows: rows.length,
      planTiyin: totals.planTiyin,
      factTiyin: totals.factTiyin,
      bonusTiyin: totals.bonusTiyin,
      percent: this.percentOf(totals.planTiyin, totals.factTiyin),
      invalidRows,
      missing,
      unknownDistricts,
      nameMismatches,
      locationChanges,
      typeChanges,
      bonusMismatches,
      hasPrevious: previousCount > 0,
      regions: regionTotals,
      rows,
    };
  }

  /** Hududlar bo'yicha yig'indi — hisobot tartibida */
  private buildRegionTotals(
    rows: { regionCode: number; regionName: string; planTiyin: bigint; factTiyin: bigint; bonusTiyin: bigint }[],
  ): RegionTotal[] {
    const map = new Map<number, RegionTotal>();

    for (const row of rows) {
      const item = map.get(row.regionCode) ?? {
        regionCode: row.regionCode,
        name: row.regionName,
        count: 0,
        planTiyin: 0n,
        factTiyin: 0n,
        bonusTiyin: 0n,
        percent: null,
      };

      item.count += 1;
      item.planTiyin += row.planTiyin;
      item.factTiyin += row.factTiyin;
      item.bonusTiyin += row.bonusTiyin;
      map.set(row.regionCode, item);
    }

    return [...map.values()]
      .map((item) => ({ ...item, percent: this.percentOf(item.planTiyin, item.factTiyin) }))
      .sort((a, b) => this.regionPosition(a.regionCode) - this.regionPosition(b.regionCode));
  }

  // ═══════════ Saqlash ═══════════

  /**
   * Natijalarni saqlaydi va shu oy uchun hudud tarixini yozadi.
   * Shu oyning oldingi yuklashi bekor qilinadi — natijalar oylik surat.
   */
  async commit(params: { period: string; rows: ResultRow[]; fileName: string; userId: string }) {
    const { period, rows, fileName, userId } = params;
    this.assertPeriod(period);

    if (rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const pinfls = new Set<string>();

    for (const row of rows) {
      if (!/^\d{14}$/.test(row.pinfl)) {
        throw new BadRequestException(`Notogri PINFL: ${row.pinfl}`);
      }
      if (pinfls.has(row.pinfl)) {
        throw new BadRequestException(`PINFL takrorlangan: ${row.pinfl}`);
      }
      if (row.employmentType !== 'SHTAT' && row.employmentType !== 'SHARTNOMA') {
        throw new BadRequestException(`Xodim turi notogri: ${row.pinfl}`);
      }
      if (row.planTiyin < 0n || row.factTiyin < 0n || row.bonusTiyin < 0n) {
        throw new BadRequestException(`Manfiy summa: ${row.pinfl}`);
      }
      pinfls.add(row.pinfl);
    }

    // Reestr va ma'lumotnomalarni qayta tekshiramiz — frontendga ishonmaymiz
    const [employees, { regions, districts }] = await Promise.all([
      this.prisma.employee.findMany({
        where: { pinfl: { in: [...pinfls] } },
        select: { pinfl: true, regionCode: true, districtId: true, employmentType: true },
      }),
      this.loadReferences(),
    ]);

    if (employees.length !== pinfls.size) {
      throw new BadRequestException(
        `${pinfls.size - employees.length} ta xodim reestrda topilmadi. Faylni qaytadan yuklang`,
      );
    }

    const regionCodes = new Set(regions.map((r) => r.code));
    const districtRegion = new Map<string, number>(districts.map((d) => [d.id, d.regionCode]));

    for (const row of rows) {
      if (!regionCodes.has(row.regionCode)) {
        throw new BadRequestException(`Hudud topilmadi: ${row.regionCode}`);
      }
      if (row.districtId && districtRegion.get(row.districtId) !== row.regionCode) {
        throw new BadRequestException(`Tuman hududga mos emas: ${row.districtId}`);
      }
    }

    const registry = new Map(employees.map((e) => [e.pinfl, e]));

    const movedCount = rows.filter((row) => {
      const employee = registry.get(row.pinfl);
      if (!employee) return false;

      return (
        employee.regionCode !== row.regionCode ||
        (row.districtId !== null && employee.districtId !== row.districtId) ||
        employee.employmentType !== row.employmentType
      );
    }).length;

    const totals = rows.reduce(
      (acc, row) => ({
        planTiyin: acc.planTiyin + row.planTiyin,
        factTiyin: acc.factTiyin + row.factTiyin,
        bonusTiyin: acc.bonusTiyin + row.bonusTiyin,
      }),
      { planTiyin: 0n, factTiyin: 0n, bonusTiyin: 0n },
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Shu oyning oldingi yuklashi bekor qilinadi
        const previous = await tx.resultBatch.findMany({
          where: { period, cancelledAt: null },
          select: { id: true },
        });
        const previousIds = previous.map((item) => item.id);

        if (previousIds.length > 0) {
          await tx.employeeResult.deleteMany({ where: { batchId: { in: previousIds } } });
          await tx.resultBatch.updateMany({
            where: { id: { in: previousIds } },
            data: { cancelledAt: new Date() },
          });
        }

        // Shu oy hudud tarixi qaytadan yoziladi
        await tx.employeeLocation.deleteMany({ where: { period, source: 'RESULTS' } });

        const batch = await tx.resultBatch.create({
          data: {
            period,
            fileName,
            totalRows: rows.length,
            planTiyin: totals.planTiyin,
            factTiyin: totals.factTiyin,
            bonusTiyin: totals.bonusTiyin,
            movedCount,
            uploadedById: userId,
          },
        });

        await tx.employeeResult.createMany({
          data: rows.map((row) => ({
            batchId: batch.id,
            period,
            employeePinfl: row.pinfl,
            regionCode: row.regionCode,
            districtId: row.districtId,
            employmentType: row.employmentType,
            planTiyin: row.planTiyin,
            factTiyin: row.factTiyin,
            bonusTiyin: row.bonusTiyin,
          })),
        });

        await tx.employeeLocation.createMany({
          data: rows.map((row) => ({
            employeePinfl: row.pinfl,
            period,
            regionCode: row.regionCode,
            districtId: row.districtId,
            employmentType: row.employmentType,
            source: 'RESULTS',
          })),
        });

        return { batchId: batch.id, replaced: previousIds.length };
      },
      { timeout: 60_000 },
    );

    // Ish haqi yangi hudud va turga qarab qayta guruhlanadi

    const payroll = await this.payroll.regroup(period);


    return {
      success: true as const,
      batchId: result.batchId,
      payroll,
      saved: rows.length,
      movedCount,
      replacedPrevious: result.replaced > 0,
      ...totals,
    };
  }

  // ═══════════ Bekor qilish ═══════════

  async cancel(batchId: string) {
    const batch = await this.prisma.resultBatch.findUnique({
      where: { id: batchId },
      include: { results: { select: { employeePinfl: true } } },
    });

    if (!batch) {
      throw new NotFoundException('Yuklash topilmadi');
    }
    if (batch.cancelledAt) {
      throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
    }

    const pinfls = batch.results.map((item) => item.employeePinfl);

    await this.prisma.$transaction([
      this.prisma.employeeLocation.deleteMany({
        where: { period: batch.period, source: 'RESULTS', employeePinfl: { in: pinfls } },
      }),
      this.prisma.employeeResult.deleteMany({ where: { batchId } }),
      this.prisma.resultBatch.update({
        where: { id: batchId },
        data: { cancelledAt: new Date() },
      }),
    ]);

    const payroll = await this.payroll.regroup(batch.period);
    return { success: true as const, payroll };
  }

  // ═══════════ Ro'yxatlar ═══════════

  async findBatches(period?: string) {
    return this.prisma.resultBatch.findMany({
      where: period ? { period } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
  }

  /** Oy natijalari — hudud, tuman, xodim bo'yicha */
  async findResults(period: string, regionCode?: number) {
    this.assertPeriod(period);

    const results = await this.prisma.employeeResult.findMany({
      where: {
        period,
        batch: { cancelledAt: null },
        ...(regionCode !== undefined ? { regionCode } : {}),
      },
      include: {
        employee: { select: { fullName: true } },
        region: { select: { name: true } },
        district: { select: { name: true } },
      },
    });

    const rows = results
      .map((item) => ({
        pinfl: item.employeePinfl,
        fullName: item.employee.fullName,
        regionCode: item.regionCode,
        regionName: item.region.name,
        districtId: item.districtId,
        districtName: item.district?.name ?? null,
        employmentType: item.employmentType as EmploymentKind,
        planTiyin: item.planTiyin,
        factTiyin: item.factTiyin,
        bonusTiyin: item.bonusTiyin,
        percent: this.percentOf(item.planTiyin, item.factTiyin),
      }))
      .sort(
        (a, b) =>
          this.regionPosition(a.regionCode) - this.regionPosition(b.regionCode) ||
          (a.districtName ?? '').localeCompare(b.districtName ?? '') ||
          a.fullName.localeCompare(b.fullName),
      );

    const totals = rows.reduce(
      (acc, row) => ({
        planTiyin: acc.planTiyin + row.planTiyin,
        factTiyin: acc.factTiyin + row.factTiyin,
        bonusTiyin: acc.bonusTiyin + row.bonusTiyin,
      }),
      { planTiyin: 0n, factTiyin: 0n, bonusTiyin: 0n },
    );

    return {
      rows,
      regions: this.buildRegionTotals(rows),
      totals: { ...totals, percent: this.percentOf(totals.planTiyin, totals.factTiyin) },
    };
  }
}
