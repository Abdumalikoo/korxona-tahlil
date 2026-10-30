import ExcelJS from 'exceljs';
import { numberOf, parseWithTemplate, sheetKey, type TemplateSpec } from '../../common/templates/sheet-template';
import { cellValue } from '../salary-composition/salary-composition.excel';
import { matchPlace, placeKey, translit } from './leases.match';

// ═══════════════════════════════════════════════════════════
// Hudud ijaralari — fayl o'qish (ikki ko'rinish, bitta natija):
//  1) Ilova shabloni: bitta varaq — Hudud | Tuman | Manzil | Shartnoma | Maydon | Ijaraga beruvchi | STIR | Yanvar … Dekabr | Jami
//     (umumiy shablon tizimi: sarlavha avtomatik topiladi).
//  2) Vazirlik «Ижара маълумот» fayli: har viloyat — alohida varaq (viloyat — varaq sarlavhasidan, «ИНН» — ijaraga
//     beruvchi STIR), sarlavha qatori — oylar («январ» … «декабр») qatori; bir necha tuman bitta umumiy shartnomada
//     (summa katagi qatorlar bo'ylab birlashtirilgan) — summa ular orasida tiyingacha teng bo'linadi; «Жами» qatori va izohlar (to'langan /
//     to'lanmagan, pul to'langan sana, penya) o'qilmaydi — faqat oylik hisoblangan summalar.
// Natija qatori: hudud (kod yoki matn), tuman matni, 12 oy (so'm), «Жами» tekshiruvi.
// ═══════════════════════════════════════════════════════════

export const CENTRAL_REGION = 0;

/** Hududlar tartibi (fayldagidek): Qoraqalpog'iston → viloyatlar → Toshkent viloyati → Toshkent shahri → Markaz */
export const REGION_ORDER = [35, 3, 6, 8, 10, 12, 14, 18, 30, 22, 24, 33, 27, 26, 0];

export const MONTH_LABELS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const MONTH_KEYS = [['yanvar'], ['fevral'], ['mart'], ['aprel'], ['may'], ['iyun', 'iyn'], ['iyul', 'iyl'], ['avgust'], ['sentabr', 'sentyabr'], ['oktabr', 'oktyabr'], ['noyabr'], ['dekabr']];
const monthOf = (k: string) => MONTH_KEYS.findIndex((alts) => alts.some((a) => k === a || k.startsWith(a)));

export const RENT_SPEC: TemplateSpec = {
  id: 'regional-rent',
  title: 'Hudud ijaralari',
  rowKey: 'district',
  scanRows: 12,
  fields: [
    { key: 'no', label: '№', aliases: ['n', 'no', 'tr'], kind: 'number', width: 5 },
    { key: 'region', label: 'Hudud', aliases: ['hudud', 'viloyat', 'xudud'], kind: 'text', required: true, width: 24 },
    { key: 'district', label: "Tuman (bo'lim)", aliases: ['tumanbolim', 'tuman', 'bolim', 'ijaragaolinganhududnomi', 'ijaragaolinganxududnomi'], kind: 'text', required: true, width: 26 },
    { key: 'address', label: 'Manzil', aliases: ['manzil', 'manzili'], kind: 'text', width: 34 },
    { key: 'contractNo', label: 'Shartnoma raqami', aliases: ['shartnomaraqami'], kind: 'text', width: 16 },
    { key: 'contractDate', label: 'Shartnoma sanasi', aliases: ['shartnomasanasi'], kind: 'date', width: 13 },
    { key: 'area', label: 'Maydon, m²', aliases: ['maydonm2', 'maydon', 'ijaramaydonikvmetr'], kind: 'number', width: 10 },
    { key: 'lessorName', label: 'Ijaraga beruvchi', aliases: ['ijaragaberuvchi', 'beruvchi'], kind: 'text', width: 26 },
    { key: 'lessorTin', label: 'STIR', aliases: ['stir', 'inn'], kind: 'text', width: 12 },
    ...MONTH_LABELS.map((m, i) => ({ key: `m${i}`, label: m, groupLabel: "Oylik hisoblangan ijara, so'm", group: ['oylikhisoblanganijarasom', 'oylikhisoblanganijara'], aliases: [sheetKey(m), ...MONTH_KEYS[i]!], kind: 'number' as const, width: 13 })),
    { key: 'total', label: 'Jami', aliases: ['jami', 'jamisumma'], kind: 'number', width: 15 },
  ],
  help: [
    "• Har qator — bitta tuman (yoki bo'lim) ijarasi. Hudud va tuman ilovadagi nomlar bilan yozilgan — o'zgartirmang.",
    "• Oylar ustunlariga shu oy uchun HISOBLANGAN ijara summasini (so'mda) yozing. To'langan / to'lanmagan — kerak emas.",
    "• Bo'sh yoki 0 — shu oy ijara yo'q. Bitta tumanda ikki ijara bo'lsa — qatorni nusxalab, shartnoma raqamini yozing.",
    "• Yangi ijara uchun «Ijaraga beruvchi» va «STIR» ni to'ldiring (bo'lmasa — shu hududdagi boshqa ijaradan olinadi).",
    "• Yuklangach pastda tekshiruv chiqadi (hudud → tuman → oylar); «Tasdiqlash» — tanlangan oygacha xarajatga yoziladi.",
    "• Vazirlikning «Ижара маълумот» fayli (har viloyat — alohida varaq) ham to'g'ridan-to'g'ri yuklanadi.",
  ],
};

export interface RentRow {
  /** «Varaq / qator» — ko'rsatish uchun */
  ref: string;
  regionCode: number | null;
  regionText: string;
  district: string;
  address: string | null;
  contractNo: string | null;
  contractDate: string | null;
  area: number | null;
  lessorName: string | null;
  lessorTin: string | null;
  /** 12 oy, so'm (bo'sh — 0) */
  months: number[];
  /** Fayldagi «Жами» (bo'lsa) */
  total: number | null;
  warnings: string[];
}

export interface RentParse {
  format: 'TEMPLATE' | 'MINISTRY';
  sheets: string[];
  rows: RentRow[];
  skipped: { ref: string; reason: string }[];
}

type Region = { code: number; name: string };

/** Hudud matni → kod (Markaz, Qoraqalpog'iston qisqartmasi, «Тошкент ш.» kabi qisqa nomlar ham) */
export function regionOf(text: string, regions: Region[]): number | null {
  const k = sheetKey(text);
  if (!k) return null;
  if (k.startsWith('markaz')) return CENTRAL_REGION;
  if (k.includes('qoraqalpo')) return 35;
  if (/toshkent(sh|shahri|shahar)$/.test(k) || k === 'toshkentsh') return 26;
  if (/toshkent(vil|viloyati)$/.test(k)) return 27;
  const items = regions.filter((r) => r.code !== CENTRAL_REGION && r.code !== 99).map((r) => ({ key: placeKey(r.name), item: r }));
  return matchPlace(text, items).item?.code ?? matchPlace(`${text} viloyati`, items).item?.code ?? null;
}

const txt = (v: ExcelJS.CellValue) => {
  const r = cellValue(v);
  return r === null || r === undefined ? '' : r instanceof Date ? r.toISOString().slice(0, 10) : String(r).trim();
};
const amount = (v: ExcelJS.CellValue) => {
  const n = numberOf(cellValue(v));
  return n === null || Number.isNaN(n) ? 0 : n;
};
const dateText = (v: ExcelJS.CellValue): string | null => {
  const r = cellValue(v);
  if (r instanceof Date) return r.toISOString().slice(0, 10);
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(String(r ?? '').trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
};
const JAMI = /^(jami|итого|жами)/i;

/** Ilova shabloni (bitta varaq) */
function parseTemplate(wb: ExcelJS.Workbook, regions: Region[]): RentParse | null {
  const p = parseWithTemplate(wb, RENT_SPEC);
  if (!p || p.columns.region === undefined || p.columns.m0 === undefined) return null;
  const rows: RentRow[] = [];
  const skipped = p.skipped.map((s) => ({ ref: `${p.sheet} / ${s.row}`, reason: s.reason }));
  let lastRegion = '';
  for (const r of p.rows) {
    const v = r.values;
    const regionText = String(v.region ?? '').trim() || lastRegion;
    lastRegion = regionText;
    const months = MONTH_LABELS.map((_, i) => (typeof v[`m${i}`] === 'number' ? (v[`m${i}`] as number) : 0));
    rows.push({
      ref: `${p.sheet} / ${r.row}`,
      regionCode: regionOf(regionText, regions),
      regionText,
      district: String(v.district ?? '').trim(),
      address: (v.address as string | null) ?? null,
      contractNo: v.contractNo === null ? null : String(v.contractNo),
      contractDate: (v.contractDate as string | null) ?? null,
      area: (v.area as number | null) ?? null,
      lessorName: (v.lessorName as string | null) ?? null,
      lessorTin: v.lessorTin === null ? null : String(v.lessorTin).replace(/\D/g, '') || null,
      months,
      total: (v.total as number | null) ?? null,
      warnings: r.warnings,
    });
  }
  return { format: 'TEMPLATE', sheets: [p.sheet], rows, skipped };
}

/** Vazirlik fayli: har viloyat — alohida varaq */
function parseMinistry(wb: ExcelJS.Workbook, regions: Region[]): RentParse {
  const rows: RentRow[] = [];
  const skipped: { ref: string; reason: string }[] = [];
  const sheets: string[] = [];
  for (const ws of wb.worksheets) {
    // Sarlavha — «январ» qatori; ustunlar shu qatordan
    let hr = 0;
    for (let r = 1; r <= Math.min(15, ws.rowCount) && !hr; r++) for (let c = 1; c <= ws.columnCount; c++) if (monthOf(sheetKey(txt(ws.getRow(r).getCell(c).value))) === 0) { hr = r; break; }
    if (!hr) continue;
    const col: Record<string, number> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const k = sheetKey(txt(ws.getRow(hr).getCell(c).value));
      const mi = monthOf(k);
      if (mi >= 0 && col[`m${mi}`] === undefined) col[`m${mi}`] = c;
      else if (k.startsWith('ijaragaolingan')) col.district = c;
      else if (k === 'manzili' || k === 'manzil') col.address = c;
      else if (k === 'shartnomaraqami') col.no = c;
      else if (k === 'shartnomasanasi') col.date = c;
      else if (k.startsWith('ijaramaydoni')) col.area = c;
      else if (k === 'jamisumma' && col.total === undefined) col.total = c;
    }
    if (!col.district) continue;
    // Birlashgan kataklar (bir necha tuman — bitta umumiy shartnoma): «qator:ustun» → yuqori qator va qatorlar soni
    const merged = new Map<string, { top: number; span: number }>();
    for (const range of ((ws.model as { merges?: string[] }).merges ?? [])) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m || m[1] !== m[3]) continue;
      const c = ws.getColumn(m[1]!).number;
      const top = Number(m[2]);
      const bottom = Number(m[4]);
      if (top <= hr || bottom <= top) continue;
      for (let rr = top; rr <= bottom; rr++) merged.set(`${rr}:${c}`, { top, span: bottom - top + 1 });
    }
    /** Summa: birlashgan katak bo'lsa — tiyingacha teng ulush (qoldiq tiyinlar — birinchi qatorlarga) */
    const share = (r0: number, c: number): number => {
      const v = amount(ws.getRow(r0).getCell(c).value);
      const m = merged.get(`${r0}:${c}`);
      if (!m || !v) return v;
      const t = Math.round(v * 100);
      const base = Math.floor(t / m.span);
      return (base + (r0 - m.top < t - base * m.span ? 1 : 0)) / 100;
    };
    // Viloyat va ijaraga beruvchi STIR — varaq tepasidan
    let title = ws.name;
    let tin: string | null = null;
    for (let r = 1; r < hr; r++)
      for (let c = 1; c <= Math.min(ws.columnCount, 10); c++) {
        const t = txt(ws.getRow(r).getCell(c).value);
        if (/вилоят|viloyat|шаҳри|шахри|республ/i.test(t) && title === ws.name) title = t;
        const inn = /ИНН\s*:?\s*(\d{9})/i.exec(t);
        if (inn && !tin) tin = inn[1]!;
      }
    const regionCode = regionOf(title, regions) ?? regionOf(ws.name, regions);
    sheets.push(ws.name);
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const district = txt(row.getCell(col.district).value);
      const first = txt(row.getCell(1).value) || txt(row.getCell(2).value);
      const months = MONTH_LABELS.map((_, i) => (col[`m${i}`] ? share(r, col[`m${i}`]!) : 0));
      const span = col.m0 ? merged.get(`${r}:${col.m0}`)?.span : undefined;
      if (JAMI.test(district) || JAMI.test(first) || JAMI.test(translit(first))) {
        skipped.push({ ref: `${ws.name} / ${r}`, reason: '«Жами» qatori' });
        continue;
      }
      if (!district && months.every((x) => !x)) continue;
      if (!district) {
        skipped.push({ ref: `${ws.name} / ${r}`, reason: "tuman nomi bo'sh" });
        continue;
      }
      // «МАРКАЗ (…)» — Markaz ijarasi (viloyat varag'ida bo'lsa ham)
      const central = sheetKey(district).startsWith('markaz');
      const no = col.no ? txt(row.getCell(col.no).value) : '';
      rows.push({
        ref: `${ws.name} / ${r}`,
        regionCode: central ? CENTRAL_REGION : regionCode,
        regionText: central ? 'Markaz' : title,
        district,
        address: col.address ? txt(row.getCell(col.address).value) || null : null,
        contractNo: no || null,
        contractDate: col.date ? dateText(row.getCell(col.date).value) : null,
        area: col.area ? amount(row.getCell(col.area).value) || null : null,
        lessorName: null,
        lessorTin: tin,
        months,
        total: col.total ? share(r, col.total) : null,
        warnings: span ? [`Summa ${span} qator uchun birlashgan katakda — teng bo'lindi`] : [],
      });
    }
  }
  return { format: 'MINISTRY', sheets, rows, skipped };
}

/** Faylni o'qish: avval ilova shabloni, bo'lmasa — vazirlik fayli */
export function parseRentWorkbook(wb: ExcelJS.Workbook, regions: Region[]): RentParse | null {
  const t = parseTemplate(wb, regions);
  if (t && t.rows.length) return t;
  const m = parseMinistry(wb, regions);
  return m.rows.length ? m : null;
}
