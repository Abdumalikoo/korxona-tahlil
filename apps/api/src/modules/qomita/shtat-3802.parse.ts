import { BadRequestException } from '@nestjs/common';
import type ExcelJS from 'exceljs';
import { cellValue } from '../../common/excel/cells';
import { amountNumber } from '../../common/money';

// ═══════════════════════════════════════════════════════════
// 3802 — shtat jadvali («3802 bo'yicha olish tartibi») o'qish. Har varaq — bitta ro'yxat:
//  • «Штат» — butun korxona; «3802» — Qo'mita hisobidan oladiganlar; «3802 олмайдиганлар» — olmaydiganlar;
//    qolganlari (Tax Free, Маркшейдер, Фермер хўж, Hudud …) — yo'nalishlar shtati.
//  • Varaq ichida: bo'lim sarlavhasi (matn, birlik soni yo'q) → lavozimlar (nomi, shtat birligi, tarif razryadi,
//    bitta birlik maoshi, rag'batlantirish ustamasi, jami) → «Жами:» (bo'lim jami — o'z-o'zini tekshirish uchun).
//  • Jami = shtat birligi × (maosh + ustama) — fayldagidek olinadi, qayta hisoblanmaydi (farq bo'lsa — ko'rsatiladi).
// Sarlavhadagi imzo chekuvchilar (F.I.Sh.) o'qilmaydi va saqlanmaydi.
// ═══════════════════════════════════════════════════════════

export type ShtatListKind = 'UMUMIY' | 'OLADI' | 'OLMAYDI' | 'BOSHQA';

export interface ShtatPosition {
  /** Fayldagi qator */
  row: number;
  name: string;
  /** Shtat birligi (0,5 ham bo'lishi mumkin) */
  units: number;
  grade: string;
  /** Bitta birlik lavozim maoshi (Oklad) */
  salaryTiyin: string;
  /** Bitta birlik rag'batlantirish ustamasi (40%) */
  bonusTiyin: string;
  /** Jami (hamma birlik uchun, oylik) */
  totalTiyin: string;
}

export interface ShtatSection {
  /** Varaq ichidagi tartib raqami bilan kalit (bog'lash shu kalit bo'yicha saqlanadi) */
  key: string;
  name: string;
  positions: ShtatPosition[];
  units: number;
  totalTiyin: string;
  /** Fayldagi «Жами:» qatori (bo'lsa) va mosligi */
  fileUnits: number | null;
  fileTotalTiyin: string | null;
  ok: boolean;
}

export interface ShtatSheet {
  sheet: string;
  kind: ShtatListKind;
  /** Varaq sarlavhasidagi izoh («2026 йил 01 сентябрь ҳолатига», «3802 олмайдиганлар») */
  subtitle: string;
  /** Sarlavhadagi yillik ish haqi fondi (bo'lsa) */
  annualFundTiyin: string | null;
  sections: ShtatSection[];
  units: number;
  totalTiyin: string;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, ' ').trim();
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ‘’`']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = text(v);
  if (!t) return null;
  return amountNumber(t);
}
const tiyin = (n: number | null) => String(Math.round((n ?? 0) * 100));

type Col = 'no' | 'name' | 'units' | 'grade' | 'salary' | 'bonus' | 'total';
const HEADERS: { col: Col; test: (h: string) => boolean }[] = [
  { col: 'name', test: (h) => h.startsWith('лавозим') || h.startsWith('lavozim') },
  { col: 'units', test: (h) => h.startsWith('штат бирлиги') || h.startsWith('shtat birligi') },
  { col: 'grade', test: (h) => h.startsWith('тариф разряд') || h.startsWith('tarif razryad') },
  { col: 'salary', test: (h) => h.startsWith('бир штат бирлиги') || h.startsWith('bir shtat birligi') },
  { col: 'bonus', test: (h) => h.startsWith('рағбат ш') || h.startsWith('рагбат ш') || h.startsWith('ragbat sh') },
  { col: 'total', test: (h) => h.startsWith('жами штат бирлиги') || h.startsWith('jami shtat birligi') },
];

export function listKind(sheetName: string): ShtatListKind {
  const s = norm(sheetName);
  if (/олмайдиган|olmaydigan/.test(s)) return 'OLMAYDI';
  if (/^3802$/.test(s)) return 'OLADI';
  if (/^штат$|^shtat$/.test(s)) return 'UMUMIY';
  return 'BOSHQA';
}

/** Bo'lim nomi: boshidagi «1.», «21.2.» raqamsiz */
const sectionName = (s: string) => s.replace(/^\s*\d+(\.\d+)*\.?\s*/, '').trim() || s.trim();
const FOOTER_RE = /^(жами ходимлар|jami xodimlar|меҳнатга ҳақ тўлашнинг энг кам|бир ойлик|бир йиллик|bir oylik|bir yillik)/i;
/** Jami qatori: «Жами:», «Марказий аппарат бўйича жами:» — so'z nomning istalgan joyida */
const TOTAL_RE = /(^|[^\p{L}])(жами|jami)(?![\p{L}])/iu;

/** Varaq sarlavhasidagi yillik fond: «… жамғармаси 25 246 947 953 (…» */
function annualFund(lines: string[]): string | null {
  for (const l of lines) {
    const m = /жамғармаси\s+([\d\s .,]+?)\s*\(/i.exec(l);
    if (m) {
      const n = amountNumber(m[1]!.trim());
      if (n !== null) return tiyin(n);
    }
  }
  return null;
}

export function parseShtatSheet(ws: ExcelJS.Worksheet): ShtatSheet | null {
  // Sarlavha qatori: «Лавозимлар номи» va «Штат бирлиги» (birinchi 30 qatordan)
  let hr = 0;
  const cols = new Map<Col, number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 30) && !hr; r++) {
    const found = new Map<Col, number>();
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(text(cellValue(cell.value)));
      if (!h) return;
      const def = HEADERS.find((x) => !found.has(x.col) && x.test(h));
      if (def) found.set(def.col, c);
    });
    if (found.has('name') && found.has('units')) {
      hr = r;
      for (const [k, c] of found) cols.set(k, c);
    }
  }
  if (!hr) return null;
  // Sarlavhadan yuqorisi: varaq izohi va yillik fond (imzo chekuvchilar — o'qilmaydi)
  const top: string[] = [];
  for (let r = 1; r < hr; r++) {
    const vals: string[] = [];
    let prev = '';
    ws.getRow(r).eachCell((cell) => {
      const t = text(cellValue(cell.value));
      if (t && t !== prev) vals.push(t);
      prev = t;
    });
    if (vals.length) top.push(vals.join(' '));
  }
  const subtitle = top.find((l) => /ҳолатига|holatiga|олмайдиган|olmaydigan/i.test(l)) ?? '';
  const get = (row: ExcelJS.Row, c: Col) => (cols.has(c) ? cellValue(row.getCell(cols.get(c)!).value) : null);

  const sections: ShtatSection[] = [];
  let cur: ShtatSection | null = null;
  const open = (name: string) => {
    cur = { key: `${sections.length + 1}`, name: sectionName(name).slice(0, 200), positions: [], units: 0, totalTiyin: '0', fileUnits: null, fileTotalTiyin: null, ok: true };
    sections.push(cur);
    return cur;
  };
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = text(cellValue(row.getCell(1).value));
    const name = text(get(row, 'name'));
    const units = num(get(row, 'units'));
    if (FOOTER_RE.test(a) || FOOTER_RE.test(name)) break;
    if (units !== null && name && !TOTAL_RE.test(name)) {
      const s: ShtatSection = cur ?? open('—');
      const total = num(get(row, 'total'));
      s.positions.push({ row: r, name: name.slice(0, 200), units, grade: text(get(row, 'grade')).slice(0, 20), salaryTiyin: tiyin(num(get(row, 'salary'))), bonusTiyin: tiyin(num(get(row, 'bonus'))), totalTiyin: tiyin(total) });
      continue;
    }
    if (units !== null && (TOTAL_RE.test(name) || !name)) {
      // Bo'lim jami: «Жами:» yoki nomsiz qator (birlik soni bilan). Bo'limning jamisi allaqachon bo'lsa yoki son
      // varaqdagi hamma lavozimlar yig'indisiga teng bo'lsa — bu yuqori daraja jamisi (bo'lim tekshiruviga olinmaydi)
      if (cur) {
        const c: ShtatSection = cur;
        const sectionUnits = c.positions.reduce((t, p) => t + p.units, 0);
        const sheetUnits = sections.reduce((t, s) => t + s.positions.reduce((u, p) => u + p.units, 0), 0);
        const higher = c.fileUnits !== null || (Math.abs(units - sheetUnits) < 0.001 && Math.abs(units - sectionUnits) >= 0.001);
        if (!higher) {
          c.fileUnits = units;
          c.fileTotalTiyin = tiyin(num(get(row, 'total')));
        }
      }
      continue;
    }
    // Bo'lim sarlavhasi: matn bor, birlik soni yo'q
    const title = a && !/^\d+$/.test(a) ? a : name;
    if (title && units === null) open(title);
  }
  const live = sections.filter((s) => s.positions.length);
  for (const s of live) {
    s.units = Math.round(s.positions.reduce((t, p) => t + p.units, 0) * 100) / 100;
    s.totalTiyin = s.positions.reduce((t, p) => t + BigInt(p.totalTiyin), 0n).toString();
    s.ok = (s.fileUnits === null || Math.abs(s.fileUnits - s.units) < 0.001) && (s.fileTotalTiyin === null || s.fileTotalTiyin === s.totalTiyin);
  }
  live.forEach((s, i) => (s.key = String(i + 1)));
  return {
    sheet: ws.name.trim().slice(0, 60),
    kind: listKind(ws.name),
    subtitle: subtitle.slice(0, 200),
    annualFundTiyin: annualFund(top),
    sections: live,
    units: Math.round(live.reduce((t, s) => t + s.units, 0) * 100) / 100,
    totalTiyin: live.reduce((t, s) => t + BigInt(s.totalTiyin), 0n).toString(),
  };
}

/** Butun fayl: hamma ko'rinadigan varaqlar (shtat jadvali bo'lmagan varaq — o'tkaziladi) */
export function parseShtatWorkbook(wb: ExcelJS.Workbook): ShtatSheet[] {
  const sheets = wb.worksheets.filter((w) => w.state === 'visible').map(parseShtatSheet).filter((s): s is ShtatSheet => s !== null && s.sections.length > 0);
  if (!sheets.length) throw new BadRequestException("Shtat jadvali topilmadi: «Лавозимлар номи» va «Штат бирлиги» ustunlari bo'lgan, lavozimlari to'ldirilgan varaq kerak");
  return sheets;
}

/**
 * Toifa varag'i: faylda shu toifa varag'i («3802» yoki «… олмайдиганлар») bo'lsa — o'sha; bo'lmasa, faylda bitta shtat
 * varag'i bo'lsa — o'sha (alohida fayl, masalan shablondan). Aks holda — xato (qaysi varaq ekani noaniq).
 */
export function pickShtatSheet(sheets: ShtatSheet[], kind: 'OLADI' | 'OLMAYDI'): ShtatSheet {
  const own = sheets.filter((s) => s.kind === kind);
  if (own.length === 1) return { ...own[0]!, kind };
  if (own.length > 1) throw new BadRequestException(`Faylda bir nechta ${kind === 'OLADI' ? '«3802»' : '«олмайдиганлар»'} varag'i bor: ${own.map((s) => s.sheet).join(', ')}`);
  if (sheets.length === 1) return { ...sheets[0]!, kind };
  const want = kind === 'OLADI' ? "«3802» (oladiganlar)" : "«3802 олмайдиганлар»";
  throw new BadRequestException(`${want} varag'i topilmadi. Varaqlar: ${sheets.map((s) => s.sheet).join(', ')} — kerakli varaqni alohida faylga qo'ying yoki nomini o'zgartiring`);
}
