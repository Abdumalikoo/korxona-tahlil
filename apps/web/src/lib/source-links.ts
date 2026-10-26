import { ENTRY_UNITS } from './segments';

// Manba sahifalariga havolalar — bir sahifadagi raqamdan uning manbasiga o'tish (oy bilan: ?period=YYYY-MM)

const q = (period?: string) => (period ? `?period=${period}` : '');

/** Bo'lim (Tax free …) ish haqi sahifasi */
export function unitPayrollHref(unit: string | null | undefined, period?: string): string | null {
  const u = ENTRY_UNITS.find((x) => x.code === unit);
  if (!u || u.code === 'CENTER' || u.code === 'REGION' || u.code === 'QOMITA') return null;
  return `/xarajatlar/bolim/${u.slug}/ish-haqi${q(period)}`;
}

export const sourceHref = {
  /** Umumiy soliq hisoboti (Xarajatlar › Ish haqi) */
  soliq: (period?: string) => `/xarajatlar/ish-haqi${q(period)}`,
  /** Ish haqi tarkibi */
  tarkib: (period?: string) => `/xarajatlar/tarkib${q(period)}`,
  /** 23106 bank ko'chirmasi */
  bank: (period?: string) => `/xarajatlar/23106${q(period)}`,
  /** Ish haqi solishtirma */
  solishtirma: (period?: string) => `/xarajatlar/ish-haqi-solishtirma${q(period)}`,
  /** Manba fayllar arxivi */
  files: () => '/sozlamalar/fayllar',
};
