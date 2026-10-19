import { formatDate, formatTiyin } from '@/lib/format';
import type { ItemFilter, ItemKind, MarkItem } from './api';

// ═══════════════════════════════════════════════════════════
// Hamma detal uchun belgilanadigan moddalar (backend filtrlari bilan bir xil):
// yozuv, mijoz, kontragent, xizmat turi / modda, tuman, tuman xizmati, xodim, mashina, ijara shartnomasi.
// ═══════════════════════════════════════════════════════════

type Section = 'ALL' | 'DOIMIY' | 'BOSHQA' | null | undefined;

const KIND_WORD: Record<ItemKind, string> = { INCOME: 'daromad', EXPENSE: 'xarajat', RESULT: 'natija' };

function withSection(filter: ItemFilter, section: Section): ItemFilter {
  return section === 'DOIMIY' || section === 'BOSHQA' ? { ...filter, section } : filter;
}

function sectionSuffix(section: Section): string {
  return section === 'DOIMIY' ? ' (Doimiy)' : section === 'BOSHQA' ? ' (Boshqa)' : '';
}

/** Tuman kaliti backend tekshiruvidan o'tadimi ("3-1"); "-" — tumanga bo'linmagan */
export function isDistrictKey(id: string | null | undefined): id is string {
  return Boolean(id && /^\d{1,3}-\d{1,4}$/.test(id));
}

// ─────────── Yozuvlar ───────────

/** Bitta daromad yoki xarajat yozuvi */
export function recordMark(
  side: 'INCOME' | 'EXPENSE',
  record: { id: string; date: string; amountTiyin: string; category?: { label: string } | null },
  origin: string,
): MarkItem {
  const what = record.category?.label ?? (side === 'INCOME' ? 'Daromad' : 'Xarajat');
  return {
    kind: side,
    label: `Yozuv: ${formatDate(record.date)} · ${what} · ${formatTiyin(record.amountTiyin, { currency: true })}`,
    filter: { recordId: record.id },
    origin,
  };
}

/** Mijoz — uning barcha daromadlari */
export function clientMark(name: string | null | undefined, origin: string): MarkItem | null {
  const value = name?.trim();
  if (!value) return null;
  return { kind: 'INCOME', label: `Mijoz: ${value}`, filter: { clientName: value }, origin };
}

/** Kontragent — unga qilingan barcha xarajatlar */
export function counterpartyMark(name: string | null | undefined, origin: string): MarkItem | null {
  const value = name?.trim();
  if (!value) return null;
  return { kind: 'EXPENSE', label: `Kontragent: ${value}`, filter: { counterparty: value }, origin };
}

/** Xizmat turi (daromad) yoki modda (xarajat) — kod bo'yicha */
export function categoryMark(side: 'INCOME' | 'EXPENSE', code: string, label: string, origin: string, section?: Section): MarkItem {
  return {
    kind: side,
    label: `${side === 'INCOME' ? 'Xizmat turi' : 'Modda'}: ${label}${sectionSuffix(section)}`,
    filter: withSection({ categoryCode: code }, section),
    origin,
  };
}

// ─────────── Tumanlar ───────────

/** Tuman: daromad / xarajat (ish haqi bilan) / natija */
export function districtMark(id: string, name: string, kind: ItemKind, section: Section, origin = 'Solishtirma › tuman'): MarkItem | null {
  if (!isDistrictKey(id)) return null;
  return { kind, label: `${name} · ${KIND_WORD[kind]}${sectionSuffix(section)}`, filter: withSection({ districtId: id }, section), origin };
}

/** Tumandagi bitta xizmat turi daromadi */
export function districtServiceMark(id: string, name: string, service: { code: string; label: string }, section: Section): MarkItem | null {
  if (!isDistrictKey(id)) return null;
  return {
    kind: 'INCOME',
    label: `${name} · ${service.label}${sectionSuffix(section)}`,
    filter: withSection({ districtId: id, categoryCode: service.code }, section),
    origin: 'Solishtirma › tuman xizmatlari',
  };
}

/** Tuman xarajatining bir qismi: ish haqi, ijara, mashinalar yoki modda guruhi */
export function districtPartMark(id: string, name: string, part: { key: string; label: string }, section: Section): MarkItem | null {
  if (!isDistrictKey(id)) return null;
  const filter: ItemFilter = { districtId: id };
  if (part.key === 'PAYROLL' || part.key === 'LEASE' || part.key === 'VEHICLE') filter.source = part.key;
  else if (part.key.startsWith('c:')) filter.rootCategoryCode = part.key.slice(2);
  else return null;
  return { kind: 'EXPENSE', label: `${name} · ${part.label}${sectionSuffix(section)}`, filter: withSection(filter, section), origin: 'Solishtirma › tuman xarajati' };
}

// ─────────── Markaz va uning bo'limlari ───────────

/** Bo'lim kaliti ("-" — bo'limga biriktirilmagan, belgilanmaydi) */
function isDepartmentKey(id: string | null | undefined): id is string {
  return Boolean(id && id !== '-' && id.length <= 80);
}

/** Markaz butun: daromad / xarajat (o'z + hududlar uchun) / natija — Solishtirmadagidek */
export function centerMark(name: string, kind: ItemKind, section: Section, origin = 'Solishtirma › Markaz'): MarkItem {
  return { kind, label: `${name} · ${KIND_WORD[kind]}${sectionSuffix(section)}`, filter: withSection({ unit: 'center' }, section), origin };
}

/**
 * Markaz daromadi yoki xarajatining bir qismi.
 * side INCOME — daromad turi (kod); EXPENSE — ish haqi/ijara/mashinalar, «c:modda» guruhi yoki hududlar uchun to'langan modda (kod).
 */
export function centerPartMark(side: 'INCOME' | 'EXPENSE', part: { key: string; label: string }, section: Section, regional = false): MarkItem | null {
  if (!part.key || part.key === 'rest') return null;
  const filter: ItemFilter = { unit: 'center' };
  if (side === 'INCOME' || regional) filter.categoryCode = part.key;
  else if (part.key === 'PAYROLL' || part.key === 'LEASE' || part.key === 'VEHICLE') filter.source = part.key;
  else if (part.key.startsWith('c:')) filter.rootCategoryCode = part.key.slice(2);
  else return null;
  const prefix = side === 'INCOME' ? 'Markaz daromadi' : regional ? "Markaz · hududlar uchun" : 'Markaz xarajati';
  return { kind: side, label: `${prefix}: ${part.label}${sectionSuffix(section)}`, filter: withSection(filter, section), origin: 'Solishtirma › Markaz' };
}

/** Markaz bo'limi: xarajati (ish haqi bilan) yoki natijasi */
export function departmentMark(id: string, name: string, kind: ItemKind, section: Section): MarkItem | null {
  if (!isDepartmentKey(id)) return null;
  return { kind, label: `Markaz › ${name} · ${KIND_WORD[kind]}${sectionSuffix(section)}`, filter: withSection({ unit: 'center', departmentId: id }, section), origin: "Solishtirma › Markaz bo'limi" };
}

/** Bo'lim xarajatining bir qismi: ish haqi, ijara, mashinalar yoki modda guruhi */
export function departmentPartMark(id: string, name: string, part: { key: string; label: string }, section: Section): MarkItem | null {
  if (!isDepartmentKey(id)) return null;
  const filter: ItemFilter = { unit: 'center', departmentId: id };
  if (part.key === 'PAYROLL' || part.key === 'LEASE' || part.key === 'VEHICLE') filter.source = part.key;
  else if (part.key.startsWith('c:')) filter.rootCategoryCode = part.key.slice(2);
  else return null;
  return { kind: 'EXPENSE', label: `Markaz › ${name} · ${part.label}${sectionSuffix(section)}`, filter: withSection(filter, section), origin: "Solishtirma › Markaz bo'limi" };
}

// ─────────── Xodim, mashina, ijara ───────────

/**
 * Xodim: EXPENSE — olgan ish haqi, INCOME — Natijalar fakti, RESULT — fakt − ish haqi.
 * PINFL 14 xonali bo'lmasa — belgilanmaydi.
 */
export function employeeMark(pinfl: string, fullName: string, kind: ItemKind, origin = 'Xodim'): MarkItem | null {
  if (!/^\d{14}$/.test(pinfl)) return null;
  const what = kind === 'EXPENSE' ? 'ish haqi' : kind === 'INCOME' ? 'natija (fakt)' : 'natija − ish haqi';
  return { kind, label: `${fullName} · ${what}`, filter: { employeePinfl: pinfl }, origin };
}

/** Mashina — unga yozilgan barcha xarajatlar (yoqilg'i, ta'mir...) */
export function vehicleMark(vehicle: { id: string; plateNumber: string; model?: string | null }, origin = 'Mashinalar'): MarkItem {
  return {
    kind: 'EXPENSE',
    label: `Mashina: ${vehicle.plateNumber}${vehicle.model ? ` · ${vehicle.model}` : ''}`,
    filter: { vehicleId: vehicle.id },
    origin,
  };
}

/** Ijara shartnomasi — hisoblangan ijara xarajatlari */
export function leaseMark(lease: { id: string; number?: string | null; title: string }, origin = 'Ijara'): MarkItem {
  return {
    kind: 'EXPENSE',
    label: `Ijara: ${lease.title}${lease.number ? ` (№ ${lease.number})` : ''}`,
    filter: { leaseId: lease.id },
    origin,
  };
}

/** null larni tashlab, takrorlarni olib tashlaydi */
export function compactMarks(items: (MarkItem | null | undefined | false)[]): MarkItem[] {
  const seen = new Set<string>();
  const out: MarkItem[] = [];
  for (const item of items) {
    if (!item) continue;
    const key = `${item.kind}|${JSON.stringify(Object.entries(item.filter).sort())}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}