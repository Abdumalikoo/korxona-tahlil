import { BadRequestException } from '@nestjs/common';

// ═══════════════════════════════════════════════════════════
// Oylar (davr) bilan ishlash — umumiy yordamchilar. Davr ko'rinishi: «YYYY-MM».
// Avval har modulda alohida nusxa edi (va modullar bir-biridan import qilardi);
// endi bitta joyda. Xatti-harakati avvalgi nusxalar bilan aynan bir xil (test/t-common-helpers.js).
// ═══════════════════════════════════════════════════════════

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
/** Bir tanlovda ko'pi bilan shuncha oy (bo'lim sahifalari: ijara, kiritish, bank, ish haqi) */
export const MAX_RANGE_MONTHS = 24;

/** «2026-03» → «Mart 2026» */
export const monthLabel = (p: string) => `${MONTHS_UZ[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

/**
 * from..to (ikkalasi ham kiradi), qat'iy: noto'g'ri format, teskari tartib yoki 24 oydan ko'p — foydalanuvchiga xato.
 * (Avval unit-lease.service'dagi monthsBetween.)
 */
export function monthsBetween(from: string, to: string): string[] {
  if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oylar oralig'i noto'g'ri (YYYY-MM)");
  if (from > to) throw new BadRequestException("Boshlanish oyi tugash oyidan keyin bo'lmasin");
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (;;) {
    const p = `${y}-${String(m).padStart(2, '0')}`;
    out.push(p);
    if (p === to) break;
    if (out.length > MAX_RANGE_MONTHS) throw new BadRequestException(`Ko'pi bilan ${MAX_RANGE_MONTHS} oy tanlang`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * from..to (ikkalasi ham kiradi), yumshoq: xato bermaydi, noto'g'ri yoki teskari oraliq — bo'sh ro'yxat,
 * ko'pi bilan `limit` ta oy (ortig'i tashlanadi).
 */
export function monthSpan(from: string, to: string, limit: number): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (out.length < limit && (y < ty || (y === ty && m <= tm))) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}