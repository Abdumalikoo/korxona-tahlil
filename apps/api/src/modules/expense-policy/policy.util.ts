import type { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Xarajatlar siyosati — qaysi moddalar MARKAZ hisobidan (hudud xodimlari uchun bo'lsa ham).
//
// Masalan: hudud xodimlariga bayram puli, choraklik mukofot, xizmat safari (komandirovka), internet to'lovlari —
// qayerda yozilgan bo'lishidan qat'i nazar, Markaz xarajatiga o'tadi. Markaz xarajati guruhlari:
//   1) Joriy xarajatlar — Markazning o'z xarajatlari va hududlar uchun to'laganlari (siyosatdagi moddalar);
//   2) Asosiy vositalar — xarid xarajatga birdaniga yozilmaydi (balansda turadi), har oy sarfi (eskirish) yoziladi.
// Siyosat «settings» jadvalida saqlanadi (kalit: expense.policy) — bazaga migratsiya kerak emas.
// Ota modda belgilansa — uning hamma ichki moddalari ham kiradi.
//
// Ish haqi: hudud xodimining oyligi (sof — bayram va choraklik pullarsiz) hududga yoziladi; ish haqi tarkibidagi
// bayram, choraklik va siyosatda belgilangan boshqa komponentlar alohida xarajat bo'lib Markaz hisobiga o'tadi.
// ═══════════════════════════════════════════════════════════

export const POLICY_KEY = 'expense.policy';

/** «Hudud xodimlari uchun (Markaz hisobidan)» guruhi */
export const CENTER_PARENT = { code: 'HM_HUDUD', label: 'Hudud xodimlari uchun (Markaz hisobidan)' };

/** Ish haqi tarkibidan Markazga o'tadigan komponentlar → xarajat moddasi */
export const PAYROLL_CENTER_CATEGORY: Record<string, { code: string; label: string }> = {
  BAYRAM: { code: 'HM_BAYRAM', label: 'Bayram pullari' },
  CHORAK: { code: 'HM_CHORAK', label: 'Choraklik mukofot' },
};
/** Boshqa tanlangan komponentlar uchun umumiy modda */
export const PAYROLL_CENTER_OTHER = { code: 'HM_IH_QOSHIMCHA', label: "Ish haqi qo'shimchalari (Markaz hisobidan)" };
/** Standart: bayram va choraklik pullar */
export const DEFAULT_PAYROLL_COMPONENTS = ['BAYRAM', 'CHORAK'];

/** Asosiy vositalar sarfi (eskirish) — har oy avtomatik yoziladi */
export const ASSET_CHARGE_CATEGORY = { code: 'AV_SARF', label: 'Asosiy vositalar sarfi (eskirish)' };
/** «Xarajatga o'tkazish» rejimidagi asosiy vositalar — qiymati to'liq xarajatga (har doim Markaz hisobidan) */
export const ASSET_EXPENSE_CATEGORY = { code: 'AV_XARAJAT', label: "Asosiy vositalar (xarajatga o'tkazilgan)" };
/** Excel'dan yuklangan (xodimlarga berilgan) inventar — vosita moddasi (xizmat muddati shu bo'yicha) */
export const ASSET_INVENTORY_CATEGORY = { code: 'AV_INVENTAR', label: 'Inventar (xodimlarga berilgan)' };
/** Markaz xarajatining 2-guruhi «Asosiy vositalar»ga kiradigan moddalar */
export const ASSET_GROUP_CODES: string[] = [ASSET_CHARGE_CATEGORY.code, ASSET_EXPENSE_CATEGORY.code];

/** Har doim Markaz hisobidagi moddalar (siyosatdan olib tashlab bo'lmaydi) */
export const ALWAYS_CENTER: string[] = [
  ...Object.values(PAYROLL_CENTER_CATEGORY).map((c) => c.code),
  PAYROLL_CENTER_OTHER.code,
  ASSET_CHARGE_CATEGORY.code,
  ASSET_EXPENSE_CATEGORY.code,
];

/** Soliq turlari hali saqlanmagan bo'lsa — standart: QQS va foyda solig'i Markaz hisobidan */
const TAX_CENTER_DEFAULT = ['SOLIQ_QQS', 'SOLIQ_FOYDA'];

export interface PolicyValue {
  /** Markaz hisobidagi moddalar (ota modda bo'lsa — ichkilari ham); har doimgilar qo'shilgan */
  centerCategories: string[];
  /** Foydalanuvchi belgilagan (har doimgilarsiz) */
  chosenCategories: string[];
  /** Ish haqi tarkibidan Markazga o'tadigan komponentlar kodi */
  payrollComponents: string[];
}

/** Bazadan siyosat (yo'q bo'lsa — standart) */
export async function readPolicy(prisma: PrismaService): Promise<PolicyValue> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  const v = (row?.value ?? {}) as Partial<{ centerCategories: unknown; payrollComponents: unknown }>;
  const chosen = Array.isArray(v.centerCategories) ? v.centerCategories.filter((c): c is string => typeof c === 'string') : [];
  const payrollComponents = Array.isArray(v.payrollComponents)
    ? v.payrollComponents.filter((c): c is string => typeof c === 'string')
    : [...DEFAULT_PAYROLL_COMPONENTS];
  // Soliqlar: «Markaz hisobidan» belgilangan soliq turlari (Xarajatlar › Soliqlar)
  const taxRow = await prisma.setting.findUnique({ where: { key: 'tax.types' } }).catch(() => null);
  const taxCenter = Array.isArray(taxRow?.value)
    ? (taxRow!.value as { code?: unknown; center?: unknown }[]).filter((t) => t && t.center === true && typeof t.code === 'string').map((t) => `SOLIQ_${String(t.code)}`)
    : TAX_CENTER_DEFAULT;
  return { centerCategories: [...new Set([...chosen, ...ALWAYS_CENTER, ...taxCenter])], chosenCategories: chosen, payrollComponents };
}

/** Siyosatni yozadi (boshqa maydonlar saqlanadi) */
export async function writePolicy(prisma: PrismaService, patch: { centerCategories?: string[]; payrollComponents?: string[] }): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  const prev = (row?.value ?? {}) as Record<string, unknown>;
  const value = { ...prev, ...(patch.centerCategories ? { centerCategories: patch.centerCategories.filter((c) => !ALWAYS_CENTER.includes(c)) } : {}), ...(patch.payrollComponents ? { payrollComponents: patch.payrollComponents } : {}) };
  await prisma.setting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value }, update: { value } });
}

/** Markaz guruhi moddalari bazada bo'lsin (xarajat yozuvi moddaga bog'langan) */
export async function ensureCenterCategories(prisma: PrismaService): Promise<void> {
  const need = [CENTER_PARENT, ...Object.values(PAYROLL_CENTER_CATEGORY), PAYROLL_CENTER_OTHER, ASSET_CHARGE_CATEGORY, ASSET_EXPENSE_CATEGORY, ASSET_INVENTORY_CATEGORY];
  const have = new Set((await prisma.category.findMany({ where: { code: { in: need.map((c) => c.code) } }, select: { code: true } })).map((c) => c.code));
  if (!have.has(CENTER_PARENT.code)) {
    await prisma.category.create({ data: { code: CENTER_PARENT.code, label: CENTER_PARENT.label, isLeaf: false, isActive: true, order: 800 } }).catch(() => null);
  }
  let order = 801;
  for (const c of [...Object.values(PAYROLL_CENTER_CATEGORY), PAYROLL_CENTER_OTHER]) {
    if (!have.has(c.code)) await prisma.category.create({ data: { code: c.code, label: c.label, parentCode: CENTER_PARENT.code, isLeaf: true, isActive: true, order } }).catch(() => null);
    order += 1;
  }
  if (!have.has(ASSET_CHARGE_CATEGORY.code)) {
    await prisma.category.create({ data: { code: ASSET_CHARGE_CATEGORY.code, label: ASSET_CHARGE_CATEGORY.label, isLeaf: true, isActive: true, behavior: 'FIXED', order: 790 } }).catch(() => null);
  }
  if (!have.has(ASSET_EXPENSE_CATEGORY.code)) {
    await prisma.category.create({ data: { code: ASSET_EXPENSE_CATEGORY.code, label: ASSET_EXPENSE_CATEGORY.label, isLeaf: true, isActive: true, order: 791 } }).catch(() => null);
  }
  if (!have.has(ASSET_INVENTORY_CATEGORY.code)) {
    await prisma.category.create({ data: { code: ASSET_INVENTORY_CATEGORY.code, label: ASSET_INVENTORY_CATEGORY.label, isLeaf: true, isActive: true, order: 792 } }).catch(() => null);
  }
}

/** Belgilangan moddalar + ularning barcha ichki moddalari */
export function expandCategories(codes: string[], categories: { code: string; parentCode: string | null }[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parentCode) continue;
    const list = children.get(c.parentCode) ?? [];
    list.push(c.code);
    children.set(c.parentCode, list);
  }
  const out = new Set<string>();
  const walk = (code: string, depth: number) => {
    if (out.has(code) || depth > 20) return;
    out.add(code);
    for (const k of children.get(code) ?? []) walk(k, depth + 1);
  };
  for (const c of codes) walk(c, 0);
  return out;
}

/** Markaz hisobidagi moddalar to'plami (Solishtirma, tumanlar, siyosat sahifasi uchun) */
export async function loadCenterCategories(prisma: PrismaService, categories?: { code: string; parentCode: string | null }[]): Promise<Set<string>> {
  const policy = await readPolicy(prisma);
  const cats = categories ?? (await prisma.category.findMany({ select: { code: true, parentCode: true } }));
  return expandCategories(policy.centerCategories, cats);
}

/** Ish haqi komponenti qaysi Markaz moddasiga yoziladi */
export function payrollCenterCategory(componentCode: string): string {
  return PAYROLL_CENTER_CATEGORY[componentCode]?.code ?? PAYROLL_CENTER_OTHER.code;
}