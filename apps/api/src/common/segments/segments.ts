// ═══════════════════════════════════════════════════════════
// Yo'nalishlar — Markaz va hududlardan tashqari alohida birliklar (BITTA joyda).
// Daromad yoki xarajat yozuvida `segment` maydoni bo'lsa — yozuv shu yo'nalishniki:
// hudud va bo'lim bo'sh qoladi, Solishtirmada alohida qator (o'z daromadi, xarajati va natijasi).
// Xarajatlar siyosatida ham modda shu yo'nalishlardan biri hisobidan belgilanishi mumkin.
// Yangi yo'nalish qo'shish: shu ro'yxatga bitta qator (web: apps/web/src/lib/segments.ts — xuddi shunday).
// ═══════════════════════════════════════════════════════════

/**
 * Hududlar › Umumiy: hech qaysi viloyatga tegishli bo'lmagan hudud xarajati / daromadi (Markaz › Umumiy kabi).
 * regions jadvalida alohida qator — Hudud jamisiga kiradi; xodim, reja, tarif kabi joylarda viloyat sifatida chiqmaydi.
 * (web: apps/web/src/lib/segments.ts — xuddi shunday)
 */
export const REGION_GENERAL = 99;
export const REGION_GENERAL_LABEL = 'Hududlar › Umumiy';
/** Haqiqiy viloyatlar (Hududlar › Umumiysiz) */
export const realRegions = <T extends { code: number }>(list: T[]) => list.filter((r) => r.code !== REGION_GENERAL);

export const SEGMENTS = [
  { code: 'TAX_FREE', label: 'Tax free' },
  { code: 'MARKSHEYDER', label: 'Marksheyder' },
  { code: 'FERMER', label: "Fermer xo'jaligi" },
  { code: 'BUXGALTERIYA', label: 'Buxgalteriya xizmatlari' },
  /** Qo'mita pullaridan qilingan sarflar — Xarajatlar siyosati orqali boshqa bo'limlardan o'tkaziladi */
  { code: 'QOMITA', label: "Qo'mita pullarining sarfi" },
] as const;

export type SegmentCode = (typeof SEGMENTS)[number]['code'];

export const SEGMENT_CODES: string[] = SEGMENTS.map((s) => s.code);

export function isSegment(code: unknown): code is SegmentCode {
  return typeof code === 'string' && SEGMENT_CODES.includes(code);
}

export function segmentLabel(code: string): string {
  return SEGMENTS.find((s) => s.code === code)?.label ?? code;
}

/** Solishtirma birligi kaliti: "s:TAX_FREE" */
export function segmentKey(code: string): string {
  return `s:${code}`;
}

/** Birlik kalitidan yo'nalish kodi ("s:TAX_FREE" → "TAX_FREE"), boshqasi — null */
export function segmentOfKey(key: string): SegmentCode | null {
  const code = key.startsWith('s:') ? key.slice(2) : '';
  return isSegment(code) ? code : null;
}

/**
 * Yozuvning birligi (Solishtirma va hisobotlar uchun yagona qoida):
 * yo'nalish → "s:KOD"; hudud kodi 0 yoki Markaz bo'limi → "center"; hudud kodi → "r:KOD"; aks holda — "none".
 */
export function unitKeyOf(regionCode: number | null, departmentId: string | null, segment?: string | null): string {
  if (segment && isSegment(segment)) return segmentKey(segment);
  if (regionCode !== null && regionCode !== undefined) return regionCode === 0 ? 'center' : `r:${regionCode}`;
  if (departmentId) return 'center';
  return 'none';
}

// ═══════════════════════════════════════════════════════════
// Kiritish bo'limlari — daromad va xarajat 6 bo'limda alohida yuritiladi:
// Markaz, Hududlar va 4 ta yo'nalish. Har bo'limning o'z moddalar ro'yxati bor (unit-categories.ts).
// ═══════════════════════════════════════════════════════════

export const ENTRY_UNITS = [
  { code: 'CENTER', label: 'Markaz' },
  { code: 'REGION', label: 'Hududlar' },
  ...SEGMENTS.map((s) => ({ code: s.code as string, label: s.label as string })),
] as const;

export const ENTRY_UNIT_CODES: string[] = ENTRY_UNITS.map((u) => u.code);

export function entryUnitLabel(code: string): string {
  return ENTRY_UNITS.find((u) => u.code === code)?.label ?? code;
}

/** Yozuv qaysi kiritish bo'limiga tegishli (biriktirilmagan — null) */
export function entryUnitOf(place: { regionCode: number | null; departmentId: string | null; segment?: string | null }): string | null {
  if (place.segment && isSegment(place.segment)) return place.segment;
  if (place.regionCode === 0 || (place.regionCode === null && place.departmentId)) return 'CENTER';
  if (place.regionCode !== null && place.regionCode > 0) return 'REGION';
  return null;
}

/** Ro'yxat filtri: shu bo'lim yozuvlari (daromad va xarajat jadvallari uchun bir xil shart) */
export function entryUnitWhere(code: string): Record<string, unknown> {
  if (code === 'CENTER') return { segment: null, OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }] };
  if (code === 'REGION') return { segment: null, regionCode: { gt: 0 } };
  return { segment: code };
}