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

// ═══════════════════════════════════════════════════════════
// Kiritish bo'limlari — daromad va xarajat 6 bo'limda alohida yuritiladi
// (backend: ENTRY_UNITS — common/segments/segments.ts bilan bir xil kodlar)
// ═══════════════════════════════════════════════════════════

export interface EntryUnit {
  code: string;
  label: string;
  /** Manzil: /xarajatlar/bolim/<slug>, /daromadlar/bolim/<slug> */
  slug: string;
  hint: string;
}

export const ENTRY_UNITS: EntryUnit[] = [
  { code: 'CENTER', label: 'Markaz', slug: 'markaz', hint: "Markaz va uning bo'limlari" },
  { code: 'REGION', label: 'Hududlar', slug: 'hududlar', hint: 'Viloyatlar va tumanlar' },
  { code: 'TAX_FREE', label: 'Tax free', slug: 'tax-free', hint: 'Tax free xizmati' },
  { code: 'MARKSHEYDER', label: 'Marksheyder', slug: 'marksheyder', hint: 'Marksheyderlik ishlari' },
  { code: 'FERMER', label: "Fermer xo'jaligi", slug: 'fermer', hint: "Fermer xo'jaligi" },
  { code: 'BUXGALTERIYA', label: 'Buxgalteriya xizmatlari', slug: 'buxgalteriya', hint: 'Buxgalteriya xizmatlari' },
];

export function unitBySlug(slug: string | null | undefined): EntryUnit | null {
  return ENTRY_UNITS.find((u) => u.slug === slug) ?? null;
}

export function unitByCode(code: string | null | undefined): EntryUnit | null {
  return ENTRY_UNITS.find((u) => u.code === code) ?? null;
}

/** Yozuv qaysi kiritish bo'limiga tegishli (biriktirilmagan — null) */
export function entryUnitOf(r: { segment?: string | null; regionCode?: number | null; departmentId?: string | null }): string | null {
  if (r.segment && isSegment(r.segment)) return r.segment;
  if (r.regionCode === 0 || ((r.regionCode === null || r.regionCode === undefined) && r.departmentId)) return 'CENTER';
  if (r.regionCode !== null && r.regionCode !== undefined && r.regionCode > 0) return 'REGION';
  return null;
}

/**
 * Bo'lim ro'yxati bo'yicha moddalar: ro'yxat yo'q (null) — umumiy, hammasi; bor bo'lsa — o'zi yoki ota moddasi ro'yxatda.
 */
export function allowedByUnit<T extends { code: string; parentCode?: string | null }>(items: T[], list: string[] | null | undefined, parentOf?: Map<string, string | null>): T[] {
  if (!list) return items;
  const set = new Set(list);
  return items.filter((c) => {
    let cur: string | null | undefined = c.code;
    for (let depth = 0; cur && depth <= 20; depth += 1) {
      if (set.has(cur)) return true;
      cur = parentOf ? (parentOf.get(cur) ?? null) : (c.parentCode ?? null);
      if (!parentOf) break;
    }
    return false;
  });
}