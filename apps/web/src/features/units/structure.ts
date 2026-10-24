// ═══════════════════════════════════════════════════════════
// Bo'limlarning tarkibiy tuzilmalari (yorliqlar qatori).
// Har bo'lim alohida: o'z tuzilmalari. Tayyorlari (view) — o'z sahifasi; qolganlari hozircha tugma,
// yuklash tartibi va shabloni keyin birma-bir belgilanadi.
// Yangi tuzilma qo'shish: shu ro'yxatga bitta qator.
// ═══════════════════════════════════════════════════════════

import type { EntryKindCode } from '@/features/unit-entries/api';
import type { EntryKind } from './api';

export interface UnitTab {
  /** Manzil: /xarajatlar/bolim/<bo'lim>/<slug> */
  slug: string;
  label: string;
  /**
   * Tayyor sahifa: payroll — ish haqi (shablon, vedomost, bo'lim xodimlari); composition — ish haqi tarkibi;
   * lease — ijara va kommunal (filiallar kesimida, oylar oralig'i); bank — bank xarajatlari (ko'chirma shaklida);
   * entries — qo'lda kiritish jadvali (entryKind: ASSET — asosiy vositalar, AD — reklama, OTHER — boshqa).
   * Bo'lmasa — hali tugma.
   */
  view?: 'payroll' | 'composition' | 'lease' | 'bank' | 'entries';
  entryKind?: EntryKindCode;
}

const EXPENSE: Record<string, UnitTab[]> = {
  TAX_FREE: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi', view: 'composition' },
    { slug: 'ijara-kommunal', label: 'Ijara va kommunal', view: 'lease' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar', view: 'entries', entryKind: 'ASSET' },
    { slug: 'bank', label: 'Bank xarajatlari', view: 'bank' },
    { slug: 'reklama', label: 'Reklama xarajatlari', view: 'entries', entryKind: 'AD' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar', view: 'entries', entryKind: 'OTHER' },
  ],
};

const BY_KIND: Record<EntryKind, Record<string, UnitTab[]>> = { expense: EXPENSE, income: {} };

/** Bo'limning tuzilmalari (bo'lmasa — bo'sh ro'yxat) */
export function unitTabs(kind: EntryKind, unitCode: string): UnitTab[] {
  return BY_KIND[kind][unitCode] ?? [];
}