// ═══════════════════════════════════════════════════════════
// Bo'limlarning tarkibiy tuzilmalari (yorliqlar qatori).
// Har bo'lim alohida: o'z tuzilmalari. Tayyorlari (view) — o'z sahifasi; qolganlari hozircha tugma,
// yuklash tartibi va shabloni keyin birma-bir belgilanadi.
// Yangi tuzilma qo'shish: shu ro'yxatga bitta qator.
// ═══════════════════════════════════════════════════════════

import type { EntryKind } from './api';

export interface UnitTab {
  /** Manzil: /xarajatlar/bolim/<bo'lim>/<slug> */
  slug: string;
  label: string;
  /** Tayyor sahifa: payroll — ish haqi (shablon, vedomost, bo'lim xodimlari). Bo'lmasa — hali tugma */
  view?: 'payroll';
}

const EXPENSE: Record<string, UnitTab[]> = {
  TAX_FREE: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
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