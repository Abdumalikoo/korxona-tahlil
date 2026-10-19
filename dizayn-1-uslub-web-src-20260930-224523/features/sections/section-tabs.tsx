'use client';

import type { SectionKind, SectionValue } from './api';

interface Props {
  kind: SectionKind;
  section: SectionValue;
}

/**
 * Bo'lim yorliqlari (Doimiy / Boshqa va ichidagilar) endi yuqoridagi navigatsiyada
 * doim ko'rinib turadi — sahifa ichida takrorlanmaydi.
 * Komponent eski sahifalar bilan moslik uchun qoldirildi.
 */
export function SectionTabs(props: Props) {
  void props;
  return null;
}