import ExcelJS from 'exceljs';
import { KIND_ORDER, KINDS, SAMPLE_MARK, type Col, type ImportKind, type KindDef } from './hp.const';

// ═══════════════════════════════════════════════════════════
// Excel shablonlari: har bir tur alohida va «Barcha shablonlar» (bitta faylda alohida varaqlar).
//   • 1-qator — ustun kalitlari (import shu nomlar bo'yicha o'qiydi); har sarlavhada izoh (note).
//   • Majburiy ustunlar — to'q sariq sarlavha, «*».
//   • 2–3-qatorlar — kulrang NAMUNA qatorlari: izohida «NAMUNA» — import ularni o'tkazib yuboradi.
//   • Hudud, xizmat, xodim ustunlarida ochiladigan ro'yxat (ma'lumotnoma varaqlaridan).
//   • Oy ustuni matn formatida (Excel «2026-09» ni sanaga aylantirmasin).
// ═══════════════════════════════════════════════════════════

export interface RefData {
  regions: { code: number; name: string; isActive: boolean }[];
  services: { code: string; label: string; isActive: boolean; tariffSom: number | null; tariffFrom: string | null }[];
  employees: { pinfl: string; fullName: string; regionCode: number; position: string | null; hiredAt: string | null; firedAt: string | null; isActive: boolean }[];
  /** «Mavjud ma'lumot bilan» yuklab olishda — qatorlar */
  fill?: Partial<Record<ImportKind, Record<string, unknown>[]>>;
  samplePeriod: string;
}

const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8EEF9' } };
const REQ_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFDE7CF' } };
const SAMPLE_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F1F1' } };
const BORDER = { bottom: { style: 'thin' as const, color: { argb: 'FFBFC9D9' } } };

const FORMAT: Record<Col['type'], string> = {
  month: '@',
  region: '0',
  service: '@',
  employee: '@',
  int: '0',
  num: '0.##',
  money: '#,##0.00',
  bool: '@',
  text: '@',
  date: 'yyyy-mm-dd',
};

const TYPE_TEXT: Record<Col['type'], string> = {
  month: 'Oy: YYYY-MM (matn)',
  region: "Hudud kodi (son) — ro'yxatdan",
  service: "Xizmat kodi — ro'yxatdan",
  employee: 'PINFL — 14 raqam (matn)',
  int: 'Butun son',
  num: 'Son (0 yoki musbat)',
  money: "So'm (kasr — 2 xonagacha)",
  bool: "ha / yo'q",
  text: 'Matn',
  date: 'Sana: YYYY-MM-DD',
};

function sampleRows(def: KindDef, ref: RefData): Record<string, unknown>[] {
  const r = ref.regions.find((x) => x.code !== 0 && x.isActive)?.code ?? 3;
  const s = ref.services[0];
  const s2 = ref.services[1] ?? s;
  const e = ref.employees.find((x) => x.regionCode === r) ?? ref.employees[0];
  const p = ref.samplePeriod;
  const t1 = s?.tariffSom ?? 50000;
  const t2 = s2?.tariffSom ?? 30000;
  const mark = `${SAMPLE_MARK} — import qilinmaydi`;
  switch (def.kind) {
    case 'STATS':
      return [
        { oy: p, hudud_id: r, xizmat_id: s?.code ?? 'SRV_01', xizmat_soni: 120, tarif: t1, daromad_sum: 120 * t1, reja_sum: null, manba_id: 'Hisobot №12', izoh: mark },
        { oy: p, hudud_id: r, xizmat_id: s2?.code ?? 'SRV_02', xizmat_soni: 0, tarif: t2, daromad_sum: 0, reja_sum: null, manba_id: null, izoh: mark },
      ];
    case 'EMP_MONTHS':
      return [{ oy: p, xodim_id: e?.pinfl ?? '12345678901234', hudud_id: r, ishlangan_kun: 22, ish_soati: 176, ta_til_kun: 0, jami_xizmat_soni: 64, jami_daromad_sum: 64 * t1, reja_sum: null, faol_holat: 'ha', izoh: mark }];
    case 'EMP_SERVICES':
      return [{ oy: p, xodim_id: e?.pinfl ?? '12345678901234', hudud_id: r, xizmat_id: s?.code ?? 'SRV_01', xizmat_soni: 40, tarif: t1, daromad_sum: 40 * t1, izoh: mark }];
    case 'FACTORS':
      return [{ oy: p, hudud_id: r, faol_tadbirkorlar_soni: 5200, xodimlar_soni: 18, ish_kunlari: 22, faol_xodimlar_soni: 17, izoh: mark }];
    case 'SERVICES':
      return [{ xizmat_id: 'SRV_99', xizmat_nomi: 'Yangi xizmat nomi', amaldagi_tarif: 25000, amal_boshlanish_sanasi: `${p}-01`, amal_tugash_sanasi: null, faol_holat: 'ha', izoh: mark }];
  }
}

function listRange(sheet: string, col: string, count: number): string {
  return `'${sheet}'!$${col}$2:$${col}$${Math.max(2, count + 1)}`;
}

function dataSheet(wb: ExcelJS.Workbook, def: KindDef, ref: RefData): void {
  const ws = wb.addWorksheet(def.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = def.cols.map((c) => ({ key: c.key, width: c.width ?? 16, style: { numFmt: FORMAT[c.type] } }));
  const head = ws.getRow(1);
  def.cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.key;
    cell.font = { bold: true, color: { argb: 'FF1F2A44' } };
    cell.fill = c.required ? REQ_FILL : HEAD_FILL;
    cell.border = BORDER;
    cell.note = `${c.label}${c.required ? ' — MAJBURIY' : ' — ixtiyoriy'}\n${TYPE_TEXT[c.type]}\n${c.hint}`;
  });
  head.height = 20;

  const rows: Record<string, unknown>[] = [];
  const filled = ref.fill?.[def.kind];
  const samples = sampleRows(def, ref);
  if (def.kind === 'SERVICES') {
    // Xizmatlar katalogi — joriy holat bilan to'ldirilgan (o'zgartirib qayta yuklash mumkin)
    for (const s of ref.services) rows.push({ xizmat_id: s.code, xizmat_nomi: s.label, amaldagi_tarif: s.tariffSom, amal_boshlanish_sanasi: s.tariffFrom, amal_tugash_sanasi: null, faol_holat: s.isActive ? 'ha' : "yo'q", izoh: null });
  } else if (filled) {
    rows.push(...filled);
  }
  // Namunalar — doim tepada (2–3-qatorlar), kulrang
  for (const smp of samples) {
    const row = ws.addRow(def.cols.map((c) => smp[c.key] ?? null));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = SAMPLE_FILL;
      cell.font = { italic: true, color: { argb: 'FF7A7A7A' } };
    });
  }
  for (const r of rows) ws.addRow(def.cols.map((c) => r[c.key] ?? null));

  // Ochiladigan ro'yxatlar
  const lastRow = Math.max(2000, rows.length + samples.length + 500);
  def.cols.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    let formula: string | null = null;
    if (c.type === 'region') formula = listRange('Hududlar', 'A', ref.regions.length);
    if (c.type === 'service' && def.kind !== 'SERVICES') formula = listRange('Xizmat_royxati', 'A', ref.services.length);
    if (c.type === 'employee' && ref.employees.length) formula = listRange('Xodimlar', 'A', ref.employees.length);
    if (c.type === 'bool') formula = '"ha,yo\'q"';
    if (!formula) return;
    // Butun ustun oralig'iga bitta qoida (har katakka alohida emas — fayl yengil)
    (ws as unknown as { dataValidations: { add: (range: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add(`${letter}2:${letter}${lastRow}`, {
      type: 'list',
      allowBlank: !c.required,
      formulae: [formula],
      showErrorMessage: c.type !== 'employee',
      errorStyle: 'warning',
      errorTitle: c.label,
      error: "Ro'yxatdagi qiymatni tanlang",
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length } };
}

function refSheets(wb: ExcelJS.Workbook, ref: RefData, withEmployees: boolean): void {
  const note = (ws: ExcelJS.Worksheet, text: string, col: number) => {
    const c = ws.getRow(1).getCell(col);
    c.value = text;
    c.font = { italic: true, color: { argb: 'FF7A7A7A' } };
  };
  const hs = wb.addWorksheet('Hududlar', { views: [{ state: 'frozen', ySplit: 1 }] });
  hs.columns = [
    { header: 'hudud_id', key: 'a', width: 10 },
    { header: 'hudud_nomi', key: 'b', width: 32 },
    { header: 'faol_holat', key: 'c', width: 10 },
  ];
  hs.getRow(1).font = { bold: true };
  for (const r of ref.regions.filter((x) => x.code !== 0)) hs.addRow({ a: r.code, b: r.name, c: r.isActive ? 'ha' : "yo'q" });
  note(hs, "Ma'lumotnoma — import qilinmaydi (Sozlamalarda boshqariladi)", 5);

  const ss = wb.addWorksheet('Xizmat_royxati', { views: [{ state: 'frozen', ySplit: 1 }] });
  ss.columns = [
    { header: 'xizmat_id', key: 'a', width: 11 },
    { header: 'xizmat_nomi', key: 'b', width: 60 },
    { header: 'amaldagi_tarif', key: 'c', width: 15, style: { numFmt: '#,##0' } },
    { header: 'tarif_sanasi', key: 'd', width: 12 },
    { header: 'faol_holat', key: 'e', width: 10 },
  ];
  ss.getRow(1).font = { bold: true };
  for (const s of ref.services) ss.addRow({ a: s.code, b: s.label, c: s.tariffSom, d: s.tariffFrom, e: s.isActive ? 'ha' : "yo'q" });
  note(ss, "Ma'lumotnoma — tarifni o'zgartirish uchun «Xizmatlar» shablonidan foydalaning", 7);

  if (withEmployees) {
    const es = wb.addWorksheet('Xodimlar', { views: [{ state: 'frozen', ySplit: 1 }] });
    es.columns = [
      { header: 'xodim_id', key: 'a', width: 17, style: { numFmt: '@' } },
      { header: 'xodim_fio', key: 'b', width: 34 },
      { header: 'hudud_id', key: 'c', width: 10 },
      { header: 'lavozim', key: 'd', width: 22 },
      { header: 'ishga_kirgan_sana', key: 'e', width: 14 },
      { header: 'ishdan_ketgan_sana', key: 'f', width: 14 },
      { header: 'faol_holat', key: 'g', width: 10 },
    ];
    es.getRow(1).font = { bold: true };
    for (const e of ref.employees) es.addRow({ a: e.pinfl, b: e.fullName, c: e.regionCode, d: e.position, e: e.hiredAt, f: e.firedAt, g: e.isActive ? 'ha' : "yo'q" });
    note(es, "Ma'lumotnoma — Xodimlar bo'limida boshqariladi", 9);
  }
}

function guideSheet(wb: ExcelJS.Workbook, kinds: ImportKind[]): void {
  const ws = wb.addWorksheet("Yo'riqnoma");
  ws.columns = [{ width: 26 }, { width: 22 }, { width: 12 }, { width: 30 }, { width: 70 }];
  const title = ws.addRow(['Hudud uchun reja — Excel shablonlari']);
  title.font = { bold: true, size: 14 };
  const steps = [
    "1. Kerakli varaqni to'ldiring. 1-qatordagi ustun nomlarini o'zgartirmang.",
    "2. Kulrang NAMUNA qatorlari import qilinmaydi — ularni o'chirsangiz ham, qoldirsangiz ham bo'ladi.",
    "3. To'q sariq sarlavhali ustunlar — majburiy. Bo'sh qoldirilgan majburiy katak — xato.",
    "4. Oy — YYYY-MM matn ko'rinishida (2026-09). Pul — so'mda. Hudud, xizmat va xodim — ochiladigan ro'yxatdan.",
    "5. Ma'lumoti bo'lmagan oyni 0 bilan to'ldirmang — qatorni yozmang. Xizmat ko'rsatilmagan bo'lsa — 0 yozing.",
    "6. Dasturda: Hudud uchun reja › Ma'lumotlarni yuklash → faylni tanlang → «Tekshirish» → natijani ko'ring → «Importni tasdiqlash».",
    "7. Bir xil faylni qayta yuklash dublikat yaratmaydi: mavjud yozuv yangilanadi yoki o'tkazib yuboriladi (siz tanlaysiz).",
    "8. Faylda formulalar bo'lsa — faqat ularning hisoblangan qiymati olinadi; makroslar bajarilmaydi.",
  ];
  ws.addRow([]);
  for (const s of steps) ws.addRow([s]);
  for (const k of kinds) {
    const d = KINDS[k];
    ws.addRow([]);
    const h = ws.addRow([`Varaq: ${d.sheet}`, d.title]);
    h.font = { bold: true, size: 12 };
    ws.addRow(['Qanday ma\'lumot', d.what]);
    ws.addRow(['Nima uchun', d.why]);
    ws.addRow(['Bitta qator', d.row]);
    ws.addRow(['Kalit (takrorlanmaydi)', d.key.join(' + ')]);
    ws.addRow(['Prognoz uchun', d.mandatory ? 'MAJBURIY' : 'Ixtiyoriy (bor bo‘lsa aniqlik oshadi)']);
    const th = ws.addRow(['Ustun', 'Nomi', 'Majburiy', 'Format', 'Izoh']);
    th.font = { bold: true };
    th.eachCell((c) => (c.fill = HEAD_FILL));
    for (const c of d.cols) ws.addRow([c.key, c.label, c.required ? 'ha' : '', TYPE_TEXT[c.type], c.hint]);
  }
  ws.getColumn(1).alignment = { vertical: 'top' };
  ws.getColumn(5).alignment = { wrapText: true, vertical: 'top' };
}

/** Bitta tur yoki hammasi (kind = 'ALL') */
export async function buildTemplate(kind: ImportKind | 'ALL', ref: RefData): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil — Hudud uchun reja';
  wb.created = new Date();
  const kinds = kind === 'ALL' ? KIND_ORDER : [kind];
  guideSheet(wb, kinds);
  for (const k of kinds) dataSheet(wb, KINDS[k], ref);
  const needEmployees = kinds.some((k) => KINDS[k].cols.some((c) => c.type === 'employee'));
  refSheets(wb, ref, needEmployees);
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = kind === 'ALL' ? 'Hudud_reja_Barcha_shablonlar.xlsx' : `Hudud_reja_${KINDS[kind].sheet}.xlsx`;
  return { buffer, filename };
}