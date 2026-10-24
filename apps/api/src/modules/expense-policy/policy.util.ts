import type { PrismaService } from '../prisma/prisma.service';
import { isSegment, segmentKey } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Xarajatlar siyosati — qaysi moddalar MARKAZ hisobidan (hudud xodimlari uchun bo'lsa ham).
//
// Masalan: hudud xodimlariga bayram puli, choraklik mukofot, xizmat safari (komandirovka), internet to'lovlari —
// qayerda yozilgan bo'lishidan qat'i nazar, Markaz xarajatiga o'tadi. Markaz xarajati guruhlari:
//   1) Joriy xarajatlar — Markazning o'z xarajatlari va hududlar uchun to'laganlari (siyosatdagi moddalar);
//   2) Asosiy vositalar — xarid xarajatga birdaniga yozilmaydi (balansda turadi), har oy sarfi (eskirish) yoziladi.
// Siyosat «settings» jadvalida saqlanadi (kalit: expense.policy) — bazaga migratsiya kerak emas.
// Ota modda belgilansa — uning hamma ichki moddalari ham kiradi; ichki moddani alohida «Hududga» qaytarish mumkin
// (istisno: ro'yxatda «!KOD»). Qoida: moddaga eng yaqin belgilangan (o'zi yoki ota-onasi) qaror qiladi.
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
  /** Markaz hisobidagi moddalar (ota modda bo'lsa — ichkilari ham); har doimgilar qo'shilgan; «!KOD» — istisno (hududda qoladi) */
  centerCategories: string[];
  /** Foydalanuvchi belgilagan (har doimgilarsiz) */
  chosenCategories: string[];
  /** Markazga o'tgan ota moddaning hududda qoladigan ichki moddalari */
  excludedCategories: string[];
  /** Ish haqi tarkibidan Markazga o'tadigan komponentlar kodi */
  payrollComponents: string[];
  /**
   * Belgilangan modda kim hisobidan: yo'nalish kodi (TAX_FREE, MARKSHEYDER …). Ro'yxatda yo'q bo'lsa — Markaz.
   * Ota moddaga berilgan to'lovchi ichki moddalarga ham o'tadi (ichki moddada o'zi berilmagan bo'lsa).
   */
  payers: Record<string, string>;
}

/** Bazadan siyosat (yo'q bo'lsa — standart) */
export async function readPolicy(prisma: PrismaService): Promise<PolicyValue> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  const v = (row?.value ?? {}) as Partial<{ centerCategories: unknown; excludeCategories: unknown; payrollComponents: unknown; payers: unknown }>;
  const chosen = Array.isArray(v.centerCategories) ? v.centerCategories.filter((c): c is string => typeof c === 'string') : [];
  const excluded = Array.isArray(v.excludeCategories) ? v.excludeCategories.filter((c): c is string => typeof c === 'string' && !ALWAYS_CENTER.includes(c)) : [];
  const payrollComponents = Array.isArray(v.payrollComponents)
    ? v.payrollComponents.filter((c): c is string => typeof c === 'string')
    : [...DEFAULT_PAYROLL_COMPONENTS];
  // Soliqlar: «Markaz hisobidan» belgilangan soliq turlari (Xarajatlar › Soliqlar)
  const taxRow = await prisma.setting.findUnique({ where: { key: 'tax.types' } }).catch(() => null);
  const taxCenter = Array.isArray(taxRow?.value)
    ? (taxRow!.value as { code?: unknown; center?: unknown }[]).filter((t) => t && t.center === true && typeof t.code === 'string').map((t) => `SOLIQ_${String(t.code)}`)
    : TAX_CENTER_DEFAULT;
  const taxSet = new Set(taxCenter);
  return {
    centerCategories: [...new Set([...chosen, ...ALWAYS_CENTER, ...taxCenter, ...excluded.filter((c) => !taxSet.has(c)).map((c) => `!${c}`)])],
    chosenCategories: chosen,
    excludedCategories: excluded,
    payrollComponents,
    payers: cleanPayers(v.payers, chosen),
  };
}

/** To'lovchilar: faqat belgilangan (Markazga o'tadigan) moddalar va ma'lum yo'nalishlar; har doim Markazdagilar — o'zgarmaydi */
function cleanPayers(raw: unknown, chosen: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [code, seg] of Object.entries(raw as Record<string, unknown>)) {
    if (chosen.includes(code) && !ALWAYS_CENTER.includes(code) && isSegment(seg)) out[code] = seg;
  }
  return out;
}

/** Siyosatni yozadi (boshqa maydonlar saqlanadi) */
export async function writePolicy(prisma: PrismaService, patch: { centerCategories?: string[]; excludeCategories?: string[]; payrollComponents?: string[]; payers?: Record<string, string> }): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  const prev = (row?.value ?? {}) as Record<string, unknown>;
  const value = {
    ...prev,
    ...(patch.centerCategories ? { centerCategories: patch.centerCategories.filter((c) => !ALWAYS_CENTER.includes(c)) } : {}),
    ...(patch.excludeCategories ? { excludeCategories: patch.excludeCategories.filter((c) => !ALWAYS_CENTER.includes(c)) } : {}),
    ...(patch.payrollComponents ? { payrollComponents: patch.payrollComponents } : {}),
    ...(patch.payers ? { payers: patch.payers } : {}),
  };
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

/**
 * Belgilangan moddalar + ularning barcha ichki moddalari.
 * «!KOD» — istisno: o'sha modda (va ichkilari) kirmaydi. Har bir modda uchun eng yaqin belgilangan
 * (o'zi, so'ng ota-onasi) qaror qiladi — ichki moddadagi belgi ota moddadagidan ustun.
 */
export function expandCategories(codes: string[], categories: { code: string; parentCode: string | null }[]): Set<string> {
  const include = new Set<string>();
  const exclude = new Set<string>();
  for (const c of codes) {
    if (c.startsWith('!')) exclude.add(c.slice(1));
    else include.add(c);
  }
  const parent = new Map<string, string | null>();
  for (const c of categories) parent.set(c.code, c.parentCode);
  const out = new Set<string>();
  for (const c of categories) {
    let cur: string | null = c.code;
    let depth = 0;
    while (cur && depth++ <= 20) {
      if (exclude.has(cur)) break;
      if (include.has(cur)) {
        out.add(c.code);
        break;
      }
      cur = parent.get(cur) ?? null;
    }
  }
  // Ro'yxatda bor, lekin moddalar ro'yxatida yo'q kodlar (masalan, hali yaratilmagan) — o'zi kiradi
  for (const c of include) if (!parent.has(c)) out.add(c);
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

/**
 * Siyosat bo'yicha xarajat yo'nalishi: qaysi moddalar yozilgan joyidan olinadi (moved) va kim hisobiga o'tadi.
 * payerKey(modda) — "center" yoki yo'nalish birligi ("s:TAX_FREE"); faqat moved ichidagi moddalar uchun ma'noli.
 * Qoida: moddadan boshlab ota-onalari bo'ylab yuqoriga — birinchi belgilangan (o'zi yoki ota modda) to'lovchini belgilaydi.
 */
export interface PolicyRouting {
  moved: Set<string>;
  payerKey: (code: string) => string;
}

export function policyRouting(policy: Pick<PolicyValue, 'centerCategories' | 'payers'>, categories: { code: string; parentCode: string | null }[]): PolicyRouting {
  const moved = expandCategories(policy.centerCategories, categories);
  const parent = new Map(categories.map((c) => [c.code, c.parentCode]));
  const include = new Set(policy.centerCategories.filter((c) => !c.startsWith('!')));
  const payers = policy.payers ?? {};
  const memo = new Map<string, string>();
  const payerKey = (code: string): string => {
    const hit = memo.get(code);
    if (hit) return hit;
    let cur: string | null = code;
    let out = 'center';
    for (let depth = 0; cur && depth <= 20; depth += 1) {
      if (include.has(cur) || payers[cur]) {
        out = payers[cur] ? segmentKey(payers[cur]!) : 'center';
        break;
      }
      cur = parent.get(cur) ?? null;
    }
    memo.set(code, out);
    return out;
  };
  return { moved, payerKey };
}

/** Siyosat yo'nalishi (bazadan) */
export async function loadPolicyRouting(prisma: PrismaService, categories?: { code: string; parentCode: string | null }[]): Promise<PolicyRouting> {
  const policy = await readPolicy(prisma);
  const cats = categories ?? (await prisma.category.findMany({ select: { code: true, parentCode: true } }));
  return policyRouting(policy, cats);
}