import type { ComponentType, SVGProps } from 'react';
import {
  NavCompare,
  NavExpense,
  NavFlag,
  NavFormula,
  NavHome,
  NavIncome,
  NavLayers,
  NavPie,
  NavReport,
  NavSettings,
  NavShield,
  NavUsers,
} from './nav-icons';

// ═══════════════════════════════════════════════════════════
// Yagona navigatsiya ro'yxati:
//  • chap menyu (asosiy bo'limlar);
//  • yuqori paneldagi sarlavha (sahifa o'zinikini bermasa);
//  • global qidiruvdagi "Sahifalar".
// Yangi sahifa qo'shilsa — faqat shu faylga yoziladi.
// ═══════════════════════════════════════════════════════════

export interface NavPage {
  label: string;
  href: string;
  /** Qisqa izoh (qidiruvda ko'rinadi) */
  description?: string;
  /** Yorliqlar qatorida ko'rinmaydi (faqat qidiruvda) */
  hidden?: boolean;
}

export interface NavItem extends NavPage {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shu bo'limga tegishli boshqa manzillar (masalan, /tahlil/daromad) */
  match?: string[];
  adminOnly?: boolean;
  /** Bo'lim ichidagi sahifalar */
  pages?: NavPage[];
}

export const MENU: NavItem[] = [
  { label: 'Bosh sahifa', href: '/', icon: NavHome, description: 'Daromad, xarajat va tahlil bir qarashda' },
  {
    label: 'Daromadlar',
    href: '/daromadlar',
    icon: NavIncome,
    description: "Daromadlar ro'yxati va bo'limlari",
    pages: [
      { label: 'Umumiy', href: '/daromadlar', description: 'Doimiy va Boshqa bir qarashda' },
      { label: 'Doimiy', href: '/daromadlar/doimiy', description: "Muntazam daromadlar ro'yxati" },
      { label: 'Boshqa', href: '/daromadlar/boshqa', description: 'Bir martalik daromadlar' },
      { label: 'Hududlar tushumi', href: '/daromadlar/hududlar', description: 'Hududlardan Excel orqali kelgan tushum' },
      { label: 'Natijalar', href: '/daromadlar/natijalar', description: 'Oylik natijalar' },
      { label: 'Tahlil', href: '/daromadlar/tahlil', description: 'Daromad dinamikasi va tarkibi' },
    ],
  },
  {
    label: 'Xarajatlar',
    href: '/xarajatlar',
    icon: NavExpense,
    description: "Xarajatlar ro'yxati va bo'limlari",
    pages: [
      { label: 'Umumiy', href: '/xarajatlar', description: 'Doimiy, Boshqa va qismlar bir qarashda' },
      { label: 'Doimiy', href: '/xarajatlar/doimiy', description: "Muntazam xarajatlar ro'yxati" },
      { label: 'Boshqa', href: '/xarajatlar/boshqa', description: 'Bir martalik xarajatlar' },
      { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', description: 'Ish haqi vedomostlari' },
      { label: 'Ish haqi tarkibi', href: '/xarajatlar/tarkib', description: "Ish haqi komponentlar bo'yicha" },
      { label: 'Mashinalar', href: '/xarajatlar/mashinalar', description: "Yoqilg'i, ta'mir, probeg" },
      { label: 'Ijara', href: '/xarajatlar/ijara', description: "Ijara shartnomalari va to'lovlar" },
      { label: 'Tahlil', href: '/xarajatlar/tahlil', description: 'Xarajat dinamikasi va tarkibi' },
      { label: 'Yangi xarajat', href: '/xarajatlar/yangi', description: "Xarajat qo'shish", hidden: true },
    ],
  },
  { label: 'Xodimlar', href: '/xodimlar', icon: NavUsers, description: "Xodimlar ro'yxati va ko'chishlar" },
  {
    label: 'Tahlil',
    href: '/tahlil/umumiy',
    match: ['/tahlil'],
    icon: NavPie,
    description: 'Daromad va xarajat qayerdan, nimaga',
    pages: [
      { label: 'Umumiy', href: '/tahlil/umumiy', description: 'Daromad va xarajat qayerdan, nimaga' },
      { label: 'Daromad tahlili', href: '/tahlil/daromad', description: 'Xizmatlar, mijozlar, hududlar' },
      { label: 'Xarajat tahlili', href: '/tahlil/xarajat', description: 'Moddalar, kontragentlar, hududlar' },
    ],
  },
  { label: 'Solishtirma', href: '/solishtirma', icon: NavCompare, description: 'Hududlar va Markaz yonma-yon' },
  { label: 'Modellar', href: '/modellar', icon: NavFormula, description: "Regressiya va o'z formulalaringiz" },
  { label: 'Katta modellar', href: '/katta-modellar', icon: NavLayers, description: 'Prognoz, omillar, samaradorlik, risk' },
  { label: 'Munosabat', href: '/munosabat', icon: NavFlag, description: 'Belgilangan moddalar natijasi' },
  { label: 'Nazorat', href: '/nazorat', icon: NavShield, description: 'Oylik chegaralar va buzilishlar' },
  { label: 'Hisobotlar', href: '/hisobotlar', icon: NavReport, description: 'Excel, PowerPoint, PDF va raqamlar tekshiruvi' },
  {
    label: 'Sozlamalar',
    href: '/sozlamalar',
    icon: NavSettings,
    adminOnly: true,
    pages: [
      { label: 'Xarajat moddalari', href: '/sozlamalar/xarajat' },
      { label: 'Ish haqi komponentlari', href: '/sozlamalar/komponentlar' },
      { label: 'Savat', href: '/sozlamalar/savat' },
      { label: 'Tarix', href: '/sozlamalar/tarix' },
      { label: 'Tekshiruv', href: '/sozlamalar/tekshiruv' },
      { label: 'Zaxira', href: '/sozlamalar/zaxira' },
    ],
  },
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Menyu bandi joriy manzilga tegishlimi */
export function isMenuActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return [item.href, ...(item.match ?? [])].some((prefix) => under(pathname, prefix));
}

/**
 * Yuqori panel uchun zaxira sarlavha: "Xarajatlar › Ish haqi".
 * Sahifa o'zining PageHeader'ini bersa, u ko'rinadi (bu yashiriladi).
 */
export function titleFor(pathname: string): { title: string; parent?: string } {
  const item = MENU.find((m) => isMenuActive(m, pathname));
  if (!item) return { title: 'Korxona tahlil' };
  const page = item.pages
    ?.filter((p) => under(pathname, p.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (page && page.href !== item.href) return { title: page.label, parent: item.label };
  return { title: item.label };
}

/**
 * Bo'lim yorliqlari qatori: joriy manzil tegishli bo'lim va uning ichidagi sahifalar.
 * Ichida bittadan ko'p sahifa bo'lmasa — null (qator chizilmaydi).
 */
export function sectionFor(pathname: string, isAdmin: boolean): { item: NavItem; tabs: NavPage[] } | null {
  const item = MENU.find((m) => (!m.adminOnly || isAdmin) && isMenuActive(m, pathname));
  const tabs = (item?.pages ?? []).filter((p) => !p.hidden);
  if (!item || tabs.length < 2) return null;
  return { item, tabs };
}

/** Yorliq faolmi: aniq manzil (bo'lim "Umumiy"si faqat o'zida) */
export function isTabActive(href: string, pathname: string): boolean {
  return pathname === href;
}

/** Bu yorliqlar bo'lim qatorida allaqachon bormi (sahifa ichidagi takror qatorni yashirish uchun) */
export function coveredBySection(hrefs: string[], pathname: string, isAdmin: boolean): boolean {
  const section = sectionFor(pathname, isAdmin);
  if (!section || hrefs.length === 0) return false;
  const known = new Set(section.tabs.map((t) => t.href));
  return hrefs.every((h) => known.has(h.split('?')[0] ?? h));
}

/** Global qidiruv uchun barcha sahifalar: "Xarajatlar › Ish haqi" */
export function pageIndex(isAdmin: boolean): { trail: string; href: string; description?: string }[] {
  const out: { trail: string; href: string; description?: string }[] = [];
  for (const item of MENU) {
    if (item.adminOnly && !isAdmin) continue;
    if (item.href !== '/sozlamalar') out.push({ trail: item.label, href: item.href, description: item.description });
    for (const page of item.pages ?? []) {
      if (page.href === item.href) continue;
      out.push({ trail: `${item.label} › ${page.label}`, href: page.href, description: page.description });
    }
  }
  return out;
}