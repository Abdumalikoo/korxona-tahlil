'use client';

import { usePathname } from 'next/navigation';

// ═══════════════════════════════════════════════════════════
// Mashinalar sahifalari ikki joyda ochiladi:
//  • /mashinalar/…            — Omborchi (ishchi rol) zonasi;
//  • /xarajatlar/mashinalar/… — Xarajatlar bo'limi ichida (administrator, buxgalter, kuzatuvchi).
// Ichki havolalar qaysi joyda ochilgan bo'lsa, o'sha yerda qoladi.
// ═══════════════════════════════════════════════════════════

export const VEHICLES_IN_EXPENSES = '/xarajatlar/mashinalar';

/** Joriy asos: «/xarajatlar/mashinalar» yoki «/mashinalar» */
export function useVehicleBase(): string {
  const pathname = usePathname() ?? '';
  return pathname === VEHICLES_IN_EXPENSES || pathname.startsWith(`${VEHICLES_IN_EXPENSES}/`) ? VEHICLES_IN_EXPENSES : '/mashinalar';
}
