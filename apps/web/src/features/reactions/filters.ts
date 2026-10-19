import type { ItemFilter, ItemKind, MarkItem } from './api';

// ═══════════════════════════════════════════════════════════
// Tarkib (daromad/xarajat) tugunlari → Munosabat filtri.
// Filtr bilan ifodalab bo'lmaydigan tugunlar (masalan, alohida xodim) belgilanmaydi.
// ═══════════════════════════════════════════════════════════

/** Bitta tugun kalitini filtrga qo'shadi; mos kelmasa — false */
function applyKey(filter: ItemFilter, key: string): boolean {
  if (key === 'DOIMIY' || key === 'BOSHQA') {
    filter.section = key;
    return true;
  }
  if (key === 'm:PAYROLL') return (filter.source = 'PAYROLL'), true;
  if (key === 'm:LEASE') return (filter.source = 'LEASE'), true;
  if (key === 'm:VEHICLE') return (filter.source = 'VEHICLE'), true;
  if (key === 'REGIONAL') return (filter.source = 'IMPORT'), true;
  if (key.startsWith('c:')) {
    filter.rootCategoryCode = key.slice(2);
    return true;
  }
  if (key.startsWith('k:')) {
    filter.categoryCode = key.slice(2);
    delete filter.rootCategoryCode;
    return true;
  }
  if (key.startsWith('d:')) {
    filter.departmentId = key.slice(2);
    return true;
  }
  if (key === 'r:0') return (filter.unit = 'center'), true;
  if (/^r:\d+$/.test(key)) return (filter.unit = key), true;
  if (key === 'none') return (filter.unit = 'none'), true;
  if (key.startsWith('v:') && key !== 'v:none') {
    filter.vehicleId = key.slice(2);
    return true;
  }
  return false;
}

/** Tarkib yo'li + tugun → belgilanadigan modda (yoki null) */
export function structureMark(
  kind: 'income' | 'expense',
  section: 'ALL' | 'DOIMIY' | 'BOSHQA',
  path: { key: string; label: string }[],
  node: { key: string; label: string },
  origin: string,
): MarkItem | null {
  const filter: ItemFilter = {};
  if (section !== 'ALL') filter.section = section;
  for (const step of [...path, node]) {
    if (!applyKey(filter, step.key)) return null;
  }
  const itemKind: ItemKind = kind === 'income' ? 'INCOME' : 'EXPENSE';
  const label = [...path.map((p) => p.label), node.label].join(' · ');
  return { kind: itemKind, label: label || node.label, filter, origin };
}

/** Butun daraja (yo'l) — masalan, "Doimiy · IT" ning hammasi */
export function structurePathMark(
  kind: 'income' | 'expense',
  section: 'ALL' | 'DOIMIY' | 'BOSHQA',
  path: { key: string; label: string }[],
  rootLabel: string,
  origin: string,
): MarkItem | null {
  const filter: ItemFilter = {};
  if (section !== 'ALL') filter.section = section;
  for (const step of path) {
    if (!applyKey(filter, step.key)) return null;
  }
  return {
    kind: kind === 'income' ? 'INCOME' : 'EXPENSE',
    label: path.length ? path.map((p) => p.label).join(' · ') : rootLabel,
    filter,
    origin,
  };
}