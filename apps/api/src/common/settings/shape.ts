import { InternalServerErrorException, Logger } from '@nestjs/common';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════
// settings jadvalidagi JSON bloklar uchun tuzilma tekshiruvi (zod).
//
// Maqsad — jim ma'lumot yo'qolishining oldini olish: blok kutilgan ko'rinishda bo'lmasa
// (masalan obyekt o'rniga massiv yoki buzilgan qiymat), kod uni «bo'sh» deb o'qib, ustidan yozib yuborardi.
// Endi bunday holda amal TO'XTAYDI va xato beriladi — bazadagi qiymat o'zgarmaydi.
// Sxemalar faqat tashqi tuzilmani tekshiradi (ichki maydonlar avvalgidek yumshoq o'qiladi).
// Logga kalit nomi va buzilgan joy yoziladi — qiymatning o'zi (shaxsiy ma'lumot) yozilmaydi.
// ═══════════════════════════════════════════════════════════

const logger = new Logger('SettingShape');

/** Kalit → obyekt (bo'lim kodlari bo'yicha bloklar: unit.staff, unit.staffLink …) */
export const ObjectMap = z.record(z.string(), z.unknown());
/** { <maydon>: [...] } ko'rinishidagi ro'yxat bloklari */
export const listBlock = (field: string) => z.object({ [field]: z.array(z.unknown()) }).passthrough();

export class SettingShapeError extends InternalServerErrorException {
  constructor(key: string) {
    super(`«${key}» sozlamasi kutilgan ko'rinishda emas — amal to'xtatildi, bazadagi ma'lumot o'zgartirilmadi. Administratorga xabar bering`);
  }
}

/** null/undefined — null (blok hali yo'q); boshqa qiymat sxemaga mos bo'lmasa — xato */
export function shapeOf<S extends z.ZodTypeAny>(key: string, raw: unknown, schema: S): z.infer<S> | null {
  if (raw === null || raw === undefined) return null;
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const where = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(ildiz)'}: ${i.code}`)
    .join('; ');
  logger.error(`«${key}» sozlamasi buzilgan (${Array.isArray(raw) ? 'massiv' : typeof raw}) — ${where}`);
  throw new SettingShapeError(key);
}