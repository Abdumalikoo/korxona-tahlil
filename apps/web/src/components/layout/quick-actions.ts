// ═══════════════════════════════════════════════════════════
// Barcha kiritish turlari — bitta ro'yxat.
// «+ Kiritish» oynasi (yuqori panel, N tugmasi) va «Tez kiritish» sahifasi shundan quriladi.
// Har biri: nima, qachon ishlatiladi (bir qator), qayerga olib boradi, qaysi bo'limga yozish huquqi kerak.
// Faqat umumiy hudud kiritadiganlari: ombor, mashina va pochta — Omborchi rolida (bu yerda yo'q).
// ═══════════════════════════════════════════════════════════

export type QuickTone = 'red' | 'green' | 'blue' | 'amber' | 'slate' | 'violet';

export interface QuickAction {
  key: string;
  label: string;
  /** Qachon ishlatiladi — bir qator */
  hint: string;
  href: string;
  /** Yozish huquqi tekshiriladigan bo'lim */
  section: string;
  tone: QuickTone;
  /** Qidiruv uchun qo'shimcha so'zlar */
  words?: string;
}

export interface QuickGroup {
  title: string;
  /** Xarajatlarga yoziladimi — foydalanuvchiga tushuntirish */
  note: string;
  actions: QuickAction[];
}

export const QUICK_GROUPS: QuickGroup[] = [
  {
    title: 'Pul',
    note: "To'lov va tushumlar — to'g'ridan-to'g'ri Xarajatlar va Daromadlarga",
    actions: [
      { key: 'expense', label: 'Xarajat', hint: "Muntazam to'lov: kommunal, aloqa, xizmat, xarid", href: '/xarajatlar/yangi', section: '/xarajatlar', tone: 'red', words: "to'lov chiqim pul" },
      { key: 'expense-once', label: 'Bir martalik xarajat', hint: "Takrorlanmaydigan: jarima, bir martalik xizmat", href: '/xarajatlar/yangi?section=BOSHQA', section: '/xarajatlar', tone: 'red', words: 'boshqa' },
      { key: 'income', label: 'Daromad', hint: "Mijozdan tushum, xizmat haqi", href: '/daromadlar/doimiy?new=1', section: '/daromadlar', tone: 'green', words: 'tushum kirim pul' },
      { key: 'income-once', label: 'Bir martalik daromad', hint: 'Takrorlanmaydigan tushum', href: '/daromadlar/boshqa?new=1', section: '/daromadlar', tone: 'green', words: 'boshqa' },
    ],
  },
  {
    title: 'Excel yuklash',
    note: "Ko'p yozuv bir yo'la — shablon yuklash oynasining ichida",
    actions: [
      { key: 'regions', label: 'Hududlar tushumi', hint: 'Hududlardan kelgan Excel', href: '/daromadlar/hududlar', section: '/daromadlar', tone: 'green', words: 'excel import hudud' },
      { key: 'payroll', label: 'Ish haqi vedomosti', hint: 'Oylik qaydnoma (Excel)', href: '/xarajatlar/ish-haqi', section: '/xarajatlar', tone: 'red', words: 'excel oylik maosh' },
      { key: 'expense-xls', label: 'Xarajatlar (Excel)', hint: "Ko'p xarajat bir yo'la", href: '/xarajatlar/doimiy?import=1', section: '/xarajatlar', tone: 'slate', words: 'excel import' },
      { key: 'income-xls', label: 'Daromadlar (Excel)', hint: "Ko'p daromad bir yo'la", href: '/daromadlar/doimiy?import=1', section: '/daromadlar', tone: 'slate', words: 'excel import' },
    ],
  },
];

export const QUICK_TONES: Record<QuickTone, { dot: string; soft: string; text: string }> = {
  red: { dot: 'bg-red-500', soft: 'bg-red-50', text: 'text-red-700' },
  green: { dot: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  blue: { dot: 'bg-blue-500', soft: 'bg-blue-50', text: 'text-blue-700' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-100', text: 'text-slate-700' },
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700' },
};

/** Foydalanuvchiga ochiq guruhlar (yozish huquqi bo'yicha) */
export function quickGroups(canWrite: (path: string) => boolean): QuickGroup[] {
  return QUICK_GROUPS.map((g) => ({ ...g, actions: g.actions.filter((a) => canWrite(a.section)) })).filter((g) => g.actions.length > 0);
}

/** «+ Kiritish» oynasini ochish (QuickAdd shu hodisani tinglaydi) */
export function openQuickAdd() {
  window.dispatchEvent(new Event('quick-add:open'));
}