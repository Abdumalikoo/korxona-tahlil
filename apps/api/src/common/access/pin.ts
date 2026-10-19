import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// PIN qoidalari: 6 ta raqam; oson topiladigan PIN'lar qabul qilinmaydi
// (111111, 123456, 654321, 121212, 112233 kabi).
// ═══════════════════════════════════════════════════════════

export const PIN_LENGTH = 6;

/** Oson topiladigan bo'lsa — sababini qaytaradi, aks holda null */
export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'PIN 6 ta raqamdan iborat bo‘lishi kerak';
  const d = pin.split('').map(Number);
  if (d.every((x) => x === d[0])) return 'Bir xil raqamlardan iborat PIN oson topiladi';
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Ketma-ket raqamlar (123456, 654321) oson topiladi';
  if (pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin) return 'Takrorlanuvchi PIN (121212, 123123) oson topiladi';
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5] && d[2] === d[0]! + 1 && d[4] === d[2]! + 1) return 'Bunday PIN (112233) oson topiladi';
  return null;
}

export function assertPin(pin: unknown): string {
  const value = typeof pin === 'string' ? pin.trim() : '';
  const reason = weakPinReason(value);
  if (reason) throw new BadRequestException(reason);
  return value;
}

/** Tasodifiy, qoidalarga mos PIN */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(PIN_LENGTH, '0');
    if (!weakPinReason(pin)) return pin;
  }
}