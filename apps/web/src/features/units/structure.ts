// ═══════════════════════════════════════════════════════════
// Bo'limlarning tarkibiy tuzilmalari (yorliqlar qatori).
// Har bo'lim alohida: o'z tuzilmalari. Hozircha faqat tugmalar — har birining yuklash tartibi
// va shabloni keyin birma-bir belgilanadi.
// Yangi tuzilma qo'shish: shu ro'yxatga bitta qator.
// ═══════════════════════════════════════════════════════════

import type { EntryKind } from './api';

export interface UnitTab {
  /** Manzil: /xarajatlar/bolim/<bo'lim>/<slug> */
  slug: string;
  label: string;
}

const EXPENSE: Record<string, UnitTab[]> = {
  TAX_FREE: [
    { slug: 'ish-haqi', label: 'Ish haqi' },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi' },
    { slug: 'ijara-kommunal', label: 'Ijara va kommunal' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar' },
    { slug: 'bank', label: 'Bank xarajatlari' },
    { slug: 'reklama', label: 'Reklama xarajatlari' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar' },
  ],
};

const BY_KIND: Record<EntryKind, Record<string, UnitTab[]>> = { expense: EXPENSE, income: {} };

/** Bo'limning tuzilmalari (bo'lmasa — bo'sh ro'yxat) */
export function unitTabs(kind: EntryKind, unitCode: string): UnitTab[] {
  return BY_KIND[kind][unitCode] ?? [];
}