import { BadRequestException } from '@nestjs/common';
import type ExcelJS from 'exceljs';
import { cellValue } from '../../common/excel/cells';
import { amountNumber } from '../../common/money';
import { toLatin } from '../acc-23106/acc23106.purpose';

// ═══════════════════════════════════════════════════════════
// 3802 — har oylik real bajarilgan ishlar: «3802 dan olingan pullar» fayli (har oy — alohida varaq) o'qish.
//  • Oy: varaq nomidan (Excel pastidagi yorliq: «2026 Avgust», «2025 ЯНВАР (05.02.2025)», «январ»); nomda yil yo'q
//    bo'lsa — sarlavhadan («… 2022 yilning yanvar oyida …»); nomda oy yo'q bo'lsa — sarlavhadan. Farq bo'lsa — ogohlantirish.
//    Qavs ichidagi sana («(05.08)») — topshirilgan kun, oy emas.
//  • Bir oyga bir nechta varaq: qism («2-qism», Marksheyderlik bo'limi) — qo'shiladi; nusxa (xodimlarining ≥80% boshqa
//    varaqda) — olinmaydi: ko'rinadigani, keyin xodimi ko'prog'i, keyin keyingisi qoladi (summalari farq qilsa — ogohlantirish).
//  • Varaq ichida: «F.I.SH» sarlavha qatori (ustunlar nomidan taniladi), bo'lim qatori (qalin shrift — bo'lim jamisi bilan),
//    xodim qatorlari (F.I.Sh., lavozim, summalar, izoh), «Жами» — varaq jamisi; imzolar («"Soliq-servis" … direktori»,
//    «Bosh hisobchi») — ma'lumot tugadi.
//  • Bo'lim jamisi xodimlar yig'indisi bilan solishtiriladi (yaxlitlash farqi — 1 tiyin × xodimlar soni).
// ═══════════════════════════════════════════════════════════

/** Ish haqi qismi (ustun) — Qo'mita qoplash qoidasi uchun: OKLAD va USTAMA_40 — «Oklad + 40%» */
export type VedComponent =
  | 'OKLAD'
  | 'USTAMA_40'
  | 'OKLAD_USTAMA'
  | 'MUKOFOT'
  | 'MODDIY_RAGBAT'
  | 'TUMAN'
  | 'TATIL'
  | 'TATIL_KOMP'
  | 'TATIL_MODDIY'
  | 'KASALLIK'
  | 'DEKRET'
  | 'QISQARTIRISH'
  | 'OVQAT'
  | 'YOLKIRA'
  | 'BOSHQA';

export const VED_COMPONENT_LABEL: Record<VedComponent, string> = {
  OKLAD: 'Lavozim maoshi (Oklad)',
  USTAMA_40: "Rag'batlantirish ustamasi (40%)",
  OKLAD_USTAMA: 'Lavozim maoshi ustamasi',
  MUKOFOT: 'Mukofot puli',
  MODDIY_RAGBAT: "Moddiy rag'batlantirish ustamasi",
  TUMAN: 'Tuman koeffitsienti',
  TATIL: "Mehnat ta'tili",
  TATIL_KOMP: "Foydalanilmagan ta'til",
  TATIL_MODDIY: "Ta'tilga moddiy yordam",
  KASALLIK: 'Kasallik nafaqasi',
  DEKRET: 'Dekret puli',
  QISQARTIRISH: 'Qisqartirish kompensatsiyasi',
  OVQAT: 'Ovqatlanish',
  YOLKIRA: "Yo'lkira",
  BOSHQA: 'Boshqa',
};

const norm = (s: string) =>
  toLatin(String(s ?? ''))
    .replace(/[ʻʼ‘’`'"«»]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Ustun sarlavhasi → qism (tartib muhim: aniqrog'i oldin). null — jami ustuni */
function componentOf(header: string): VedComponent | 'JAMI' | null {
  const h = norm(header).replace(/ /g, '');
  if (!h) return null;
  if (h.startsWith('jamidaromad') || h === 'jami') return 'JAMI';
  if (h.includes('mukofot')) return 'MUKOFOT';
  if (h.includes('lavozimmaoshiustama')) return 'OKLAD_USTAMA';
  if (h.startsWith('lavozimmaosh')) return 'OKLAD';
  if (h.includes('moddiyragbat')) return 'MODDIY_RAGBAT';
  if (h.includes('ragbat')) return 'USTAMA_40';
  if (h.includes('tuman')) return 'TUMAN';
  if (h.includes('foydalanilmagan')) return 'TATIL_KOMP';
  if (h.includes('tatiligamoddiy')) return 'TATIL_MODDIY';
  if (h.includes('mehnattatil')) return 'TATIL';
  if (h.includes('layoqatsiz') || h.includes('kasallik')) return 'KASALLIK';
  if (h.includes('dekret')) return 'DEKRET';
  if (h.includes('qisqartir')) return 'QISQARTIRISH';
  if (h.includes('yolpuli') || h.includes('yolkira')) return 'YOLKIRA';
  if (h.includes('ovqat')) return 'OVQAT';
  return 'BOSHQA';
}

const MONTHS: [RegExp, number][] = [
  [/^yanvar|^yanvr|^january/, 1],
  [/^fevral|^february/, 2],
  [/^mart|^march/, 3],
  [/^aprel|^april/, 4],
  // «Мау» — sarlavhada kirill harflar bilan
  [/^may|^mai$|^mau$/, 5],
  [/^iyun|^iyn/, 6],
  [/^iyul/, 7],
  [/^avgust|^august/, 8],
  [/^sent[ya]?abr|^sentabr|^september/, 9],
  [/^okt[ya]?abr|^oktabr|^october/, 10],
  [/^noyabr|^noyabr|^november/, 11],
  [/^dekabr|^december/, 12],
];

/** Matndagi oy (birinchi oy so'zi) */
function monthIn(s: string): number | null {
  for (const w of norm(s).split(' ')) {
    const hit = MONTHS.find(([re]) => re.test(w));
    if (hit) return hit[1];
  }
  return null;
}

/** Varaq nomi: yil va oy. Qavs ichidagi sana («(05.08)», «(01,04)») olib tashlanadi, oy nomi («(июль)») — qoladi */
export function periodFromName(name: string): { year: number | null; month: number | null } {
  const clean = name.replace(/\(\s*[\d.,/\s-]+\)/g, ' ');
  const y = /(20\d\d)/.exec(clean);
  return { year: y ? Number(y[1]) : null, month: monthIn(clean.replace(/20\d\d/g, ' ')) };
}

/** Sarlavha: «… 2026 yilning AVGUST oyida …» */
export function periodFromTitle(title: string): { year: number | null; month: number | null } {
  const t = norm(title);
  const m = /(20\d\d) (?:yil|yilning|jil|yilda)\S* ([a-z]+)/.exec(t);
  if (!m) return { year: null, month: null };
  return { year: Number(m[1]), month: monthIn(m[2]!) };
}

export interface VedEmployee {
  row: number;
  fullName: string;
  position: string;
  /** Qism → tiyin (faqat noldan farqlilari) */
  amounts: Partial<Record<VedComponent, string>>;
  /** «Jami daromad» ustuni (bo'lmasa — qismlar yig'indisi) */
  totalTiyin: string;
  /** Izoh ustuni (otpusk, dekret, vakant …) */
  note: string;
}

export interface VedSection {
  name: string;
  employees: VedEmployee[];
  totalTiyin: string;
  /** Bo'lim qatoridagi jami (bo'lsa) va mosligi */
  fileTotalTiyin: string | null;
  ok: boolean;
  /** Marksheyder varag'idan (nomida «Маркшейдер/Marksheyder») yoki Marksheyder bo'limi — alohida hisob (3802 hovuzidan emas) */
  marksheyder?: boolean;
}

export interface VedSheet {
  sheet: string;
  hidden: boolean;
  /** «YYYY-MM» (aniqlanmasa — null) */
  period: string | null;
  title: string;
  marksheyder: boolean;
  columns: { col: number; header: string; component: VedComponent | 'JAMI' }[];
  sections: VedSection[];
  employees: number;
  totalTiyin: string;
  warnings: string[];
}

const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, ' ').trim();
const toTiyin = (v: unknown): bigint | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.round(v * 100)) : null;
  const t = text(v);
  if (!t) return null;
  const n = amountNumber(t);
  return n === null ? null : BigInt(Math.round(n * 100));
};
const FOOTER_RE = /soliq.?servis.*direktor|^bosh hisobchi(\s*v\.?\s*v\.?\s*b\.?)?$/i;
const TOTAL_RE = /^(жами|jami|итого|всего)(?![\p{L}])/iu;
const nameKey = (s: string) => norm(s).replace(/ /g, '');
/** Marksheyder: varaq yoki bo'lim nomida (kirill / lotin) */
export const MARKSH_RE = /маркшейд|marksheyd|markshеyd/i;
/** Bo'lim ustuni sarlavhasi (normallashgan, bo'shliqsiz): bo'lim, bo'linma, bolim, otdel, bo'limi */
const DEPT_RE = /^(bolim|bolinma|bolimi|bolimnomi|otdel|tarkibiybolinma|bolinmanomi)$/;

export function parseVedomostSheet(ws: ExcelJS.Worksheet): VedSheet | null {
  // Sarlavha qatori: A — «F.I.SH»
  let hr = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 20) && !hr; r++) if (/^f\.?\s*i\.?\s*sh/i.test(text(cellValue(ws.getRow(r).getCell(1).value)))) hr = r;
  if (!hr) return null;
  let title = '';
  for (let r = 1; r < hr && !title; r++) {
    const parts: string[] = [];
    ws.getRow(r).eachCell((c) => {
      const t = text(cellValue(c.value));
      if (t) parts.push(t);
    });
    const line = parts.join(' ');
    if (/yil|йил|oy|ой/i.test(line)) title = line;
  }
  const columns: VedSheet['columns'] = [];
  let jamiCol = 0;
  // Bo'lim ustuni (bo'lsa): har qatorda bo'lim nomi — bo'lim sarlavha qatorlari kerak emas
  let deptCol = 0;
  ws.getRow(hr).eachCell((c, col) => {
    if (col >= 2 && !deptCol && DEPT_RE.test(norm(text(cellValue(c.value))).replace(/ /g, ''))) deptCol = col;
  });
  ws.getRow(hr).eachCell((c, col) => {
    if (col <= 2 || jamiCol || col === deptCol) return;
    const header = text(cellValue(c.value));
    const component = componentOf(header);
    if (!component) return;
    columns.push({ col, header: header.slice(0, 80), component });
    if (component === 'JAMI') jamiCol = col;
  });
  const amountCols = columns.filter((c) => c.component !== 'JAMI');
  // Vedomost: «Lavozim maoshi» ustuni yoki (soddalashgan shablon) bo'lim + «Jami» ustuni
  if (!amountCols.some((c) => c.component === 'OKLAD') && !(deptCol && jamiCol)) return null;

  // Oy: varaq nomi (Excel yorlig'i), bo'lmasa — sarlavha
  const warnings: string[] = [];
  const byName = periodFromName(ws.name);
  const byTitle = periodFromTitle(title);
  const year = byName.year ?? byTitle.year;
  const month = byName.month ?? byTitle.month;
  if (byName.month && byTitle.month && byName.month !== byTitle.month) warnings.push(`Sarlavhada ${byTitle.month}-oy, varaq nomida ${byName.month}-oy — varaq nomi olindi`);
  if (byName.year && byTitle.year && byName.year !== byTitle.year) warnings.push(`Sarlavhada ${byTitle.year}-yil, varaq nomida ${byName.year}-yil — varaq nomi olindi`);
  const period = year && month ? `${year}-${String(month).padStart(2, '0')}` : null;
  if (!period) warnings.push("Oy aniqlanmadi (varaq nomida ham, sarlavhada ham)");

  // Varaqda qalin bo'lim qatorlari bormi (bo'lmasa — bo'lim: B bo'sh, C son)
  let anyBold = false;
  for (let r = hr + 1; r <= Math.min(ws.rowCount, hr + 40); r++) if (ws.getRow(r).getCell(1).font?.bold && text(cellValue(ws.getRow(r).getCell(1).value))) anyBold = true;

  const sections: VedSection[] = [];
  let cur: VedSection | null = null;
  const fileTotals = new Map<VedSection, bigint>();
  const open = (name: string, total: bigint | null) => {
    const s: VedSection = { name: name.slice(0, 200), employees: [], totalTiyin: '0', fileTotalTiyin: null, ok: true };
    if (total !== null) fileTotals.set(s, total);
    sections.push(s);
    cur = s;
    return s;
  };
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = text(cellValue(row.getCell(1).value));
    const b = text(cellValue(row.getCell(2).value));
    if (FOOTER_RE.test(b) || FOOTER_RE.test(a)) break;
    if (!a) continue;
    if (TOTAL_RE.test(a)) continue;
    const bold = Boolean(row.getCell(1).font?.bold);
    const total = jamiCol ? toTiyin(cellValue(row.getCell(jamiCol).value)) : null;
    const dept = deptCol ? text(cellValue(row.getCell(deptCol).value)) : '';
    const isSection = deptCol ? false : anyBold ? bold && !b : !b && toTiyin(cellValue(row.getCell(3).value)) !== null;
    if (isSection) {
      open(a, total);
      continue;
    }
    // Bo'lim ustuni bo'lsa — qator o'z bo'limiga (nomi bo'yicha, harf/apostrof farqisiz)
    if (deptCol && dept) {
      const key = nameKey(dept);
      cur = sections.find((x) => nameKey(x.name) === key) ?? open(dept, null);
    }
    const amounts: VedEmployee['amounts'] = {};
    let sum = 0n;
    for (const c of amountCols) {
      const t = toTiyin(cellValue(row.getCell(c.col).value));
      if (!t) continue;
      amounts[c.component as VedComponent] = (BigInt(amounts[c.component as VedComponent] ?? '0') + t).toString();
      sum += t;
    }
    const notes: string[] = [];
    if (jamiCol)
      row.eachCell((c, col) => {
        if (col <= jamiCol) return;
        const v = cellValue(c.value);
        if (typeof v === 'string' && v.trim() && !/^\d/.test(v.trim())) notes.push(v.trim());
      });
    const s: VedSection = cur ?? open('—', null);
    s.employees.push({ row: r, fullName: a.slice(0, 200), position: deptCol === 2 ? '' : b.slice(0, 200), amounts, totalTiyin: (total ?? sum).toString(), note: notes.join('; ').slice(0, 200) });
  }
  const live = sections.filter((s) => s.employees.length);
  for (const s of live) {
    const t = s.employees.reduce((x, e) => x + BigInt(e.totalTiyin), 0n);
    s.totalTiyin = t.toString();
    const f = fileTotals.get(s);
    if (f !== undefined) {
      s.fileTotalTiyin = f.toString();
      const diff = f - t;
      s.ok = (diff < 0n ? -diff : diff) <= BigInt(s.employees.length);
    }
  }
  const bad = live.filter((s) => !s.ok);
  if (bad.length) warnings.push(`Bo'lim jamisi xodimlar yig'indisiga mos emas: ${bad.map((s) => s.name).slice(0, 5).join(', ')}`);
  const marksheyder = MARKSH_RE.test(ws.name);
  for (const x of live) x.marksheyder = marksheyder || MARKSH_RE.test(x.name);
  return {
    sheet: ws.name.trim().slice(0, 80),
    hidden: ws.state !== 'visible',
    period,
    title: title.slice(0, 300),
    marksheyder,
    columns,
    sections: live,
    employees: live.reduce((t, s) => t + s.employees.length, 0),
    totalTiyin: live.reduce((t, s) => t + BigInt(s.totalTiyin), 0n).toString(),
    warnings,
  };
}

export interface VedPeriod {
  period: string;
  /** Olinadigan varaqlar (qismlar birga) */
  used: string[];
  /** Olinmaydigan varaqlar va sababi */
  skipped: { sheet: string; reason: string }[];
  sections: VedSection[];
  employees: number;
  totalTiyin: string;
  /** Oklad va 40% ustama yig'indisi (Qo'mita qoplashining asosi) */
  okladTiyin: string;
  ustamaTiyin: string;
  warnings: string[];
}

/**
 * Oyga guruhlash: nusxalar olinmaydi (xodimlarining ≥80% boshqa varaqda), qolganlari (qism, Marksheyderlik) qo'shiladi.
 * Tanlov tartibi: ko'rinadigan > xodimi ko'p > keyingisi.
 */
export function groupPeriods(sheets: VedSheet[]): VedPeriod[] {
  const by = new Map<string, VedSheet[]>();
  for (const s of sheets) if (s.period) by.set(s.period, [...(by.get(s.period) ?? []), s]);
  const out: VedPeriod[] = [];
  for (const [period, list] of by) {
    const order = list.map((s, i) => ({ s, i })).sort((x, y) => Number(x.s.hidden) - Number(y.s.hidden) || y.s.employees - x.s.employees || y.i - x.i);
    const used: VedSheet[] = [];
    const skipped: VedPeriod['skipped'] = [];
    const warnings: string[] = [];
    const keys = (s: VedSheet) => new Set(s.sections.flatMap((x) => x.employees.map((e) => nameKey(e.fullName))));
    for (const { s } of order) {
      const mine = keys(s);
      const dup = used.find((u) => {
        const theirs = keys(u);
        let hit = 0;
        for (const k of mine) if (theirs.has(k)) hit++;
        return mine.size > 0 && hit / mine.size >= 0.8;
      });
      if (!dup) {
        used.push(s);
        continue;
      }
      // Nusxa: summalar ham bir xilmi
      const amounts = new Map(dup.sections.flatMap((x) => x.employees.map((e) => [nameKey(e.fullName), e.totalTiyin] as const)));
      const all = s.sections.flatMap((x) => x.employees);
      const same = all.filter((e) => amounts.get(nameKey(e.fullName)) === e.totalTiyin).length;
      const differ = all.length - same;
      skipped.push({ sheet: s.sheet, reason: `«${dup.sheet}» nusxasi${s.hidden ? ' (yashirin)' : ''}${differ ? ` — ${differ} xodimda summa boshqacha` : ''}` });
      if (differ) warnings.push(`«${s.sheet}» — «${dup.sheet}»ning boshqa versiyasi (${differ} xodimda summa boshqacha); «${dup.sheet}» olindi`);
    }
    const usedOrdered = list.filter((s) => used.includes(s));
    for (const s of usedOrdered) {
      warnings.push(...s.warnings.map((w) => `«${s.sheet}»: ${w}`));
      if (s.hidden) warnings.push(`«${s.sheet}» — yashirin varaq (olindi: boshqa varaqda bu xodimlar yo'q)`);
    }
    const sections = usedOrdered.flatMap((s) => s.sections.map((x) => ({ ...x, marksheyder: Boolean(s.marksheyder || x.marksheyder), name: usedOrdered.length > 1 && s.marksheyder && !MARKSH_RE.test(x.name) ? `${x.name} (Marksheyderlik)` : x.name })));
    const emp = sections.flatMap((x) => x.employees);
    const part = (c: VedComponent) => emp.reduce((t, e) => t + BigInt(e.amounts[c] ?? '0'), 0n).toString();
    out.push({
      period,
      used: usedOrdered.map((s) => s.sheet),
      skipped,
      sections,
      employees: emp.length,
      totalTiyin: emp.reduce((t, e) => t + BigInt(e.totalTiyin), 0n).toString(),
      okladTiyin: part('OKLAD'),
      ustamaTiyin: part('USTAMA_40'),
      warnings,
    });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/** Butun fayl: har varaq o'qiladi; oy aniqlanmagan yoki vedomost bo'lmagan varaqlar — alohida */
export function parseVedomostWorkbook(wb: ExcelJS.Workbook): { periods: VedPeriod[]; unknown: { sheet: string; reason: string }[] } {
  const sheets: VedSheet[] = [];
  const unknown: { sheet: string; reason: string }[] = [];
  for (const ws of wb.worksheets) {
    const s = parseVedomostSheet(ws);
    if (!s) unknown.push({ sheet: ws.name, reason: "Vedomost emas («F.I.SH» va «Lavozim maoshi» yoki «Bo'lim» + «Jami» ustunlari yo'q)" });
    else if (!s.period) unknown.push({ sheet: s.sheet, reason: 'Oy aniqlanmadi' });
    else if (!s.employees) unknown.push({ sheet: s.sheet, reason: "Xodim qatorlari yo'q" });
    else sheets.push(s);
  }
  if (!sheets.length) throw new BadRequestException("Faylda 3802 vedomosti topilmadi: «F.I.SH», «Lavozimi», «Lavozim maoshi» ustunli varaq kerak");
  return { periods: groupPeriods(sheets), unknown };
}
