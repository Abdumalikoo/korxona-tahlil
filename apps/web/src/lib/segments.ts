// ═══════════════════════════════════════════════════════════
// Yo'nalishlar — Markaz va hududlardan tashqari alohida birliklar
// (backend: apps/api/src/common/segments/segments.ts bilan BIR XIL ro'yxat).
// ═══════════════════════════════════════════════════════════

export const SEGMENTS = [
  { code: 'TAX_FREE', label: 'Tax free', hint: 'Tax free xizmati' },
  { code: 'MARKSHEYDER', label: 'Marksheyder', hint: 'Marksheyderlik ishlari' },
  { code: 'FERMER', label: "Fermer xo'jaligi", hint: "Fermer xo'jaligi" },
  { code: 'BUXGALTERIYA', label: 'Buxgalteriya xizmatlari', hint: 'Buxgalteriya xizmatlari' },
] as const;

export type SegmentCode = (typeof SEGMENTS)[number]['code'];

export function segmentLabel(code: string | null | undefined): string {
  return SEGMENTS.find((s) => s.code === code)?.label ?? String(code ?? '');
}

export function isSegment(code: unknown): code is SegmentCode {
  return typeof code === 'string' && SEGMENTS.some((s) => s.code === code);
}

/** Yozuv qayerga tegishli — matn: «Markaz › Bo'lim», «Andijon › Asaka», «Tax free» yoki null (biriktirilmagan) */
export function placeText(r: { segment?: string | null; regionCode?: number | null; department?: { name: string } | null; region?: { name: string } | null; district?: { name: string } | null }): string | null {
  if (r.segment) return segmentLabel(r.segment);
  if (r.regionCode === 0 || ((r.regionCode === null || r.regionCode === undefined) && r.department)) return `Markaz${r.department ? ` › ${r.department.name}` : ''}`;
  if (r.region) return `${r.region.name}${r.district ? ` › ${r.district.name}` : ''}`;
  return null;
}