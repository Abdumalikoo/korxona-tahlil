'use client';

import type { SectionKind, SectionValue } from './api';

interface Props {
  kind: SectionKind;
  section: SectionValue;
}

/**
 * Avval bu yerda bo'lim ichidagi yorliqlar va Doimiy/Boshqa almashtirgich chizilardi.
 *
 * Endi hammasi bitta qatorda — yuqori panel tagidagi bo'lim yorliqlarida
 * (components/layout/section-bar.tsx): Umumiy · Doimiy · Boshqa · Ish haqi · … · Tahlil.
 * Sahifalar bu komponentni chaqirishda davom etadi — u hech narsa chizmaydi,
 * shuning uchun bir xil qator ikki marta ko'rinmaydi.
 */
export function SectionTabs(_props: Props) {
  return null;
}