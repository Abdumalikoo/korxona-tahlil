import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind klasslarini birlashtiradi va ziddiyatlarni hal qiladi.
 * cn('px-4', 'px-6') → 'px-6'  (oxirgisi yutadi)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
