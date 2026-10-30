import type { PrismaService } from '../prisma/prisma.service';
import { SEGMENTS } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Qo'mita mablag'lari — umumiy qoidalar (xizmat va ish haqi qayta guruhlash birga ishlatadi).
//
// Qo'mita bizning ayrim bo'limlarimiz (masalan, Call-markaz) xarajatini qoplash uchun pul ajratadi:
//  • DAROMAD — har bo'lim uchun o'z daromad turi («Qo'mita ajratmasi: <bo'lim>»), yozuv yo'nalishi «QOMITA».
//    Qo'lda kiritiladi yoki bank ko'chirmasidagi kirimdan yo'naltiriladi.
//  • XARAJAT (qoplanadigan):
//     – ish haqi qismlari (Oklad, Oklad ustamasi 40% …) — shu bo'lim xodimlarining ish haqi tarkibidan; ish haqi
//       qayta guruhlanganda bo'lim ish haqidan ajratiladi va «QMT_<komponent>» moddasi bilan Qo'mita hisobiga yoziladi;
//     – boshqa moddalar (aloqa, kanselyariya …) — bo'limlar siyosati (depRules) orqali Qo'mita hisobiga o'tadi
//       (yozuv joyida qoladi, Solishtirma va tahlilda Qo'mita xarajati).
//  • Jami xarajat o'zgarmaydi — faqat kim hisobidan ekani o'zgaradi.
// Saqlash: settings «qomita.config», ish haqi ajratmasi xulosasi — «qomita.payroll.<OY>». Migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const QOMITA_SEGMENT = 'QOMITA';
export const QOMITA_CONFIG_KEY = 'qomita.config';
export const QOMITA_PART_PREFIX = 'QMT_';
export const QOMITA_PART_PARENT = { code: 'QMT', label: "Qo'mita hisobidan qoplanadigan ish haqi" };
export const QOMITA_INCOME_PREFIX = 'QOMITA_';
/** Bank ko'chirmasidan (Qo'mita mablag'lari sahifasida) yuklangan yozuvlar: importBatchId = «qomita-bank:<yuklash id>» */
export const QOMITA_BANK_TAG = 'qomita-bank:';
export const qomitaPayrollKey = (period: string) => `qomita.payroll.${period}`;
export const qomitaPartCategory = (componentCode: string) => `${QOMITA_PART_PREFIX}${componentCode}`;
export const qomitaPartOf = (categoryCode: string) => (categoryCode.startsWith(QOMITA_PART_PREFIX) ? categoryCode.slice(QOMITA_PART_PREFIX.length) : null);

/** Bitta qoplanadigan yo'nalish: Markaz bo'limi + uning daromad turi + qoplanadigan ish haqi qismlari */
export interface QomitaItem {
  id: string;
  departmentId: string;
  /** Daromad turi kodi (IncomeCategory) */
  incomeCode: string;
  /** Ish haqi tarkibi komponentlari (OKLAD, OKLAD_40 …) */
  components: string[];
  note: string | null;
  createdAt: string;
}

export interface QomitaConfig {
  items: QomitaItem[];
}

/** Shu oy ish haqidan Qo'mitaga ajratilgani (qayta guruhlashda yoziladi) */
export interface QomitaPayrollSummary {
  updatedAt: string;
  /** Shu oy ish haqi tarkibi yuklanganmi (yo'q bo'lsa — ajratib bo'lmaydi) */
  tarkib: boolean;
  deps: Record<string, { parts: Record<string, string>; employees: { pinfl: string; fullName: string; parts: Record<string, string> }[] }>;
}

const CODE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export function cleanQomitaConfig(raw: unknown): QomitaConfig {
  const v = (raw ?? {}) as { items?: unknown };
  const items: QomitaItem[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v.items) ? v.items : []) {
    if (!x || typeof x !== 'object') continue;
    const it = x as Record<string, unknown>;
    const departmentId = typeof it.departmentId === 'string' ? it.departmentId.slice(0, 64) : '';
    const incomeCode = typeof it.incomeCode === 'string' ? it.incomeCode.slice(0, 64) : '';
    if (!departmentId || !incomeCode || seen.has(departmentId)) continue;
    seen.add(departmentId);
    items.push({
      id: typeof it.id === 'string' && it.id ? it.id.slice(0, 64) : departmentId,
      departmentId,
      incomeCode,
      components: [...new Set((Array.isArray(it.components) ? it.components : []).filter((c): c is string => typeof c === 'string' && CODE_RE.test(c)))],
      note: typeof it.note === 'string' && it.note.trim() ? it.note.trim().slice(0, 300) : null,
      createdAt: typeof it.createdAt === 'string' ? it.createdAt : new Date(0).toISOString(),
    });
  }
  return { items };
}

export async function readQomita(prisma: Pick<PrismaService, 'setting'>): Promise<QomitaConfig> {
  const row = await prisma.setting.findUnique({ where: { key: QOMITA_CONFIG_KEY } }).catch(() => null);
  return cleanQomitaConfig(row?.value);
}

/** Bo'lim → qoplanadigan komponentlar (faqat komponenti borlari) */
export function qomitaCoverage(config: QomitaConfig): Map<string, string[]> {
  return new Map(config.items.filter((i) => i.components.length).map((i) => [i.departmentId, i.components]));
}

/**
 * Xodim ish haqidan ajratiladigan qismlar: avval Qo'mita qoplaydiganlari («QMT_<kod>»), qolgani — siyosatdagi Markaz
 * qismlari («IHQ_<kod>»; Qo'mita qoplaydigan komponent ikki marta ajratilmaydi). Jami to'liq ish haqidan oshmaydi.
 */
export function splitWithQomita(full: bigint, centerParts: Map<string, bigint> | undefined, qomitaParts: Map<string, bigint> | undefined, covered: string[], centerCodeOf: (component: string) => string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (full <= 0n) return out;
  let left = full;
  const cov = new Set(covered);
  for (const code of [...cov].sort()) {
    const want = qomitaParts?.get(code) ?? 0n;
    if (want <= 0n || left <= 0n) continue;
    const take = want < left ? want : left;
    out.set(qomitaPartCategory(code), take);
    left -= take;
  }
  const skip = new Set([...cov].map(centerCodeOf));
  for (const [code, want] of centerParts ?? []) {
    if (skip.has(code) || want <= 0n || left <= 0n) continue;
    const take = want < left ? want : left;
    out.set(code, take);
    left -= take;
  }
  return out;
}

/** «QMT_<kod>» moddalari bazada bo'lsin (yo'q bo'lsa — yaratiladi) */
export async function ensureQomitaPartCategories(prisma: PrismaService, components: { code: string; name: string }[]): Promise<void> {
  if (!components.length) return;
  const need = [QOMITA_PART_PARENT.code, ...components.map((c) => qomitaPartCategory(c.code))];
  const have = new Set((await prisma.category.findMany({ where: { code: { in: need } }, select: { code: true } })).map((c) => c.code));
  if (!have.has(QOMITA_PART_PARENT.code)) {
    await prisma.category.create({ data: { code: QOMITA_PART_PARENT.code, label: QOMITA_PART_PARENT.label, isLeaf: false, isActive: true, order: 840 } }).catch(() => null);
  }
  let order = 841;
  for (const c of components) {
    const code = qomitaPartCategory(c.code);
    if (!have.has(code)) await prisma.category.create({ data: { code, label: `Qo'mita hisobidan: ${c.name}`.slice(0, 200), parentCode: QOMITA_PART_PARENT.code, isLeaf: true, isActive: true, order } }).catch(() => null);
    order += 1;
  }
}

// ═══════════ Qo'mita ajratmasi — egasi bo'limga (Solishtirma, Bosh sahifa) ═══════════

/** Qo'mita ajratmasi egasi: Markaz bo'limi (Call markaz …) yoki bo'lim nomi bilan bir xil yo'nalish (Marksheyder) */
export interface QomitaOwner {
  departmentId: string;
  departmentName: string;
  /** Bo'lim nomi yo'nalish bilan bir xil bo'lsa — yo'nalish kodi (MARKSHEYDER); aks holda null (Markaz bo'limi) */
  segment: string | null;
}

const ownerKey = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');

/**
 * Qo'mita ajratmasi moddasi (QOMITA_<bo'lim indeksi>) → egasi. Saqlashda ajratma «Qo'mita» yo'nalishida turadi (3802
 * hisobi, nazorat shu bo'yicha); Solishtirma va Bosh sahifada esa pul berilgan bo'limning o'z daromadi bo'lib ko'rinadi —
 * shunda bo'lim natijasi Qo'mita qoplagan qismi bilan chiqadi.
 */
export async function qomitaIncomeOwners(prisma: { department: { findMany: (a: { select: { id: true; name: true; index: true } }) => Promise<{ id: string; name: string; index: number }[]> } }): Promise<Map<string, QomitaOwner>> {
  const out = new Map<string, QomitaOwner>();
  for (const d of await prisma.department.findMany({ select: { id: true, name: true, index: true } })) {
    const seg = SEGMENTS.find((x) => x.code !== QOMITA_SEGMENT && ownerKey(x.label) === ownerKey(d.name));
    out.set(`${QOMITA_INCOME_PREFIX}${d.index}`, { departmentId: d.id, departmentName: d.name, segment: seg ? seg.code : null });
  }
  return out;
}

/** Daromad yozuvlari: «Qo'mita» yo'nalishidagi ajratma — egasi bo'limga (Markaz bo'limi yoki yo'nalish); joyida o'zgartiradi */
export function ownQomitaIncome<T extends { categoryCode: string; segment?: string | null; regionCode?: number | null; departmentId?: string | null }>(rows: T[], owners: Map<string, QomitaOwner>): T[] {
  for (const r of rows) {
    if (r.segment !== QOMITA_SEGMENT) continue;
    const o = owners.get(r.categoryCode);
    if (!o) continue;
    if (o.segment) {
      r.segment = o.segment;
    } else {
      r.segment = null;
      r.regionCode = 0;
      r.departmentId = o.departmentId;
    }
  }
  return rows;
}
