import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { explainColumn, GENERAL_RULES } from './export-glossary';

// ═══════════════════════════════════════════════════════════
// Excel eksport — hamma sahifa jadvali bitta tushunarli faylga (.xlsx):
//  1) «Jadval» — sarlavha, davr, sahifa; bezatilgan ustunlar, so'm va foiz formatlari, jami qatorlar ajratilgan,
//     sarlavha qotirilgan, filtr, ustun kengliklari;
//  2) «Tushuntirish» — sahifa nima ko'rsatadi, ma'lumot qayerdan; har ustun: nima, qanday hisoblanadi, qayerdan;
//     umumiy qoidalar (soliqlar 12/12, QQS, Qo'mita, xodim joylashuvi); jadval hisob-kitobi;
//  3) «Ma'lumot» — qachon, qaysi sahifadan, nechta qator.
// Ma'lumot brauzerdagi jadvaldan keladi (ko'rinib turganidek); server faqat faylni chiroyli va tushunarli qiladi.
// ═══════════════════════════════════════════════════════════

type Cell = string | number | null;

export interface ExportBody {
  fileName?: unknown;
  title?: unknown;
  page?: unknown;
  period?: unknown;
  header?: unknown;
  rows?: unknown;
  workings?: unknown;
}

const MAX_ROWS = 50_000;
const MAX_COLS = 120;
const MAX_TEXT = 2000;

const BRAND = 'FF1E3A8A';
const HEAD_FILL = 'FFDBEAFE';
const TOTAL_FILL = 'FFEFF6FF';
const SECTION_FILL = 'FFF1F5F9';
const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : v === null || v === undefined ? '' : String(v).slice(0, max));

/** Ustun turi sarlavhasiga qarab: foiz, pul (so'm) yoki son */
function columnKind(header: string, values: Cell[]): 'pct' | 'money' | 'count' | 'text' {
  if (!values.some((v) => typeof v === 'number')) return 'text';
  if (/%|foiz|ulush|rentabel|bajarilish/i.test(header)) return 'pct';
  if (/soni|son\b|\bta\b|xodim(?!.*(haqi|ga))|kun|oylar soni/i.test(header) && !/so['‘’]m/i.test(header)) return 'count';
  return 'money';
}

@Injectable()
export class ExportXlsxService {
  async build(body: ExportBody): Promise<{ buffer: Buffer; filename: string }> {
    if (!Array.isArray(body?.header) || !body.header.length) throw new BadRequestException('Jadval sarlavhasi yo‘q');
    if (!Array.isArray(body.rows)) throw new BadRequestException('Jadval qatorlari yo‘q');
    if (body.header.length > MAX_COLS) throw new BadRequestException(`Ustunlar juda ko‘p — ${MAX_COLS} tagacha`);
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko‘p — ${MAX_ROWS} tagacha`);
    const header = (body.header as unknown[]).map((h) => text(h, 200));
    const rows: Cell[][] = (body.rows as unknown[]).map((r) =>
      (Array.isArray(r) ? r : []).slice(0, header.length).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined || v === '' ? null : text(v))),
    );
    const workings: Cell[][] = Array.isArray(body.workings) ? (body.workings as unknown[]).slice(0, 2000).map((r) => (Array.isArray(r) ? r.slice(0, 6).map((v) => (typeof v === 'number' ? v : text(v))) : [])) : [];
    const page = (body.page && typeof body.page === 'object' ? body.page : {}) as { path?: unknown; name?: unknown; what?: unknown; from?: unknown; how?: unknown };
    const title = text(body.title, 200) || text(page.name, 200) || text(body.fileName, 200) || 'Jadval';
    const period = (body.period && typeof body.period === 'object' ? body.period : {}) as { from?: unknown; to?: unknown };
    const periodText = period.from && period.to ? `${text(period.from, 10)} — ${text(period.to, 10)}` : '';
    const now = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    wb.created = new Date();

    // ── 1. Jadval ──
    const ws = wb.addWorksheet('Jadval', { views: [{ state: 'frozen', ySplit: 5, xSplit: Math.min(2, header.length) }], properties: { defaultRowHeight: 18 } });
    const kinds = header.map((h, i) => columnKind(h, rows.map((r) => r[i] ?? null)));
    ws.mergeCells(1, 1, 1, Math.max(1, header.length));
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: BRAND } };
    ws.getRow(1).height = 24;
    ws.mergeCells(2, 1, 2, Math.max(1, header.length));
    ws.getCell(2, 1).value = [periodText && `Davr: ${periodText}`, text(page.name, 120) && `Sahifa: ${text(page.name, 120)}`, `Yuklab olindi: ${now}`, "Pul — so'mda"].filter(Boolean).join('   ·   ');
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF475569' } };
    ws.mergeCells(3, 1, 3, Math.max(1, header.length));
    ws.getCell(3, 1).value = "Har ustun nimani bildirishi va qanday hisoblanishi — «Tushuntirish» varag'ida.";
    ws.getCell(3, 1).font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
    const head = ws.getRow(5);
    header.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FF0F172A' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = BORDER;
      const note = explainColumn(h);
      if (note) c.note = [note.meaning, note.formula].filter(Boolean).join('\n');
    });
    head.height = 34;
    rows.forEach((r, ri) => {
      const row = ws.getRow(6 + ri);
      const first = typeof r[0] === 'string' ? r[0] : '';
      const isTotal = /^(jami|korxona jami|hammasi|o['‘’]z xarajati jami)/i.test(first.trim());
      header.forEach((_, ci) => {
        const c = row.getCell(ci + 1);
        const v = r[ci] ?? null;
        c.value = v;
        c.border = BORDER;
        if (typeof v === 'number') {
          c.numFmt = kinds[ci] === 'pct' ? '0.0"%";[Red]-0.0"%"' : kinds[ci] === 'count' ? '#,##0' : '#,##0;[Red]-#,##0';
          c.alignment = { horizontal: 'right' };
        } else c.alignment = { vertical: 'top', wrapText: ci < 2 };
        if (isTotal) {
          c.font = { bold: true };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
        }
      });
    });
    header.forEach((h, i) => {
      const lens = [h.length, ...rows.slice(0, 500).map((r) => (r[i] === null || r[i] === undefined ? 0 : typeof r[i] === 'number' ? Math.round(Number(r[i])).toLocaleString('ru').length + 2 : String(r[i]).length))];
      ws.getColumn(i + 1).width = Math.min(i < 2 ? 48 : 22, Math.max(10, Math.max(...lens) + 2));
    });
    if (rows.length) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: header.length } };

    // ── 2. Tushuntirish ──
    const ex = wb.addWorksheet('Tushuntirish');
    ex.getColumn(1).width = 34;
    ex.getColumn(2).width = 70;
    ex.getColumn(3).width = 60;
    ex.getColumn(4).width = 40;
    let y = 1;
    const section = (label: string) => {
      y += y > 1 ? 1 : 0;
      ex.mergeCells(y, 1, y, 4);
      const c = ex.getCell(y, 1);
      c.value = label;
      c.font = { bold: true, size: 12, color: { argb: BRAND } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
      y += 1;
    };
    const line = (cells: Cell[], opts: { bold?: boolean; head?: boolean } = {}) => {
      cells.forEach((v, i) => {
        const c = ex.getCell(y, i + 1);
        c.value = v;
        c.alignment = { vertical: 'top', wrapText: true };
        if (opts.bold || opts.head) c.font = { bold: true };
        if (opts.head) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
          c.border = BORDER;
        }
      });
      y += 1;
    };
    ex.mergeCells(1, 1, 1, 4);
    ex.getCell(1, 1).value = `${title} — tushuntirish`;
    ex.getCell(1, 1).font = { bold: true, size: 15, color: { argb: BRAND } };
    y = 2;
    if (periodText) line(['Davr', periodText]);
    if (text(page.name)) line(['Sahifa', text(page.name)]);

    if (text(page.what) || text(page.from) || text(page.how)) {
      section('1. Bu jadval nima ko‘rsatadi');
      if (text(page.what)) line(['Nima ko‘rsatadi', text(page.what)]);
      if (text(page.from)) line(['Ma’lumot qayerdan', text(page.from)]);
      if (text(page.how)) line(['Qanday ishlatiladi', text(page.how)]);
    }

    section('2. Ustunlar: nima, qanday hisoblanadi, qayerdan');
    line(['Ustun', 'Nima', 'Qanday hisoblanadi', 'Ma’lumot qayerdan'], { head: true });
    header.forEach((h) => {
      const g = explainColumn(h);
      line([h, g?.meaning ?? '—', g?.formula ?? '', g?.source ?? '']);
    });

    section('3. Umumiy qoidalar (dasturdagi hisob qoidalari)');
    GENERAL_RULES.forEach((r, i) => line([`${i + 1}.`, r]));

    if (workings.length) {
      section('4. Hisob-kitob (shu jadval bo‘yicha)');
      for (const w of workings) line(w);
    }
    const totals = rows.filter((r) => typeof r[0] === 'string' && /^(jami|korxona jami)/i.test(String(r[0]).trim()));
    if (totals.length) {
      section(`${workings.length ? 5 : 4}. Jami qatorlar`);
      line(["Jami qatori — ustundagi qiymatlar yig'indisi; foizlar (ulush, rentabellik) jami summalardan qayta hisoblanadi.", '']);
    }

    // ── 3. Ma'lumot ──
    const meta = wb.addWorksheet("Ma'lumot");
    meta.getColumn(1).width = 26;
    meta.getColumn(2).width = 80;
    [
      ['Fayl', title],
      ['Sahifa', text(page.name) || '—'],
      ['Manzil', text(page.path, 300) || '—'],
      ['Davr', periodText || '—'],
      ['Yuklab olindi', now],
      ['Qatorlar soni', rows.length],
      ['Ustunlar soni', header.length],
      ['Dastur', 'Korxona tahlil — ma’lumot sahifada ko‘rinib turganidek'],
    ].forEach(([k, v], i) => {
      meta.getCell(i + 1, 1).value = k;
      meta.getCell(i + 1, 1).font = { bold: true };
      meta.getCell(i + 1, 2).value = v;
    });

    const safe = (text(body.fileName, 150) || title).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'jadval';
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${safe}.xlsx` };
  }
}
