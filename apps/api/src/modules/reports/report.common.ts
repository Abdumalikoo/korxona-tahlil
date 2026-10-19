import type { Labels, Row } from './reports.data';
import { expenseGroup } from './report.financial';

// ═══════════════════════════════════════════════════════════
// Hisobotlar uchun umumiy hisob-kitoblar: birliklar bo'yicha yig'ma
// ═══════════════════════════════════════════════════════════

export interface UnitSum {
  income: number;
  expense: number;
  payroll: number;
  lease: number;
  vehicle: number;
  other: number;
}

export function emptySum(): UnitSum {
  return { income: 0, expense: 0, payroll: 0, lease: 0, vehicle: 0, other: 0 };
}

/** Birlik (hudud, Markaz, biriktirilmagan) bo'yicha daromad va xarajat tarkibi */
export function byUnit(incomes: Row[], expenses: Row[]): Map<string, UnitSum> {
  const map = new Map<string, UnitSum>();
  const get = (k: string) => {
    let x = map.get(k);
    if (!x) {
      x = emptySum();
      map.set(k, x);
    }
    return x;
  };
  for (const r of incomes) get(r.unit).income += r.amount;
  for (const r of expenses) {
    const x = get(r.unit);
    x.expense += r.amount;
    if (r.source === 'PAYROLL') x.payroll += r.amount;
    else if (r.source === 'LEASE') x.lease += r.amount;
    else if (r.source === 'VEHICLE') x.vehicle += r.amount;
    else x.other += r.amount;
  }
  return map;
}

export function sumBy(rows: Row[], key: (r: Row) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.amount);
  return m;
}

/** Xarajat guruhlari bo'yicha summa */
export function byExpenseGroup(expenses: Row[], labels: Labels): Map<string, { label: string; amount: number }> {
  const m = new Map<string, { label: string; amount: number }>();
  for (const r of expenses) {
    const g = expenseGroup(r, labels);
    const x = m.get(g.key) ?? { label: g.label, amount: 0 };
    x.amount += r.amount;
    m.set(g.key, x);
  }
  return m;
}

export const mln = (v: number) => Math.round((v / 1e6) * 10) / 10;

/** Birliklar tartibi: hududlar (nomi bo'yicha), Markaz, biriktirilmagan */
export function unitOrder(key: string): number {
  return key.startsWith('r:') ? 0 : key === 'center' ? 1 : 2;
}