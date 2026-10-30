import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind klasslarini birlashtiradi va ziddiyatlarni hal qiladi.
 * cn('px-4', 'px-6') → 'px-6'  (oxirgisi yutadi)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Matnning birinchi harfi — katta («o'tgan davr» → «O'tgan davr») */
export function cap(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
