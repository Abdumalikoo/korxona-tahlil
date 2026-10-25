import { BadRequestException } from '@nestjs/common';
import { Max } from 'class-validator';

// ═══════════════════════════════════════════════════════════
// Summaning yuqori chegarasi — bitta yozuv / qator uchun: 10 trillion so'm (10^15 tiyin).
// Maqsad: xato kiritilgan ulkan son (ortiqcha nollar) hisobotlarni buzmasin va bazadagi
// butun son chegarasidan (≈ 9,2 · 10^18) oshib, «ichki xato» bermasin.
// ═══════════════════════════════════════════════════════════

export const MAX_AMOUNT_TIYIN = 1_000_000_000_000_000n;
/** DTO (son) uchun — JavaScript'dagi xavfsiz butun son chegarasidan kichik */
export const MAX_AMOUNT_TIYIN_NUM = 1_000_000_000_000_000;

/** DTO maydoni: summa (tiyin) 10 trillion so'mdan oshmasin */
export const MaxAmount = () => Max(MAX_AMOUNT_TIYIN_NUM, { message: "Summa juda katta (10 trillion so'mdan oshmasin)" });

/** Tiyin chegarasi: oshsa — xato (label — qaysi qator / maydon) */
export function assertAmount(v: bigint, label = 'Summa'): bigint {
  if (v > MAX_AMOUNT_TIYIN || v < -MAX_AMOUNT_TIYIN) throw new BadRequestException(`${label}: summa juda katta (10 trillion so'mdan oshmasin)`);
  return v;
}