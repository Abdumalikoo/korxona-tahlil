import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ReactionsService } from './reactions.service';
import type { ItemKind, ReactionDetail, Verdict } from './reactions.types';
import { gainWorking, itemWorkings, KEY_FORMULAS } from './reactions.workings';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const KIND_LABEL: Record<ItemKind, string> = { INCOME: 'Daromad', EXPENSE: 'Xarajat', RESULT: 'Natija (daromad − xarajat)' };
const VERDICT_LABEL: Record<Verdict, string> = { better: 'Yaxshilandi', worse: 'Yomonlashdi', same: "O'zgarishsiz", nodata: 'Boshlanmagan' };
const STATUS_LABEL = { OPEN: 'Kuzatilmoqda', CLOSED: 'Yopilgan', CONTROL: "Nazoratga o'tkazilgan" } as const;

const NAVY = 'FF1B3354';
const GREEN = 'FF2F7A57';
const RED = 'FFB3423B';
const GREY_FILL = 'FFF3F4F6';
const GREEN_FILL = 'FFE3F1E9';
const RED_FILL = 'FFF6E1DF';
const LINE = 'FFD1D5DB';
const MONEY = '#,##0';

function som(tiyin: string | number): number {
  return Math.round(Number(tiyin) / 100);
}

function monthLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]?.slice(0, 3) ?? m} ${y}`;
}

function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Munosabat hisoboti — Excel (xulosa, moddalar, oylar, yozuvlar, mas'ullar) */
@Injectable()
export class ReactionsReportService {
  constructor(private readonly reactions: ReactionsService) {}

  async build(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.reactions.detail(id);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    this.summarySheet(workbook, data);
    this.workingsSheet(workbook, data);
    this.monthsSheet(workbook, data);
    this.recordsSheet(workbook, data);
    this.assigneesSheet(workbook, data);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const safe = data.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'munosabat';
    return { buffer, filename: `Munosabat - ${safe} - ${data.startDate}.xlsx` };
  }

  // ─────────── Yordamchilar ───────────

  private header(row: ExcelJS.Row) {
    row.height = 30;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } };
    });
  }

  private body(row: ExcelJS.Row) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
      cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle' };
    });
  }

  private title(sheet: ExcelJS.Worksheet, text: string, span: number, sub?: string) {
    sheet.mergeCells(1, 1, 1, span);
    const cell = sheet.getCell(1, 1);
    cell.value = text;
    cell.font = { bold: true, size: 16, color: { argb: NAVY } };
    sheet.getRow(1).height = 28;
    if (sub) {
      sheet.mergeCells(2, 1, 2, span);
      const s = sheet.getCell(2, 1);
      s.value = sub;
      s.font = { size: 10, color: { argb: 'FF6B7280' } };
    }
  }

  // ─────────── 1. Xulosa ───────────

  private summarySheet(workbook: ExcelJS.Workbook, data: ReactionDetail) {
    const sheet = workbook.addWorksheet('Xulosa', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } });
    sheet.columns = [
      { width: 5 },
      { width: 38 },
      { width: 16 },
      { width: 16 },
      { width: 15 },
      { width: 16 },
      { width: 15 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 16 },
    ];
    this.title(sheet, data.title, 11, `Munosabat hisoboti · tayyorlangan: ${uzDate(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10))}`);

    // Asosiy ma'lumot
    const info: [string, string][] = [
      ['Holati', `${STATUS_LABEL[data.status]}${data.overdue ? ' · muddat tugagan' : ''}`],
      ['Kuzatuv davri', `${uzDate(data.startDate)} — ${uzDate(data.dueDate)} (${data.daysTotal} kun; o'tdi: ${data.daysPassed}, qoldi: ${data.daysLeft})`],
      ['Solishtirish bazasi', `${uzDate(data.baseFrom)} — ${uzDate(data.baseTo)} (belgilashdan oldingi teng davr)`],
      ["Mas'ullar", data.assignees.length ? data.assignees.map((a) => `${a.fullName}${a.position ? ` (${a.position})` : ''} — ${a.role}`).join('; ') : 'Biriktirilmagan'],
      ['Izoh', data.note ?? '—'],
    ];
    let r = 4;
    for (const [label, value] of info) {
      sheet.getCell(r, 2).value = label;
      sheet.getCell(r, 2).font = { bold: true, color: { argb: 'FF374151' } };
      sheet.mergeCells(r, 3, r, 11);
      sheet.getCell(r, 3).value = value;
      sheet.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
      sheet.getRow(r).height = value.length > 110 ? 30 : 18;
      r += 1;
    }

    // Ko'rsatkichlar
    r += 1;
    const kpis: [string, string | number, string?][] = [
      ['Moddalar', data.itemCount],
      ['Yaxshilandi', data.better, GREEN],
      ['Yomonlashdi', data.worse, RED],
      ["Umumiy ta'sir, so'm", som(data.gainTiyin), Number(data.gainTiyin) >= 0 ? GREEN : RED],
    ];
    const kpiColumns = [2, 4, 6, 8];
    kpis.forEach(([label, value, color], i) => {
      const c = kpiColumns[i]!;
      sheet.getCell(r, c).value = label;
      sheet.getCell(r, c).font = { size: 9, color: { argb: 'FF6B7280' } };
      const v = sheet.getCell(r + 1, c);
      v.value = value;
      v.font = { bold: true, size: 16, color: { argb: color ?? NAVY } };
      if (typeof value === 'number' && i === 3) v.numFmt = MONEY;
      v.alignment = { horizontal: 'left' };
    });
    r += 3;

    // Xulosalar
    sheet.getCell(r, 2).value = 'Asosiy xulosalar';
    sheet.getCell(r, 2).font = { bold: true, size: 12, color: { argb: NAVY } };
    r += 1;
    data.conclusions.forEach((note, i) => {
      sheet.getCell(r, 1).value = `${i + 1}.`;
      sheet.getCell(r, 1).alignment = { horizontal: 'right', vertical: 'top' };
      sheet.mergeCells(r, 2, r, 11);
      sheet.getCell(r, 2).value = note;
      sheet.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
      sheet.getRow(r).height = note.length > 150 ? 30 : 18;
      r += 1;
    });

    // Moddalar jadvali
    r += 1;
    sheet.getCell(r, 2).value = "Moddalar bo'yicha natija";
    sheet.getCell(r, 2).font = { bold: true, size: 12, color: { argb: NAVY } };
    r += 1;
    const head = sheet.getRow(r);
    head.values = ['№', 'Modda', 'Turi', "Baza, jami", 'Baza, kuniga', 'Kuzatuv, jami', 'Kuzatuv, kuniga', 'Kutilgan (baza sur\'atida)', "Farq (ta'sir)", "O'zgarish, %", 'Holat'];
    this.header(head);
    data.items.forEach((item, i) => {
      r += 1;
      const row = sheet.getRow(r);
      row.values = [
        i + 1,
        item.label,
        KIND_LABEL[item.kind],
        som(item.base.sumTiyin),
        som(item.base.perDayTiyin),
        som(item.track.sumTiyin),
        som(item.track.perDayTiyin),
        som(item.expectedTiyin),
        som(item.effectTiyin),
        item.changePercent === null ? null : item.changePercent / 100,
        VERDICT_LABEL[item.verdict],
      ];
      for (const c of [4, 5, 6, 7, 8, 9]) row.getCell(c).numFmt = MONEY;
      row.getCell(10).numFmt = '+0.0%;-0.0%;0.0%';
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).alignment = { wrapText: true };
      const fill = item.verdict === 'better' ? GREEN_FILL : item.verdict === 'worse' ? RED_FILL : GREY_FILL;
      const font = item.verdict === 'better' ? GREEN : item.verdict === 'worse' ? RED : 'FF4B5563';
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      row.getCell(11).font = { bold: true, color: { argb: font } };
      row.getCell(11).alignment = { horizontal: 'center' };
      row.getCell(9).font = { color: { argb: font } };
      this.body(row);
    });
    if (data.items.length) {
      r += 1;
      const total = sheet.getRow(r);
      total.getCell(2).value = 'Izoh: xarajat uchun manfiy farq — tejalgan summa, daromad uchun musbat farq — qo\'shimcha tushum.';
      total.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
      sheet.mergeCells(r, 2, r, 11);

      // Asosiy formulalar — har bir modda ishlanishi «Hisob-kitob» varag'ida
      r += 2;
      sheet.getCell(r, 2).value = 'Hisob-kitob formulalari';
      sheet.getCell(r, 2).font = { bold: true, size: 11, color: { argb: NAVY } };
      for (const line of KEY_FORMULAS) {
        r += 1;
        sheet.getCell(r, 2).value = `• ${line}`;
        sheet.getCell(r, 2).font = { size: 9.5, color: { argb: 'FF374151' } };
        sheet.mergeCells(r, 2, r, 11);
      }
      r += 1;
      sheet.getCell(r, 2).value = "Har bir modda bo'yicha sonlar bilan ishlanishi — «Hisob-kitob» varag'ida.";
      sheet.getCell(r, 2).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
      sheet.mergeCells(r, 2, r, 11);
    }
    sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: 2 }];
  }

  // ─────────── 1b. Hisob-kitob (har modda, qadamma-qadam) ───────────

  private workingsSheet(workbook: ExcelJS.Workbook, data: ReactionDetail) {
    const sheet = workbook.addWorksheet('Hisob-kitob', { views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    this.title(sheet, 'Hisob-kitob — sonlar bilan ishlanishi', 5, "Saytdagi «Qanday hisoblandi?» bilan bir xil formulalar");
    sheet.columns = [{ width: 5 }, { width: 26 }, { width: 46 }, { width: 70 }, { width: 30 }];
    const head = sheet.getRow(3);
    head.values = ['№', "Ko'rsatkich", 'Formula', 'Ishlanishi', 'Javob'];
    this.header(head);
    let r = 3;
    const block = (title: string) => {
      r += 1;
      sheet.mergeCells(r, 1, r, 5);
      const cell = sheet.getCell(r, 1);
      cell.value = title;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      sheet.getRow(r).height = 20;
    };
    const line = (n: number, w: { title: string; formula: string; steps: string[]; result: string }) => {
      r += 1;
      const row = sheet.getRow(r);
      row.values = [n, w.title, w.formula, w.steps.join('\n'), w.result];
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
      for (const c of [2, 3, 4, 5]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(5).font = { bold: true };
      row.height = Math.max(18, 15 * Math.max(w.steps.length, Math.ceil(w.formula.length / 48), Math.ceil(w.steps.join(' ').length / 72)));
      this.body(row);
    };

    block("Umumiy ta'sir");
    line(1, gainWorking(data.items, Number(data.gainTiyin)));
    data.items.forEach((item, i) => {
      block(`${i + 1}. ${item.label} (${KIND_LABEL[item.kind]})`);
      itemWorkings(item).forEach((w, j) => line(j + 1, w));
    });
  }

  // ─────────── 2. Oylar ───────────

  private monthsSheet(workbook: ExcelJS.Workbook, data: ReactionDetail) {
    const sheet = workbook.addWorksheet('Oylar', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3, showGridLines: false }] });
    const months = data.items[0]?.months ?? [];
    this.title(sheet, "Oylar kesimida (so'm)", Math.max(3, months.length + 2), "So'nggi 24 oy — har modda bo'yicha oylik summa");
    sheet.getColumn(1).width = 38;
    sheet.getColumn(2).width = 14;
    months.forEach((_, i) => (sheet.getColumn(3 + i).width = 13));
    const head = sheet.getRow(3);
    head.values = ['Modda', 'Turi', ...months.map(monthLabel)];
    this.header(head);
    data.items.forEach((item, i) => {
      const row = sheet.getRow(4 + i);
      row.values = [item.label, KIND_LABEL[item.kind], ...item.monthly.map((v) => som(v))];
      for (let c = 3; c < 3 + months.length; c += 1) row.getCell(c).numFmt = MONEY;
      this.body(row);
    });
  }

  // ─────────── 3. Yozuvlar ───────────

  private recordsSheet(workbook: ExcelJS.Workbook, data: ReactionDetail) {
    const sheet = workbook.addWorksheet('Yirik yozuvlar', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
    this.title(sheet, 'Kuzatuv davridagi eng katta yozuvlar', 6, 'Har modda bo\'yicha summasi eng katta yozuvlar');
    sheet.columns = [{ width: 34 }, { width: 12 }, { width: 11 }, { width: 44 }, { width: 22 }, { width: 16 }];
    const head = sheet.getRow(3);
    head.values = ['Modda', 'Sana', 'Turi', 'Tavsif', 'Joy', "Summa, so'm"];
    this.header(head);
    let r = 3;
    for (const item of data.items) {
      if (item.topRecords.length === 0) continue;
      for (const record of item.topRecords) {
        r += 1;
        const row = sheet.getRow(r);
        row.values = [item.label, uzDate(record.date), record.kind === 'INCOME' ? 'Daromad' : 'Xarajat', record.label, record.place, som(record.amountTiyin)];
        row.getCell(6).numFmt = MONEY;
        row.getCell(4).alignment = { wrapText: true };
        this.body(row);
      }
    }
    if (r === 3) sheet.getCell(4, 1).value = "Kuzatuv davrida yozuv yo'q";
  }

  // ─────────── 4. Mas'ullar ───────────

  private assigneesSheet(workbook: ExcelJS.Workbook, data: ReactionDetail) {
    const sheet = workbook.addWorksheet("Mas'ullar", { views: [{ showGridLines: false }] });
    this.title(sheet, "Mas'ul xodimlar", 5, `Muddat: ${uzDate(data.dueDate)}`);
    sheet.columns = [{ width: 5 }, { width: 36 }, { width: 30 }, { width: 14 }, { width: 18 }];
    const head = sheet.getRow(3);
    head.values = ['№', 'F.I.Sh.', 'Lavozim', 'Roli', 'PINFL'];
    this.header(head);
    data.assignees.forEach((a, i) => {
      const row = sheet.getRow(4 + i);
      row.values = [i + 1, a.fullName, a.position ?? '—', a.role, a.pinfl];
      this.body(row);
    });
    if (data.assignees.length === 0) sheet.getCell(4, 2).value = 'Biriktirilmagan';
  }
}