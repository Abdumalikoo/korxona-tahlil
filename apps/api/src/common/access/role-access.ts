import type { UserRole } from '@prisma/client';

// ═══════════════════════════════════════════════════════════
// Rollar va ularga ochiq bo'limlar — BITTA joyda.
//
//  • ADMIN, VIEWER — login + parol bilan kiradi, butun dasturni ko'radi
//    (kiritish — faqat ADMIN, @Roles orqali).
//  • Ishchi rollar (Omborchi, keyin Buxgalter, Birjachi …) — ID kod + PIN bilan kiradi
//    va FAQAT shu yerda yozilgan bo'limlarni ko'radi va to'ldiradi.
//    Server boshqa har qanday so'rovni rad etadi (AccessGuard).
//
// Yangi rol qo'shish: Prisma'dagi enum UserRole'ga qiymat + shu ro'yxatga bitta yozuv.
// ═══════════════════════════════════════════════════════════

export interface RoleAccess {
  /** Ekranda ko'rinadigan nomi */
  label: string;
  /** Qisqa izoh — foydalanuvchi qo'shishda ko'rinadi */
  description: string;
  /** ID kod prefiksi: "SK" → SK-0001 */
  codePrefix: string;
  /** Ruxsat etilgan API bo'limlari (kontroller manzili: @Controller('warehouse') → 'warehouse') */
  api: string[];
  /** Ekrandagi bo'limlar (web manzillar, prefiks bo'yicha) */
  pages: string[];
  /** Kirgandan keyin ochiladigan sahifa (ish stoli) */
  home: string;
  /** Ekrandagi bo'limlar nomi (foydalanuvchilar ro'yxati uchun) */
  sections: string[];
  /** Umumiy hududdagi dashbordlar (Rollar › shu rol ichida) */
  dashboards: { label: string; href: string }[];
}

/** Hamma ishchi rolga ochiq: kirish, o'zi haqida ma'lumot, PIN o'zgartirish */
const COMMON_API = ['auth'];

export const WORKER_ROLES: Partial<Record<UserRole, RoleAccess>> = {
  SKLADCHI: {
    label: 'Omborchi',
    description: "Ombor (kirim, chiqim, qoldiq, asosiy vositalar, pochta) va Mashinalar (yoqilg'i, moyka, ta'mir)",
    codePrefix: 'SK',
    api: [...COMMON_API, 'warehouse', 'vehicles', 'receipts'],
    pages: ['/ombor', '/mashinalar'],
    home: '/ombor/ish-stoli',
    sections: ['Ombor', 'Mashinalar'],
    dashboards: [
      { label: 'Ombor', href: '/dashbord/ombor' },
      { label: 'Mashinalar', href: '/dashbord/mashinalar' },
    ],
  },
  XARIDCHI: {
    label: 'Xaridchi',
    description: "Xarid: birja bitimlari, oddiy xarid, arizalar, yetkazuvchilar, to'lovlar; tovar kelganda omborga qabulga yuboradi",
    codePrefix: 'XR',
    api: [...COMMON_API, 'purchases', 'receipts'],
    pages: ['/xarid'],
    home: '/xarid/ish-stoli',
    sections: ['Xarid'],
    dashboards: [{ label: 'Xarid', href: '/dashbord/xarid' }],
  },
  BUXGALTER: {
    label: 'Buxgalter',
    description: "Buxgalteriya: hisobraqamlar bo'yicha kunlik tushum, qaytarilgan mablag' va qoldiq (kunlik ma'lumotnoma)",
    codePrefix: 'BX',
    api: [...COMMON_API, 'cashbook'],
    pages: ['/buxgalteriya'],
    home: '/buxgalteriya/ish-stoli',
    sections: ['Buxgalteriya'],
    dashboards: [{ label: 'Kunlik tushum', href: '/dashbord/buxgalteriya' }],
  },
  HUDUDCHI: {
    label: 'Hududchi',
    description: "Hududlar: daromad (xizmatlar hisoboti shablonini yuklash), xodimlar reja/tushum fayli, hudud xodimlari ish haqi vedomosti va hudud xarajatlari",
    codePrefix: 'HD',
    api: [...COMMON_API, 'regional-desk', 'regional-data', 'plan-fact', 'bulk-delete'],
    pages: ['/hudud'],
    home: '/hudud/ish-stoli',
    sections: ['Hududlar'],
    dashboards: [{ label: 'Hududlar', href: '/dashbord/hudud' }],
  },
};

/**
 * Administrator bergan nomlar (Sozlamalar / Rollar): SKLADCHI → "Omborchi" o'rniga o'zi qo'ygan nom.
 * Bazadagi «roles.labels» sozlamasidan ishga tushishda yuklanadi (RolesService), o'zgarganda yangilanadi.
 */
const CUSTOM_LABELS = new Map<string, string>();

export function setRoleLabels(labels: Record<string, string>): void {
  CUSTOM_LABELS.clear();
  for (const [role, label] of Object.entries(labels)) {
    if (isWorkerRole(role) && typeof label === 'string' && label.trim()) CUSTOM_LABELS.set(role, label.trim());
  }
}

export function customRoleLabels(): Record<string, string> {
  return Object.fromEntries(CUSTOM_LABELS);
}

/** ID kod + PIN bilan kiradigan (cheklangan) rolmi */
export function isWorkerRole(role: UserRole | string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKER_ROLES, role);
}

export function roleAccess(role: UserRole | string): RoleAccess | null {
  return (WORKER_ROLES as Record<string, RoleAccess | undefined>)[role] ?? null;
}

/** Ekranga beriladigan ruxsatlar: null — cheklanmagan (admin / kuzatuvchi) */
export function accessView(role: UserRole | string): { home: string; pages: string[]; sections: string[] } | null {
  const a = roleAccess(role);
  return a ? { home: a.home, pages: a.pages, sections: a.sections } : null;
}

export function roleLabel(role: UserRole | string): string {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'VIEWER') return "Kuzatuvchi (faqat ko'rish)";
  return CUSTOM_LABELS.get(role) ?? roleAccess(role)?.label ?? role;
}

/** "sk1", "SK0001", " sk-0001 " → "SK-0001" (kamida 4 xonali raqam) */
export function normalizeLoginCode(raw: string): string | null {
  const m = /^\s*([A-Za-z]{2,4})-?(\d{1,6})\s*$/.exec(raw ?? '');
  if (!m) return null;
  return `${m[1]!.toUpperCase()}-${m[2]!.replace(/^0+(?=\d)/, '').padStart(4, '0')}`;
}