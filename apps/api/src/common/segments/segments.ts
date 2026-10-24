// ═══════════════════════════════════════════════════════════
// Yo'nalishlar — Markaz va hududlardan tashqari alohida birliklar (BITTA joyda).
// Daromad yoki xarajat yozuvida `segment` maydoni bo'lsa — yozuv shu yo'nalishniki:
// hudud va bo'lim bo'sh qoladi, Solishtirmada alohida qator (o'z daromadi, xarajati va natijasi).
// Xarajatlar siyosatida ham modda shu yo'nalishlardan biri hisobidan belgilanishi mumkin.
// Yangi yo'nalish qo'shish: shu ro'yxatga bitta qator (web: apps/web/src/lib/segments.ts — xuddi shunday).
// ═══════════════════════════════════════════════════════════

export const SEGMENTS = [
  { code: 'TAX_FREE', label: 'Tax free' },
  { code: 'MARKSHEYDER', label: 'Marksheyder' },
  { code: 'FERMER', label: "Fermer xo'jaligi" },
  { code: 'BUXGALTERIYA', label: 'Buxgalteriya xizmatlari' },
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