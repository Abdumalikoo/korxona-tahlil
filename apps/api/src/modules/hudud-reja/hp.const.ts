// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — import turlari, ustunlar va umumiy yordamchilar.
// Shablon, tekshiruv va «Yo'riqnoma» varag'i shu bitta ta'rifdan quriladi.
// ═══════════════════════════════════════════════════════════

export type ImportKind = 'STATS' | 'EMP_MONTHS' | 'EMP_SERVICES' | 'FACTORS' | 'SERVICES';

export type ColType = 'month' | 'region' | 'service' | 'employee' | 'int' | 'num' | 'money' | 'bool' | 'text' | 'date';

export interface Col {
  key: string;
  label: string;
  type: ColType;
  required: boolean;
  hint: string;
  width?: number;
}

export interface KindDef {
  kind: ImportKind;
  sheet: string;
  title: string;
  /** Qanday ma'lumot */
  what: string;
  /** Nima uchun kerak */
  why: string;
  /** Bitta qator nimani bildiradi */
  row: string;
  /** Kalit ustunlar (bir xil kalit — bitta yozuv) */
  key: string[];
  cols: Col[];
  /** Prognoz uchun majburiymi */
  mandatory: boolean;
}

const C = (key: string, label: string, type: ColType, required: boolean, hint: string, width = 16): Col => ({ key, label, type, required, hint, width });

export const KINDS: Record<ImportKind, KindDef> = {
  STATS: {
    kind: 'STATS',
    sheet: 'Daromad_Tarixi',
    title: 'Daromad va xizmatlar soni',
    what: "Har oy, har hudud va har bir xizmat bo'yicha ko'rsatilgan xizmatlar soni va olingan daromad",
    why: "Prognozning asosi: modellar xizmatlar sonining oylik qatoridan o'rganadi, daromad = soni × tarif",
    row: 'Bitta oy × bitta hudud × bitta xizmat',
    key: ['oy', 'hudud_id', 'xizmat_id'],
    mandatory: true,
    cols: [
      C('oy', 'Oy', 'month', true, 'YYYY-MM, masalan 2026-09 (matn sifatida)', 10),
      C('hudud_id', 'Hudud ID', 'region', true, "«Ro'yxatlar» varag'idagi hudud kodi (Markaz emas)", 10),
      C('xizmat_id', 'Xizmat ID', 'service', true, "«Ro'yxatlar» varag'idagi xizmat kodi (SRV_01 …)", 11),
      C('xizmat_soni', 'Xizmatlar soni', 'num', true, "Shu oyda ko'rsatilgan xizmatlar soni (0 yoki musbat)", 12),
      C('tarif', 'Tarif', 'money', false, "Shu oyda qo'llangan bitta xizmat narxi, so'm (bo'sh bo'lsa — katalogdagi tarif)", 14),
      C('daromad_sum', "Daromad (so'm)", 'money', true, "Shu xizmatdan olingan haqiqiy daromad, so'm", 16),
      C('reja_sum', "Reja (so'm)", 'money', false, "Avval belgilangan reja bo'lsa, so'm", 14),
      C('manba_id', 'Manba', 'text', false, 'Ixtiyoriy: hisobot raqami, fayl nomi va h.k.', 14),
      C('izoh', 'Izoh', 'text', false, 'Ixtiyoriy', 24),
    ],
  },
  EMP_MONTHS: {
    kind: 'EMP_MONTHS',
    sheet: 'Xodimlar_Tarixi',
    title: 'Xodimlar natijalari',
    what: 'Har bir xodimning har oydagi ishlangan kunlari, xizmatlari va tushumi',
    why: "Xodimlar rejasini ish kunlari bilan adolatli taqsimlash uchun. Kelasi oy qatori — rejalashtirilgan ish kunlari",
    row: 'Bitta oy × bitta xodim',
    key: ['oy', 'xodim_id'],
    mandatory: false,
    cols: [
      C('oy', 'Oy', 'month', true, 'YYYY-MM. Kelasi oy uchun yozilsa — rejalashtirilgan ish kunlari', 10),
      C('xodim_id', 'Xodim ID (JShShIR)', 'employee', true, '14 xonali PINFL — Xodimlar bo‘limidagi xodim', 17),
      C('hudud_id', 'Hudud ID', 'region', true, 'Shu oyda xodim ishlagan hudud', 10),
      C('ishlangan_kun', 'Ishlangan kun', 'num', true, '0 — 31', 10),
      C('ish_soati', 'Ish soati', 'num', false, 'Ixtiyoriy', 10),
      C('ta_til_kun', "Ta'til kuni", 'num', false, 'Ixtiyoriy', 10),
      C('jami_xizmat_soni', 'Jami xizmatlar', 'num', false, 'Ixtiyoriy', 12),
      C('jami_daromad_sum', "Jami daromad (so'm)", 'money', false, 'Ixtiyoriy', 16),
      C('reja_sum', "Reja (so'm)", 'money', false, 'Ixtiyoriy: shu oy uchun belgilangan reja', 14),
      C('faol_holat', 'Faol', 'bool', false, "ha / yo'q (bo'sh — ha)", 8),
      C('izoh', 'Izoh', 'text', false, 'Ixtiyoriy', 22),
    ],
  },
  EMP_SERVICES: {
    kind: 'EMP_SERVICES',
    sheet: 'Xodim_Xizmatlari',
    title: "Xodimlar va xizmatlar bog'lanishi",
    what: "Har bir xodim har oy qaysi xizmatdan nechta ko'rsatgani va qancha daromad keltirgani",
    why: "Hudud prognozini xodimlarga xizmatlar kesimida taqsimlash uchun (tarixiy ulush)",
    row: 'Bitta oy × bitta xodim × bitta xizmat',
    key: ['oy', 'hudud_id', 'xodim_id', 'xizmat_id'],
    mandatory: false,
    cols: [
      C('oy', 'Oy', 'month', true, 'YYYY-MM', 10),
      C('xodim_id', 'Xodim ID (JShShIR)', 'employee', true, '14 xonali PINFL', 17),
      C('hudud_id', 'Hudud ID', 'region', true, 'Xizmat ko‘rsatilgan hudud', 10),
      C('xizmat_id', 'Xizmat ID', 'service', true, 'SRV_01 …', 11),
      C('xizmat_soni', 'Xizmatlar soni', 'num', true, '0 yoki musbat', 12),
      C('tarif', 'Tarif', 'money', false, "Ixtiyoriy, so'm", 14),
      C('daromad_sum', "Daromad (so'm)", 'money', true, "So'm", 16),
      C('izoh', 'Izoh', 'text', false, 'Ixtiyoriy', 22),
    ],
  },
  FACTORS: {
    kind: 'FACTORS',
    sheet: 'Hudud_Omillari',
    title: "Hududlar va faoliyat ko'rsatkichlari",
    what: "Hududdagi faol tadbirkorlar, xodimlar soni va oyning ish kunlari",
    why: "Ma'lumotlar sifatini tekshirish va kelasi oy ish kunlarini aniqlash uchun (ixtiyoriy)",
    row: 'Bitta oy × bitta hudud',
    key: ['oy', 'hudud_id'],
    mandatory: false,
    cols: [
      C('oy', 'Oy', 'month', true, 'YYYY-MM (kelasi oy ham bo‘lishi mumkin)', 10),
      C('hudud_id', 'Hudud ID', 'region', true, 'Hudud kodi', 10),
      C('faol_tadbirkorlar_soni', 'Faol tadbirkorlar', 'int', false, 'Ixtiyoriy', 14),
      C('xodimlar_soni', 'Xodimlar soni', 'int', false, 'Ixtiyoriy', 12),
      C('ish_kunlari', 'Ish kunlari', 'num', false, 'Oydagi ish kunlari (masalan 22)', 10),
      C('faol_xodimlar_soni', 'Faol xodimlar', 'int', false, 'Ixtiyoriy', 12),
      C('izoh', 'Izoh', 'text', false, 'Ixtiyoriy', 22),
    ],
  },
  SERVICES: {
    kind: 'SERVICES',
    sheet: 'Xizmatlar',
    title: 'Xizmatlar katalogi va tariflar',
    what: '39 ta xizmat va ularning amaldagi tariflari',
    why: "Prognoz soni daromadga tarif orqali aylanadi. Mavjud xizmat nomi o'zgartirilmaydi — faqat tarif yangilanadi",
    row: 'Bitta xizmat (tarif o‘zgargan bo‘lsa — yangi sana bilan alohida qator)',
    key: ['xizmat_id', 'amal_boshlanish_sanasi'],
    mandatory: false,
    cols: [
      C('xizmat_id', 'Xizmat ID', 'service', true, 'SRV_01 … (yangi xizmat — SRV_40 kabi yangi kod)', 11),
      C('xizmat_nomi', 'Xizmat nomi', 'text', true, "Mavjud xizmatda — o'zgartirilmaydi (faqat tekshiriladi)", 40),
      C('amaldagi_tarif', "Tarif (so'm)", 'money', true, 'Bitta xizmat narxi', 14),
      C('amal_boshlanish_sanasi', 'Amal boshlanishi', 'date', false, "YYYY-MM-DD (bo'sh — bugundan)", 14),
      C('amal_tugash_sanasi', 'Amal tugashi', 'date', false, 'Ixtiyoriy', 14),
      C('faol_holat', 'Faol', 'bool', false, "ha / yo'q", 8),
      C('izoh', 'Izoh', 'text', false, 'Ixtiyoriy', 22),
    ],
  },
};

export const KIND_ORDER: ImportKind[] = ['STATS', 'EMP_MONTHS', 'EMP_SERVICES', 'FACTORS', 'SERVICES'];

/** Namunaviy qator belgisi — import qilinmaydi */
export const SAMPLE_MARK = 'NAMUNA';

export const SERVICE_CODE = /^SRV_\d{2,3}$/;
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_ROWS = 60_000;

export type Source = 'merged' | 'system' | 'import';
export const SOURCE_LABEL: Record<Source, string> = {
  merged: "Birlashtirilgan (yuklangan + dasturdagi)",
  system: 'Dasturdagi daromadlar (Hududlar tushumi)',
  import: "Faqat yuklangan tarix",
};

export const RELIABILITY_LABEL: Record<string, string> = { high: 'Yuqori', medium: "O'rta", low: 'Past', none: 'Aniqlanmagan' };

export function periodAdd(p: string, n: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  while (cur <= b && out.length < 240) {
    out.push(cur);
    cur = periodAdd(cur, 1);
  }
  return out;
}

export function currentPeriodTashkent(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
}

export const toSom = (t: bigint | number | null | undefined): number | null => (t === null || t === undefined ? null : Number(t) / 100);