import { BadRequestException } from '@nestjs/common';
import { ENTRY_UNIT_CODES, entryUnitLabel } from './segments';

// ═══════════════════════════════════════════════════════════
// Har bir kiritish bo'limi (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) —
// ALOHIDA hudud: o'z xarajat moddalari va o'z daromad turlari bilan. Umumiy ro'yxatdan meros yo'q.
//  • Ro'yxat bo'sh bo'lsa — cheklov yo'q (kiritish to'xtamaydi).
//  • Ro'yxat to'ldirilgan bo'lsa — kiritishda (qo'lda) faqat undagi moddalar qabul qilinadi.
//  • Avtomatik yozuvlar (ish haqi, ijara, ombor, soliqlar, fayldan yuklash) bu tekshiruvdan o'tmaydi.
// Saqlanadi: settings jadvali, kalit «unit.categories» — bazaga migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const UNIT_CATEGORIES_KEY = 'unit.categories';

export type EntryKind = 'expense' | 'income';

export interface UnitCategoriesValue {
  expense: Record<string, string[]>;
  income: Record<string, string[]>;
}

interface SettingDb {
  setting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
}

function clean(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [unit, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENTRY_UNIT_CODES.includes(unit) || !Array.isArray(list)) continue;
    out[unit] = [...new Set(list.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 64))];
  }
  return out;
}

export async function readUnitCategories(db: SettingDb): Promise<UnitCategoriesValue> {
  const row = await db.setting.findUnique({ where: { key: UNIT_CATEGORIES_KEY } }).catch(() => null);
  const v = (row?.value ?? {}) as Partial<Record<EntryKind, unknown>>;
  return { expense: clean(v.expense), income: clean(v.income) };
}

/** Bo'lim ro'yxati (saqlanmagan — bo'sh) */
export function unitList(value: UnitCategoriesValue, kind: EntryKind, unit: string): string[] {
  return value[kind][unit] ?? [];
}

interface CategoryDb extends SettingDb {
  category: { findUnique(args: { where: { code: string }; select: { label: true } }): Promise<{ label: string } | null> };
  incomeCategory: { findUnique(args: { where: { code: string }; select: { label: true } }): Promise<{ label: string } | null> };
}

/** Qo'lda kiritishda: modda tanlangan bo'limning o'z ro'yxatida bo'lishi kerak */
export async function assertUnitCategory(db: CategoryDb, kind: EntryKind, unit: string | null, code: string): Promise<void> {
  if (!unit) return;
  const list = unitList(await readUnitCategories(db), kind, unit);
  // Bo'sh ro'yxat — cheklov yo'q; ro'yxat to'ldirilgan bo'lsagina faqat undagi moddalar
  if (!list.length || list.includes(code)) return;
  const where = `${kind === 'expense' ? 'Xarajatlar' : 'Daromadlar'} › ${entryUnitLabel(unit)} › ${kind === 'expense' ? 'Moddalar' : 'Xizmat turlari'}`;
  const label = (kind === 'expense' ? await db.category.findUnique({ where: { code }, select: { label: true } }) : await db.incomeCategory.findUnique({ where: { code }, select: { label: true } }))?.label ?? code;
  throw new BadRequestException(`«${label}» — «${entryUnitLabel(unit)}» bo'limining ro'yxatida yo'q. Qo'shish: ${where}`);
}