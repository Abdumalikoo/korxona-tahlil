import { BadRequestException } from '@nestjs/common';
import { ENTRY_UNIT_CODES, entryUnitLabel } from './segments';

// ═══════════════════════════════════════════════════════════
// Har bir kiritish bo'limining (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari)
// o'z moddalar ro'yxati — daromad (xizmat turlari) va xarajat (moddalar) uchun alohida.
//  • Bo'lim uchun ro'yxat saqlanmagan bo'lsa — UMUMIY: hamma moddalar (keyin qo'shilganlari ham) ochiq.
//  • Ro'yxat saqlansa — faqat o'shalar (xarajatda ota modda belgilansa — uning ichidagi hamma moddalar).
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

/** Modda shu bo'lim ro'yxatidami (ro'yxat yo'q — umumiy, hammasi ochiq). Xarajatda ota modda ham hisobga olinadi */
export function unitAllows(list: string[] | undefined, code: string, parentOf?: (code: string) => string | null): boolean {
  if (!list) return true;
  const set = new Set(list);
  let cur: string | null = code;
  for (let depth = 0; cur && depth <= 20; depth += 1) {
    if (set.has(cur)) return true;
    cur = parentOf ? parentOf(cur) : null;
  }
  return false;
}

interface CategoryDb extends SettingDb {
  category: { findMany(args: { select: { code: true; parentCode: true; label: true } }): Promise<{ code: string; parentCode: string | null; label: string }[]> };
  incomeCategory: { findUnique(args: { where: { code: string }; select: { label: true } }): Promise<{ label: string } | null> };
}

/** Qo'lda kiritishda: modda tanlangan bo'limning moddalar ro'yxatida bo'lishi kerak */
export async function assertUnitCategory(db: CategoryDb, kind: EntryKind, unit: string | null, code: string): Promise<void> {
  if (!unit) return;
  const lists = await readUnitCategories(db);
  const list = lists[kind][unit];
  if (!list) return;
  if (kind === 'income') {
    if (list.includes(code)) return;
    const label = (await db.incomeCategory.findUnique({ where: { code }, select: { label: true } }))?.label ?? code;
    throw new BadRequestException(`«${label}» — «${entryUnitLabel(unit)}» bo'limining daromad turlari ro'yxatida yo'q. Ro'yxat: Daromadlar › ${entryUnitLabel(unit)} › Moddalar`);
  }
  const cats = await db.category.findMany({ select: { code: true, parentCode: true, label: true } });
  const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
  if (unitAllows(list, code, (c) => parent.get(c) ?? null)) return;
  const label = cats.find((c) => c.code === code)?.label ?? code;
  throw new BadRequestException(`«${label}» — «${entryUnitLabel(unit)}» bo'limining xarajat moddalari ro'yxatida yo'q. Ro'yxat: Xarajatlar › ${entryUnitLabel(unit)} › Moddalar`);
}