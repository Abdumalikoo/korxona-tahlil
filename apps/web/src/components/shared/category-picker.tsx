'use client';

import { ModdaPicker, useExpenseGroups } from '@/components/shared/modda-picker';
import type { Category } from '@/lib/types';
import { useMemo } from 'react';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Royxat pastida yangi kategoriya qoshish tugmasi (forma o'z dialogini ochadi) */
  onCreateNew?: (query: string) => void;
  /** Yoki — ichki dialog bilan yangi modda; yaratilgach chaqiriladi (ro'yxatni qayta yuklash uchun) */
  onCreated?: (category: Category) => void | Promise<void>;
}

/**
 * Kategoriya tanlagich (to'liq Category ro'yxati bilan).
 *
 * Faol barg kategoriyalar ota-kategoriya bo'yicha guruhlanadi;
 * qidiruv, «+» va yangi modda — ModdaPicker'da.
 */
export function CategoryPicker({ categories, placeholder = 'Kategoriya tanlang', ...rest }: CategoryPickerProps) {
  // Ro'yxatda ota-moddalar bo'lmasa (faqat barglar) — guruh nomi daraxtdan olinadi
  const tree = useExpenseGroups();
  const options = useMemo(() => {
    const parentLabels = new Map(categories.filter((c) => !c.isLeaf).map((c) => [c.code, c.label]));
    const groupOf = (code: string | null) => (code ? (parentLabels.get(code) ?? tree?.labels.get(code) ?? null) : null);
    return categories.filter((c) => c.isLeaf && c.isActive).map((c) => ({ code: c.code, label: c.label, group: groupOf(c.parentCode), keywords: c.keywords }));
  }, [categories, tree]);

  return <ModdaPicker options={options} placeholder={placeholder} {...rest} />;
}
