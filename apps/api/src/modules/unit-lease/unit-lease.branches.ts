// ═══════════════════════════════════════════════════════════
// Yo'nalish filiallari — ijara va kommunal to'lovlari shu filiallar kesimida yuritiladi.
// Tax free: 13 ta filial (nomlari rasmiy yozilishida). Yangi filial — ro'yxat oxiriga bitta qator
// (kod o'zgarmas bo'lsin: saqlangan ma'lumotlar kod bo'yicha bog'langan).
// ═══════════════════════════════════════════════════════════

export interface UnitBranch {
  /** O'zgarmas kod (saqlangan ma'lumotlar shu kod bilan) */
  code: string;
  /** Shablondagi tartib raqami (№) */
  no: number;
  name: string;
}

const TAX_FREE: UnitBranch[] = [
  'Чет эл фуқароларига қўшилган қиймат солиғини қайтариш бўйича "Tax free" филиали марказий аппарат',
  '"Tax free" филиали Қорақалпоғистон Республикаси Нукус халқаро аэропорти',
  '"Tax free" филиали Урганч халқаро аэропорти',
  '"Tax free" филиали Бухоро халқаро аэропорти',
  '"Tax free" филиали Навоий халқаро аэропорти',
  '"Tax free" филиали Қашқадарё халқаро аэропорти',
  '"Tax free" филиали Сурхондарё халқаро аэропорти',
  '"Tax free" филиали Андижон халқаро аэропорти',
  '"Tax free" филиали Наманган халқаро аэропорти',
  '"Tax free" филиали Самарқанд халқаро аэропорти',
  '"Tax free" филиали Тошкент халқаро аэропорти',
  '"Tax free" филиали Фарғона халқаро аэропорти',
  '"Tax free" филиали Тошкент вилояти "Ғишткўприк" божхона пости бўлими',
].map((name, i) => ({ code: `TF${String(i + 1).padStart(2, '0')}`, no: i + 1, name }));

const BY_UNIT: Record<string, UnitBranch[]> = { TAX_FREE };

export function unitBranches(unit: string): UnitBranch[] {
  return BY_UNIT[unit] ?? [];
}

/** To'lov turlari (shablon ustunlari) va xarajat moddalari */
export const LEASE_KINDS = [
  { key: 'IJARA', label: 'Ijara', category: 'LEASE', categoryLabel: 'Ijara' },
  { key: 'KOMMUNAL', label: 'Kommunal', category: 'KOMMUNAL', categoryLabel: "Kommunal to'lovlar" },
] as const;

export type LeaseKind = (typeof LEASE_KINDS)[number]['key'];