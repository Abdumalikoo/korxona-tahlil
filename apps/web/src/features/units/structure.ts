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
   * entries — qo'lda kiritish jadvali (entryKind: ASSET — asosiy vositalar, AD — reklama, OTHER — boshqa);
   * policy — bo'lim xarajatlari siyosati (modda qaysi bo'lim hisobida) — har 6 bo'limda.
   * Bo'lmasa — hali tugma.
   */
  view?: 'payroll' | 'composition' | 'lease' | 'bank' | 'entries' | 'policy';
  entryKind?: EntryKindCode;
  /** payroll: soliq hisobotining o'zi (4 va 5-ilova) yuklanadi */
  ndfl?: boolean;
}

const EXPENSE: Record<string, UnitTab[]> = {
  TAX_FREE: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
    { slug: 'soliq-hisoboti', label: 'Soliq hisoboti', view: 'payroll', ndfl: true },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi', view: 'composition' },
    { slug: 'ijara-kommunal', label: 'Ijara va kommunal', view: 'lease' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar', view: 'entries', entryKind: 'ASSET' },
    { slug: 'bank', label: 'Bank xarajatlari', view: 'bank' },
    { slug: 'reklama', label: 'Reklama xarajatlari', view: 'entries', entryKind: 'AD' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar', view: 'entries', entryKind: 'OTHER' },
  ],
  FERMER: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
    { slug: 'soliq-hisoboti', label: 'Soliq hisoboti', view: 'payroll', ndfl: true },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi', view: 'composition' },
    { slug: 'ijara-internet', label: 'Ijara va internet', view: 'lease' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar', view: 'entries', entryKind: 'ASSET' },
    { slug: 'tmz', label: 'TMZ', view: 'entries', entryKind: 'TMZ' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar', view: 'entries', entryKind: 'OTHER' },
  ],
  BUXGALTERIYA: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
    { slug: 'soliq-hisoboti', label: 'Soliq hisoboti', view: 'payroll', ndfl: true },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi', view: 'composition' },
    { slug: 'reklama', label: 'Reklama xarajatlari', view: 'entries', entryKind: 'AD' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar', view: 'entries', entryKind: 'ASSET' },
    { slug: 'tmz', label: 'TMZ', view: 'entries', entryKind: 'TMZ' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar', view: 'entries', entryKind: 'OTHER' },
  ],
  MARKSHEYDER: [
    { slug: 'ish-haqi', label: 'Ish haqi', view: 'payroll' },
    { slug: 'soliq-hisoboti', label: 'Soliq hisoboti', view: 'payroll', ndfl: true },
    { slug: 'ish-haqi-tarkibi', label: 'Ish haqi tarkibi', view: 'composition' },
    // Hozircha tugma — yuklash tartibi va shabloni keyin belgilanadi
    { slug: 'xizmat-safari', label: 'Xizmat safari' },
    { slug: 'asosiy-vositalar', label: 'Asosiy vositalar' },
    { slug: 'mashina', label: 'Mashina xarajatlari' },
    { slug: 'boshqa', label: 'Boshqa xarajatlar' },
  ],
};

const BY_KIND: Record<EntryKind, Record<string, UnitTab[]>> = { expense: EXPENSE, income: {} };

/** Har bo'lim xarajatlarida — oxirgi tugma */
const POLICY_TAB: UnitTab = { slug: 'siyosat', label: 'Xarajatlar siyosati', view: 'policy' };

/** Bo'limning tuzilmalari (xarajatlarda — oxirida «Xarajatlar siyosati») */
export function unitTabs(kind: EntryKind, unitCode: string): UnitTab[] {
  return [...(BY_KIND[kind][unitCode] ?? []), ...(kind === 'expense' ? [POLICY_TAB] : [])];
}