'use client';

import { CashDaySheet } from '@/features/cashbook/day-sheet';

// Umumiy hudud: buxgalter kiritgan kunni ko'rish va (administrator) tuzatish
export default function Page() {
  return <CashDaySheet adminView />;
}