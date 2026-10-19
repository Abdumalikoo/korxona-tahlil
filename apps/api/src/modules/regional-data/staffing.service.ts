import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { regionalEmployees } from './rd.employees';
import { cellText, cleanText, currentPeriod, excelDate, parseDay, parseTiyin, somToTiyin, todayTashkent, ymd } from './rd.util';

// ═══════════════════════════════════════════════════════════
// Shtat va maosh: hudud xodimlarining stavkasi (1 / 0,5 …) va lavozim maoshi — amal qilish sanasi bilan.
// Ish haqi prognozi (3-bosqich) shu tarixga tayanadi: «qaysi oyda kim qancha stavkada, qancha maoshda».
// Qo'lda yoki Excel (PINFL · Stavka · Maosh · Lavozim · Sanadan) bilan kiritiladi.
// ═══════════════════════════════════════════════════════════

export interface SalaryInput {
  effectiveFrom?: string;
  rate?: number | string;
  baseSalaryTiyin?: string | number;
  position?: string | null;
  note?: string | null;
}

export interface SalaryImportRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  effectiveFrom: string;
  rate: number;
  baseSalaryTiyin: string;
  position: string | null;
  change: 'NEW' | 'UPDATE' | 'SAME';
}

function parseRate(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 2) throw new BadRequestException("Stavka 0 dan katta va 2 dan oshmasin (masalan 1 yoki 0,5)");
  return Math.round(n * 1000) / 1000;
}

@Injectable()
export class StaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Hudud xodimlari va ularning amaldagi stavka/maoshi (bugungi holat) */
  async list() {
    const period = currentPeriod();
    const [emps, regions, salaries] = await Promise.all([
      regionalEmployees(this.prisma, period),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.employeeSalary.findMany({ orderBy: { effectiveFrom: 'desc' } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const today = new Date(`${todayTashkent()}T00:00:00Z`);
    const byPinfl = new Map<string, typeof salaries>();
    for (const s of salaries) byPinfl.set(s.employeePinfl, [...(byPinfl.get(s.employeePinfl) ?? []), s]);
    const rows = emps
      .map((e) => {
        const hist = byPinfl.get(e.pinfl) ?? [];
        const cur = hist.find((h) => h.effectiveFrom <= today) ?? null;
        const next = hist.filter((h) => h.effectiveFrom > today).at(-1) ?? null;
        return {
          pinfl: e.pinfl,
          fullName: e.fullName,
          regionCode: e.regionCode,
          regionName: regionName.get(e.regionCode) ?? String(e.regionCode),
          position: cur?.position ?? e.position,
          employmentType: e.employmentType,
          rate: cur?.rate ?? null,
          baseSalaryTiyin: cur ? cur.baseSalaryTiyin.toString() : null,
          effectiveFrom: cur ? ymd(cur.effectiveFrom) : null,
          upcoming: next ? { effectiveFrom: ymd(next.effectiveFrom), rate: next.rate, baseSalaryTiyin: next.baseSalaryTiyin.toString() } : null,
          changes: hist.length,
        };
      })
      .sort((a, b) => a.regionCode - b.regionCode || a.fullName.localeCompare(b.fullName));
    const filled = rows.filter((r) => r.rate !== null).length;
    const fte = rows.reduce((s, r) => s + (r.rate ?? 0), 0);
    return { employees: rows, total: rows.length, filled, fte: Math.round(fte * 100) / 100 };
  }

  async history(pinfl: string) {
    const emp = await this.prisma.employee.findUnique({ where: { pinfl }, select: { pinfl: true, fullName: true } });
    if (!emp) throw new NotFoundException('Xodim topilmadi');
    const rows = await this.prisma.employeeSalary.findMany({ where: { employeePinfl: pinfl }, orderBy: { effectiveFrom: 'desc' } });
    return {
      pinfl,
      fullName: emp.fullName,
      items: rows.map((r) => ({ id: r.id, effectiveFrom: ymd(r.effectiveFrom), rate: r.rate, baseSalaryTiyin: r.baseSalaryTiyin.toString(), position: r.position, note: r.note, source: r.source, createdAt: r.createdAt.toISOString() })),
    };
  }

  private async assertRegional(pinfl: string) {
    const period = currentPeriod();
    const emps = await regionalEmployees(this.prisma, period);
    const e = emps.find((x) => x.pinfl === pinfl);
    if (!e) throw new BadRequestException("Bu xodim hudud xodimi emas (yoki ishlamayapti). Markaz xodimlari — Xodimlar bo'limida");
    return e;
  }

  async add(pinfl: string, input: SalaryInput, userId: string) {
    const e = await this.assertRegional(pinfl);
    const effectiveFrom = parseDay(input.effectiveFrom, 'Amal qilish sanasi');
    const rate = parseRate(input.rate);
    const base = parseTiyin(input.baseSalaryTiyin, 'Maosh');
    const position = cleanText(input.position, 200, 'Lavozim');
    const note = cleanText(input.note, 300, 'Izoh');
    const existing = await this.prisma.employeeSalary.findUnique({ where: { employeePinfl_effectiveFrom: { employeePinfl: pinfl, effectiveFrom } } });
    if (existing) {
      await this.prisma.employeeSalary.update({ where: { id: existing.id }, data: { rate, baseSalaryTiyin: base, position, note, source: 'MANUAL' } });
    } else {
      await this.prisma.employeeSalary.create({ data: { employeePinfl: pinfl, effectiveFrom, rate, baseSalaryTiyin: base, position, note, source: 'MANUAL', createdById: userId } });
    }
    await this.audit.log({ userId, action: existing ? 'UPDATE' : 'CREATE', entity: 'employee_salary', entityId: pinfl, summary: `${e.fullName}: ${ymd(effectiveFrom)} dan stavka ${rate}, maosh ${(Number(base) / 100).toLocaleString('ru-RU')} so'm` });
    return this.history(pinfl);
  }

  async remove(id: string, userId: string) {
    const row = await this.prisma.employeeSalary.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Yozuv topilmadi");
    await this.assertRegional(row.employeePinfl);
    await this.prisma.employeeSalary.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'employee_salary', entityId: row.employeePinfl, summary: `Maosh yozuvi o'chirildi: ${ymd(row.effectiveFrom)}` });
    return this.history(row.employeePinfl);
  }

  /** Shablon: hudud xodimlari, amaldagi qiymatlar to'ldirilgan (o'zgarganini yozasiz) */
  async template(): Promise<{ buffer: Buffer; filename: string }> {
    const { employees } = await this.list();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Shtat va maosh', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'PINFL', key: 'pinfl', width: 18 },
      { header: 'F.I.Sh.', key: 'fullName', width: 38 },
      { header: 'Hudud', key: 'region', width: 22 },
      { header: 'Stavka', key: 'rate', width: 10 },
      { header: "Maosh (so'm, to'liq stavka)", key: 'salary', width: 22 },
      { header: 'Lavozim', key: 'position', width: 30 },
      { header: 'Amal qilish sanasi', key: 'from', width: 18 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    head.alignment = { wrapText: true, vertical: 'middle' };
    head.height = 32;
    ws.getColumn('pinfl').numFmt = '@';
    ws.getColumn('salary').numFmt = '#,##0';
    ws.getColumn('from').numFmt = 'dd.mm.yyyy';
    for (const e of employees) {
      ws.addRow({ pinfl: e.pinfl, fullName: e.fullName, region: e.regionName, rate: e.rate ?? null, salary: e.baseSalaryTiyin ? Number(e.baseSalaryTiyin) / 100 : null, position: e.position ?? '', from: e.effectiveFrom ? new Date(`${e.effectiveFrom}T00:00:00Z`) : null });
    }
    const info = wb.addWorksheet("Yo'riqnoma");
    info.getColumn(1).width = 100;
    [
      "Stavka: 1 — to'liq, 0,5 — yarim stavka.",
      "Maosh: lavozim maoshi oyiga, to'liq stavka uchun (so'm). Haqiqiy hisoblangan summa — ish haqi vedomostida.",
      "Amal qilish sanasi: shu sanadan boshlab yangi stavka/maosh kuchga kiradi. O'zgarmagan xodimlar qatorini o'zgartirmang.",
      "Bo'sh qatorlar o'tkazib yuboriladi. Faqat hudud xodimlari qabul qilinadi.",
    ].forEach((t) => info.addRow([t]));
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Shtat-va-maosh-${todayTashkent()}.xlsx` };
  }

  async analyzeImport(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi (.xlsx bo'lishi kerak)");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Faylda varaq topilmadi');
    // Ustunlar sarlavha bo'yicha topiladi
    const col: Record<string, number> = {};
    ws.getRow(1).eachCell((c, i) => {
      const t = cellText(c.value).toLowerCase();
      if (t.startsWith('pinfl')) col.pinfl = i;
      else if (t.startsWith('stavka')) col.rate = i;
      else if (t.startsWith('maosh')) col.salary = i;
      else if (t.startsWith('lavozim')) col.position = i;
      else if (t.startsWith('amal') || t.includes('sana')) col.from = i;
    });
    if (!col.pinfl || !col.rate || !col.salary || !col.from) throw new BadRequestException("Ustunlar topilmadi: PINFL, Stavka, Maosh, Amal qilish sanasi (shablondan foydalaning)");
    const emps = new Map((await regionalEmployees(this.prisma, currentPeriod())).map((e) => [e.pinfl, e]));
    const existing = await this.prisma.employeeSalary.findMany({ where: { employeePinfl: { in: [...emps.keys()] } } });
    const exist = new Map(existing.map((s) => [`${s.employeePinfl}|${ymd(s.effectiveFrom)}`, s]));
    const latest = new Map<string, (typeof existing)[number]>();
    for (const s of existing) {
      const l = latest.get(s.employeePinfl);
      if (!l || s.effectiveFrom > l.effectiveFrom) latest.set(s.employeePinfl, s);
    }
    const rows: SalaryImportRow[] = [];
    const errors: { rowIndex: number; reason: string }[] = [];
    const notRegional: { rowIndex: number; pinfl: string }[] = [];
    const seen = new Set<string>();
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const pinfl = cellText(row.getCell(col.pinfl).value).replace(/\D/g, '');
      const rateRaw = cellText(row.getCell(col.rate).value);
      const salaryRaw = row.getCell(col.salary).value;
      if (!pinfl && !rateRaw) continue;
      if (!/^\d{14}$/.test(pinfl)) {
        errors.push({ rowIndex: r, reason: "PINFL 14 raqam bo'lishi kerak" });
        continue;
      }
      const e = emps.get(pinfl);
      if (!e) {
        notRegional.push({ rowIndex: r, pinfl });
        continue;
      }
      if (!rateRaw && (salaryRaw === null || salaryRaw === undefined || cellText(salaryRaw) === '')) continue; // to'ldirilmagan
      let rate: number;
      try {
        rate = parseRate(rateRaw);
      } catch (err) {
        errors.push({ rowIndex: r, reason: (err as Error).message });
        continue;
      }
      const salary = somToTiyin(salaryRaw);
      if (salary === undefined || salary === null || salary <= 0n) {
        errors.push({ rowIndex: r, reason: "Maosh noto'g'ri yoki bo'sh" });
        continue;
      }
      const from = excelDate(row.getCell(col.from).value);
      if (!from) {
        errors.push({ rowIndex: r, reason: 'Amal qilish sanasi noto‘g‘ri (01.09.2026 yoki 2026-09-01)' });
        continue;
      }
      const key = `${pinfl}|${from}`;
      if (seen.has(key)) {
        errors.push({ rowIndex: r, reason: 'Shu xodim va sana ikki marta yozilgan' });
        continue;
      }
      seen.add(key);
      const position = col.position ? cellText(row.getCell(col.position).value) || null : null;
      const same = exist.get(key);
      const last = latest.get(pinfl);
      const unchanged = (s: (typeof existing)[number] | undefined) => s && s.rate === rate && s.baseSalaryTiyin === salary && (s.position ?? null) === position;
      const change: SalaryImportRow['change'] = unchanged(same) || (!same && unchanged(last) && last && ymd(last.effectiveFrom) <= from) ? 'SAME' : same ? 'UPDATE' : 'NEW';
      rows.push({ rowIndex: r, pinfl, fullName: e.fullName, effectiveFrom: from, rate, baseSalaryTiyin: salary.toString(), position, change });
    }
    return {
      fileName: file.originalname,
      rows,
      changed: rows.filter((r) => r.change !== 'SAME').length,
      errors,
      notRegional,
    };
  }

  async commitImport(rowsRaw: unknown, userId: string) {
    const rows = (Array.isArray(rowsRaw) ? rowsRaw : []) as SalaryImportRow[];
    const todo = rows.filter((r) => r && r.change !== 'SAME');
    if (!todo.length) throw new BadRequestException("Saqlash uchun o'zgarish yo'q");
    if (todo.length > 5000) throw new BadRequestException("Qatorlar juda ko'p");
    const emps = new Set((await regionalEmployees(this.prisma, currentPeriod())).map((e) => e.pinfl));
    let saved = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of todo) {
        if (!emps.has(String(r.pinfl))) throw new BadRequestException(`Hudud xodimi emas: ${r.pinfl}`);
        const effectiveFrom = parseDay(r.effectiveFrom, 'Amal qilish sanasi');
        const rate = parseRate(r.rate);
        const base = parseTiyin(r.baseSalaryTiyin, 'Maosh');
        const position = cleanText(r.position, 200, 'Lavozim');
        const found = await tx.employeeSalary.findUnique({ where: { employeePinfl_effectiveFrom: { employeePinfl: String(r.pinfl), effectiveFrom } } });
        if (found) await tx.employeeSalary.update({ where: { id: found.id }, data: { rate, baseSalaryTiyin: base, position, source: 'IMPORT' } });
        else await tx.employeeSalary.create({ data: { employeePinfl: String(r.pinfl), effectiveFrom, rate, baseSalaryTiyin: base, position, source: 'IMPORT', createdById: userId } });
        saved++;
      }
    });
    await this.audit.log({ userId, action: 'IMPORT', entity: 'employee_salary', entityId: 'import', summary: `Shtat va maosh: ${saved} ta yozuv Excel'dan saqlandi` });
    return { saved };
  }
}