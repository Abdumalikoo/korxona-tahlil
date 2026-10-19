'use client';

import { TabPills } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { usePathname, useSearchParams } from 'next/navigation';
import { isTabActive, sectionFor } from './nav-config';

// ═══════════════════════════════════════════════════════════
// Bo'lim yorliqlari qatori — yuqori panel tagida, har bir ichki sahifada bir xil.
// Masalan, Xarajatlar: Umumiy · Doimiy · Boshqa · Ish haqi · … · Tahlil.
// Istalgan yorliqdan istalganiga to'g'ridan-to'g'ri o'tiladi — orqaga qaytish shart emas.
// Tanlangan oy (?period=) yorliqdan yorliqqa o'tganda saqlanib qoladi.
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function SectionBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const section = sectionFor(pathname, isAdmin);
  if (!section) return null;

  const period = searchParams.get('period');
  const keep = period && PERIOD_RE.test(period) && section.item.href !== '/sozlamalar' ? `?period=${period}` : '';
  const items = section.tabs.map((tab) => ({ href: `${tab.href}${keep}`, label: tab.label }));

  return (
    <div className="no-print px-4 pt-5 md:px-6">
      <TabPills items={items} active={(item) => isTabActive(item.href.split('?')[0] ?? item.href, pathname)} />
    </div>
  );
}