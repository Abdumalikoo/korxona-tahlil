import type { Driver, Role } from './allocation.calc';
import { CENTER_UNIT, UNASSIGNED_UNIT } from './econ.loader';

// ═══════════════════════════════════════════════════════════
// Taqsimlash qoidasi: har bir Markaz birligi (bo'lim) uchun roli va drayveri, «shu oydan boshlab».
// Qoida tarixi saqlanadi: oy uchun — shu oygacha kuchga kirgan eng oxirgi qoida.
// Qoida yo'q birlik — taqsimlanmaydi (Markazda qoladi) va tavsiya ko'rsatiladi.
// ═══════════════════════════════════════════════════════════

export interface RuleRow {
  id: string;
  unitKey: string;
  role: string;
  driver: string | null;
  validFrom: string;
  note: string | null;
  createdById?: string;
  createdAt?: Date;
}

/** Oy uchun amaldagi qoida */
export function ruleFor(rules: RuleRow[], unitKey: string, period: string): RuleRow | null {
  let best: RuleRow | null = null;
  for (const r of rules) {
    if (r.unitKey !== unitKey || r.validFrom > period) continue;
    if (!best || r.validFrom > best.validFrom) best = r;
  }
  return best;
}

export interface Suggestion {
  role: Role;
  driver: Driver | null;
  reason: string;
}

const has = (s: string, words: string[]) => words.some((w) => s.includes(w));

/**
 * Bo'lim nomidan taxminiy qoida (faqat tavsiya — administrator tasdiqlamaguncha qo'llanmaydi).
 * O'z daromadi bor bo'lim — «daromad keltiruvchi».
 */
export function suggestRule(unitKey: string, name: string, hasIncome: boolean): Suggestion | null {
  if (unitKey === UNASSIGNED_UNIT) return null;
  if (unitKey === CENTER_UNIT) return { role: 'SUPPORT', driver: 'HEADCOUNT', reason: "Bo'limsiz umumiy xarajatlar (bino, kommunal) odatda xodimlar soniga qarab bo'linadi" };
  const n = name.toLowerCase().replace(/[‘’ʻʼ`']/g, "'");
  if (has(n, ['rahbar', 'boshqaruv', 'direktor', 'devon', 'kotibiyat', 'bosh ofis'])) return { role: 'CORPORATE', driver: null, reason: "Rahbariyat — butun korxona xarajati, hududlarga bo'linmaydi" };
  if (hasIncome) return { role: 'REVENUE', driver: null, reason: "Bo'limning o'z daromadi bor — xarajati o'z daromadi bilan Markazda qoladi" };
  if (has(n, ['buxgalter', 'moliya', 'hisob'])) return { role: 'SUPPORT', driver: 'PAYROLL_RECORDS', reason: "Buxgalteriya ishi asosan ish haqi va hujjatlar soniga bog'liq" };
  if (has(n, ['kadr', 'xodimlar', 'personal', 'hr'])) return { role: 'SUPPORT', driver: 'HEADCOUNT', reason: "Kadrlar ishi xodimlar soniga bog'liq" };
  if (has(n, ['axborot', ' it', 'it ', 'texnolog', 'dastur', 'raqamli'])) return { role: 'SUPPORT', driver: 'HEADCOUNT', reason: "IT xizmati foydalanuvchilar (xodimlar) soniga bog'liq" };
  if (has(n, ['yurid', 'huquq'])) return { role: 'SUPPORT', driver: 'TRANSACTIONS', reason: "Yuridik ish hujjatlar (shartnomalar) soniga bog'liq" };
  if (has(n, ["xo'jalik", 'ta\'minot', 'logist', 'transport', 'xarid'])) return { role: 'SUPPORT', driver: 'HEADCOUNT', reason: "Ta'minot va xo'jalik xarajati xodimlar soniga bog'liq" };
  if (has(n, ['nazorat', 'audit', 'monitoring', 'tekshir', 'tahlil', 'metodolog'])) return { role: 'SUPPORT', driver: 'REVENUE', reason: "Nazorat va metodik ish hudud faoliyati hajmiga (daromadiga) bog'liq" };
  if (has(n, ['marketing', 'sotuv', 'savdo', 'mijoz'])) return { role: 'SUPPORT', driver: 'REVENUE', reason: "Sotuv va marketing daromadga xizmat qiladi — daromad ulushi bo'yicha" };
  return { role: 'SUPPORT', driver: 'HEADCOUNT', reason: "Umumiy taxmin: yordamchi bo'lim, xodimlar soni bo'yicha. Tekshirib tasdiqlang" };
}