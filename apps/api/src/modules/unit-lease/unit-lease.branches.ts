// ═══════════════════════════════════════════════════════════
// Yo'nalish filiallari va doimiy to'lov turlari — shablon shu filiallar × turlar kesimida yuritiladi.
//
//  • Tax free: 13 ta filial (nomlari rasmiy yozilishida, ro'yxat qat'iy); turlar — Ijara, Kommunal.
//  • Fermer xo'jaligi: joylar ro'yxati sahifada tahrirlanadi (`settings` «unit.lease.branches.FERMER»);
//    turlar — Ijara, Internet.
//  Yangi filial — ro'yxat oxiriga bitta qator (kod o'zgarmas bo'lsin: saqlangan ma'lumotlar kod bo'yicha bog'langan).
// ═══════════════════════════════════════════════════════════

export interface UnitBranch {
  /** O'zgarmas kod (saqlangan ma'lumotlar shu kod bilan) */
  code: string;
  /** Shablondagi tartib raqami (№) */
  no: number;
  name: string;
}

export interface LeaseKindDef {
  /** Shablon kodi (2026-01|IJARA) */
  key: string;
  /** Ustun nomi */
  label: string;
  /** Xarajat moddasi */
  category: string;
  categoryLabel: string;
  /** Saqlangan katakdagi maydon nomi: IJARA → ijaraTiyin */
  field: string;
}

export interface LeaseUnitConfig {
  /** Sahifa/shablon nomi */
  title: string;
  kinds: LeaseKindDef[];
  /** Qat'iy ro'yxat (Tax free) yoki null — sahifada tahrirlanadi */
  branches: UnitBranch[] | null;
  /** Tahrirlanadigan ro'yxat uchun: yangi kod prefiksi va boshlang'ich joy */
  codePrefix: string;
  defaultBranch: string;
  /** Shablondagi ustun nomi: «Filial» yoki «Joy» */
  branchLabel: string;
}

const kind = (key: string, label: string, category: string, categoryLabel: string): LeaseKindDef => ({ key, label, category, categoryLabel, field: `${key.toLowerCase()}Tiyin` });

export const KIND_IJARA = kind('IJARA', 'Ijara', 'LEASE', 'Ijara');
export const KIND_KOMMUNAL = kind('KOMMUNAL', 'Kommunal', 'KOMMUNAL', "Kommunal to'lovlar");
export const KIND_INTERNET = kind('INTERNET', 'Internet', 'INTERNET', 'Internet xizmatlari');

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

export const LEASE_CONFIG: Record<string, LeaseUnitConfig> = {
  TAX_FREE: { title: 'Ijara va kommunal', kinds: [KIND_IJARA, KIND_KOMMUNAL], branches: TAX_FREE, codePrefix: 'TF', defaultBranch: '', branchLabel: 'Filial' },
  FERMER: { title: 'Ijara va internet', kinds: [KIND_IJARA, KIND_INTERNET], branches: null, codePrefix: 'FX', defaultBranch: "Fermer xo'jaligi", branchLabel: 'Joy' },
};

/** Hamma yo'nalishlardagi to'lov turlari (moddalar yaratish uchun) */
export const ALL_LEASE_KINDS: LeaseKindDef[] = [...new Map(Object.values(LEASE_CONFIG).flatMap((c) => c.kinds).map((k) => [k.key, k])).values()];

export const leaseConfig = (unit: string): LeaseUnitConfig | undefined => LEASE_CONFIG[unit];

/** Qat'iy filiallar ro'yxati (Tax free). Tahrirlanadigan ro'yxatlar — UnitLeaseService.branchesOf */
export function unitBranches(unit: string): UnitBranch[] {
  return LEASE_CONFIG[unit]?.branches ?? [];
}

/** Eski nom — Tax free turlari (moslik uchun) */
export const LEASE_KINDS = [KIND_IJARA, KIND_KOMMUNAL] as const;
export type LeaseKind = string;