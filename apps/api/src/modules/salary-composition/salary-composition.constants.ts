import type { SalaryComponentCategory, SalaryComponentGroup } from '@prisma/client';

/** Standart komponent — birinchi ishga tushishda bazaga yoziladi */
export interface DefaultComponent {
  code: string;
  name: string;
  group: SalaryComponentGroup;
  category: SalaryComponentCategory;
  sign: 1 | -1;
  sortOrder: number;
}

/**
 * Boshlang'ich 18 ta komponent (choraklik mukofot keyin qo'shilgan — mavjud bazaga ham yoziladi).
 * Keyin Sozlamalar orqali qo'shish / nomini o'zgartirish / nofaol qilish mumkin.
 */
export const DEFAULT_COMPONENTS: DefaultComponent[] = [
  // ─────────── Byudjet hisobidan ───────────
  { code: 'OKLAD', name: 'Oklad', group: 'BUDGET', category: 'ASOSIY', sign: 1, sortOrder: 10 },
  { code: 'OKLAD_40', name: 'Oklad ustamasi 40%', group: 'BUDGET', category: 'ASOSIY', sign: 1, sortOrder: 20 },
  { code: 'STAJ', name: 'Staj ustamasi', group: 'BUDGET', category: 'ASOSIY', sign: 1, sortOrder: 30 },
  { code: 'TATIL', name: "Ta'til puli", group: 'BUDGET', category: 'TATIL', sign: 1, sortOrder: 40 },
  { code: 'TATIL_KOMP', name: "Ta'til kompensatsiyasi", group: 'BUDGET', category: 'TATIL', sign: 1, sortOrder: 50 },
  { code: 'KASALLIK', name: 'Kasallik varaqasi', group: 'BUDGET', category: 'TATIL', sign: 1, sortOrder: 60 },
  { code: 'DEKRET', name: 'Dekret', group: 'BUDGET', category: 'TATIL', sign: 1, sortOrder: 70 },
  { code: 'MODDIY', name: 'Moddiy yordam / komandirovka', group: 'BUDGET', category: 'KOMPENSATSIYA', sign: 1, sortOrder: 80 },

  // ─────────── Xo'jalik hisobidan ───────────
  { code: 'KPI', name: 'KPI premiyasi', group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 110 },
  { code: 'BAYRAM', name: 'Bayram premiyasi', group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 120 },
  { code: 'CHORAK', name: 'Choraklik mukofot', group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 125 },
  { code: 'PREMIYA_BOSHQA', name: 'Boshqa premiya (bildirgi)', group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 130 },
  { code: 'TRANSPORT', name: 'Transport', group: 'HOJALIK', category: 'KOMPENSATSIYA', sign: 1, sortOrder: 140 },
  { code: 'OVQAT', name: 'Ovqat', group: 'HOJALIK', category: 'KOMPENSATSIYA', sign: 1, sortOrder: 150 },
  { code: 'SERTIFIKAT', name: 'Sertifikat / ilmiy daraja ustamasi', group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 160 },
  { code: 'USTAMA_BOSHQA', name: 'Boshqa ustamalar', group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 170 },
  { code: 'BOSHQA', name: 'Boshqa', group: 'HOJALIK', category: 'BOSHQA', sign: 1, sortOrder: 180 },
  { code: 'JARIMA', name: 'Jarima', group: 'HOJALIK', category: 'JARIMA', sign: -1, sortOrder: 190 },
];

export const GROUP_LABELS: Record<SalaryComponentGroup, string> = {
  BUDGET: 'Byudjet hisobidan',
  HOJALIK: "Xo'jalik hisobidan",
};

export const GROUP_ORDER: SalaryComponentGroup[] = ['BUDGET', 'HOJALIK'];

export const CATEGORY_LABELS: Record<SalaryComponentCategory, string> = {
  ASOSIY: 'Asosiy ish haqi',
  TATIL: "Ta'til va kasallik",
  PREMIYA: 'Premiyalar',
  KOMPENSATSIYA: 'Kompensatsiyalar',
  USTAMA: 'Ustamalar',
  JARIMA: 'Jarimalar',
  BOSHQA: 'Boshqa',
};

export const CATEGORY_ORDER: SalaryComponentCategory[] = [
  'ASOSIY',
  'TATIL',
  'PREMIYA',
  'KOMPENSATSIYA',
  'USTAMA',
  'BOSHQA',
  'JARIMA',
];

/** Xodim bo'yicha ruxsat etilgan farq — 1 so'm (yaxlitlash uchun) */
export const DIFF_TOLERANCE_TIYIN = 100n;

/** Shablondagi bo'sh qatorlar soni */
export const TEMPLATE_ROWS = 400;

/** Shablondagi xizmat ustunlari kodlari — komponent kodi sifatida band */
export const SERVICE_CODES = {
  pinfl: 'PINFL',
  fullName: 'FIO',
  days: 'KUN',
  rate: 'STAVKA',
  total: 'JAMI',
  payroll: 'SOLIQ',
  diff: 'FARQ',
} as const;

export const RESERVED_CODES: string[] = Object.values(SERVICE_CODES);

/** Markaz hudud kodi */
export const CENTRAL_REGION = 0;