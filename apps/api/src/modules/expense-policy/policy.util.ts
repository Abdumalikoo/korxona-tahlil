import type { PrismaService } from '../prisma/prisma.service';
import { ENTRY_UNIT_CODES, entryUnitOf, isSegment, segmentKey } from '../../common/segments/segments';
import { runExclusive } from '../../common/locks';

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
  /**
   * Bo'limlar siyosati: shu bo'limda (manba) yozilgan xarajat moddasi qaysi bo'lim hisobiga o'tadi.
   * { TAX_FREE: { INTERNET: 'CENTER', REKLAMA: 'MARKSHEYDER' }, CENTER: { X: 'TAX_FREE' } }.
   * Maqsad manbaning o'zi bo'lsa — «shu bo'limda qoladi» (umumiy siyosatdan istisno). Ota moddaga berilgan qoida ichkilariga ham.
   * Bo'lim qoidasi umumiy siyosatdan ustun. Yozuvlar joyida qoladi — faqat hisobot va tahlilda hisobga olinadi.
   */
  unitRules: UnitRules;
  /**
   * Bo'limlar siyosati — ish haqi qismlari (ish haqi tarkibi komponentlari: bayram puli, choraklik, ustama …):
   * { TAX_FREE: { BAYRAM: 'QOMITA' }, REGION: { CHORAK: 'CENTER' } }. Qism ish haqidan ajratilib, alohida xarajat
   * (modda «IHQ_<KOD>») bo'lib yoziladi va tanlangan bo'lim hisobiga o'tadi. Maqsad manbaning o'zi — «ish haqi ichida qoladi».
   */
  unitPayroll: UnitRules;
}

/** Ish haqi qismi moddasi: «IHQ_<komponent kodi>» (ota modda — «Ish haqi qismlari») */
export const PAYROLL_PART_PREFIX = 'IHQ_';
export const PAYROLL_PART_PARENT = { code: 'IHQ', label: "Ish haqi qismlari (siyosat bo'yicha)" };
export const payrollPartCategory = (componentCode: string) => `${PAYROLL_PART_PREFIX}${componentCode}`;
export const payrollPartOf = (categoryCode: string) => (categoryCode.startsWith(PAYROLL_PART_PREFIX) ? categoryCode.slice(PAYROLL_PART_PREFIX.length) : null);

/** Ish haqi qismlari moddalari bazada bo'lsin (yo'q bo'lsa — yaratiladi, borlariga tegilmaydi) */
export async function ensurePayrollPartCategories(prisma: PrismaService, components: { code: string; name: string }[]): Promise<void> {
  if (!components.length) return;
  const need = [PAYROLL_PART_PARENT.code, ...components.map((c) => payrollPartCategory(c.code))];
  const have = new Set((await prisma.category.findMany({ where: { code: { in: need } }, select: { code: true } })).map((c) => c.code));
  if (!have.has(PAYROLL_PART_PARENT.code)) {
    await prisma.category.create({ data: { code: PAYROLL_PART_PARENT.code, label: PAYROLL_PART_PARENT.label, isLeaf: false, isActive: true, order: 820 } }).catch(() => null);
  }
  let order = 821;
  for (const c of components) {
    const code = payrollPartCategory(c.code);
    if (!have.has(code)) await prisma.category.create({ data: { code, label: `Ish haqi qismi: ${c.name}`.slice(0, 200), parentCode: PAYROLL_PART_PARENT.code, isLeaf: true, isActive: true, order } }).catch(() => null);
    order += 1;
  }
}

export type UnitRules = Record<string, Record<string, string>>;

/** Bo'limlar qoidalarini tozalash: manba — 6 bo'limdan biri; maqsad — Markaz yoki yo'nalish (Hududlar — faqat o'zida qolish) */
export function cleanUnitRules(raw: unknown): UnitRules {
  const out: UnitRules = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [source, map] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENTRY_UNIT_CODES.includes(source) || !map || typeof map !== 'object' || Array.isArray(map)) continue;
    const rules: Record<string, string> = {};
    for (const [code, target] of Object.entries(map as Record<string, unknown>)) {
      if (!code || code.length > 64 || typeof target !== 'string' || !ENTRY_UNIT_CODES.includes(target)) continue;
      if (target === 'REGION' && source !== 'REGION') continue;
      rules[code] = target;
    }
    if (Object.keys(rules).length) out[source] = rules;
  }
  return out;
}

/** Bo'lim kodi → Solishtirma birligi kaliti (Markaz — "center", yo'nalish — "s:KOD") */
export function unitTargetKey(target: string): string {
  return target === 'CENTER' ? 'center' : segmentKey(target);
}

/** Birlik kaliti → bo'lim kodi */
export function unitOfKey(key: string): string | null {
  if (key === 'center') return 'CENTER';
  if (key.startsWith('s:')) return key.slice(2);
  if (key.startsWith('r:')) return 'REGION';
  return null;
}

/** Bazadan siyosat (yo'q bo'lsa — standart) */
export async function readPolicy(prisma: PrismaService): Promise<PolicyValue> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  const v = (row?.value ?? {}) as Partial<{ centerCategories: unknown; excludeCategories: unknown; payrollComponents: unknown; payers: unknown; unitRules: unknown; unitPayroll: unknown }>;
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
    unitRules: cleanUnitRules(v.unitRules),
    unitPayroll: cleanUnitRules(v.unitPayroll),
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
export async function writePolicy(prisma: PrismaService, patch: { centerCategories?: string[]; excludeCategories?: string[]; payrollComponents?: string[]; payers?: Record<string, string>; unitRules?: UnitRules; unitPayroll?: UnitRules }): Promise<void> {
  // Siyosat bir nechta bo'limdan yoziladi — bitta yozuvga navbat bilan (o'qish va yozish orasida boshqasi aralashmasin)
  return runExclusive(`setting:${POLICY_KEY}`, async () => {
    const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
    const prev = (row?.value ?? {}) as Record<string, unknown>;
    const value = {
      ...prev,
      ...(patch.centerCategories ? { centerCategories: patch.centerCategories.filter((c) => !ALWAYS_CENTER.includes(c)) } : {}),
      ...(patch.excludeCategories ? { excludeCategories: patch.excludeCategories.filter((c) => !ALWAYS_CENTER.includes(c)) } : {}),
      ...(patch.payrollComponents ? { payrollComponents: patch.payrollComponents } : {}),
      ...(patch.payers ? { payers: patch.payers } : {}),
      ...(patch.unitRules ? { unitRules: patch.unitRules } : {}),
      ...(patch.unitPayroll ? { unitPayroll: patch.unitPayroll } : {}),
    };
    await prisma.setting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value }, update: { value } });
  });
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
  const out = expandCategories(policy.centerCategories, cats);
  // Hududlar bo'limi qoidalari: boshqa bo'limga o'tadiganlari qo'shiladi, «Hududda qoladi» — chiqariladi
  const regionRules = policy.unitRules.REGION;
  if (regionRules) {
    const rule = ruleLookup(regionRules, cats);
    for (const c of cats) {
      const t = rule(c.code);
      if (t === 'REGION') out.delete(c.code);
      else if (t) out.add(c.code);
    }
    for (const [code, t] of Object.entries(regionRules)) if (t !== 'REGION') out.add(code);
  }
  // Hududlar ish haqi qismlari: boshqa bo'limga o'tadiganlari hudud xarajatiga kirmaydi
  for (const [comp, t] of Object.entries(policy.unitPayroll.REGION ?? {})) if (t !== 'REGION') out.add(payrollPartCategory(comp));
  return out;
}

/** Bo'lim qoidasi: moddadan ota-onalari bo'ylab — birinchi qoida (yo'q bo'lsa — undefined) */
export function ruleLookup(rules: Record<string, string>, categories: { code: string; parentCode: string | null }[]): (code: string) => string | undefined {
  const parent = new Map(categories.map((c) => [c.code, c.parentCode]));
  const memo = new Map<string, string | undefined>();
  return (code: string) => {
    if (memo.has(code)) return memo.get(code);
    let cur: string | null = code;
    let out: string | undefined;
    for (let depth = 0; cur && depth <= 20; depth += 1) {
      if (rules[cur]) {
        out = rules[cur];
        break;
      }
      cur = parent.get(cur) ?? null;
    }
    memo.set(code, out);
    return out;
  };
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
  /**
   * Yozuv kim hisobida (bo'lim qoidasi, so'ng umumiy siyosat): birlik kaliti va sababi; joyida qolsa — null.
   * Bo'lim qoidasi «shu bo'limda qoladi» bo'lsa — umumiy siyosat ham qo'llanmaydi.
   */
  route: (row: { categoryCode: string | null; regionCode: number | null; departmentId: string | null; segment?: string | null }) => { key: string; origin: 'unit' | 'global' } | null;
}

export function policyRouting(policy: Pick<PolicyValue, 'centerCategories' | 'payers'> & { unitRules?: UnitRules; unitPayroll?: UnitRules }, categories: { code: string; parentCode: string | null }[]): PolicyRouting {
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
  const lookups = new Map<string, (code: string) => string | undefined>();
  for (const [source, rules] of Object.entries(policy.unitRules ?? {})) lookups.set(source, ruleLookup(rules, categories));
  const route: PolicyRouting['route'] = (row) => {
    const code = row.categoryCode;
    if (!code) return null;
    const source = entryUnitOf({ regionCode: row.regionCode, departmentId: row.departmentId, segment: row.segment ?? null });
    // Ish haqi qismi (IHQ_<komponent>) — shu bo'limning ish haqi qismlari qoidasi bo'yicha
    const part = payrollPartOf(code);
    if (part !== null && source) {
      const t = policy.unitPayroll?.[source]?.[part];
      if (t) return t === source ? null : { key: unitTargetKey(t), origin: 'unit' };
    }
    const target = source ? lookups.get(source)?.(code) : undefined;
    if (target !== undefined) return target === source ? null : { key: unitTargetKey(target), origin: 'unit' };
    return moved.has(code) ? { key: payerKey(code), origin: 'global' } : null;
  };
  return { moved, payerKey, route };
}

/** Siyosat yo'nalishi (bazadan) */
export async function loadPolicyRouting(prisma: PrismaService, categories?: { code: string; parentCode: string | null }[]): Promise<PolicyRouting> {
  const policy = await readPolicy(prisma);
  const cats = categories ?? (await prisma.category.findMany({ select: { code: true, parentCode: true } }));
  return policyRouting(policy, cats);
}