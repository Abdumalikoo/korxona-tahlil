'use client';

import { TabPills } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isTabActive, sectionFor, SIDEBAR_HREFS } from './nav-config';

// ═══════════════════════════════════════════════════════════
// Bo'lim yorliqlari qatori — yuqori panel tagida, har bir ichki sahifada bir xil.
// Masalan, Xarajatlar: Umumiy · Doimiy · Boshqa · Ish haqi xarajatlari · … · Tahlil.
// Ichma-ich guruhlar (NavPage.group): guruh — bitta yorliq (bosilsa — birinchi sahifasi),
// guruh ichidagi sahifa ochiq bo'lsa — tagida ikkinchi qator: guruhning hamma sahifalari.
// Tanlangan oy (?period=) yorliqdan yorliqqa o'tganda saqlanib qoladi.
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function SectionBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const section = sectionFor(pathname, isAdmin);
  if (!section) return null;
  // Bo'lim sahifalari (Daromadlar/Xarajatlar › Markaz, Hududlar, Tax free …) — alohida hudud: umumiy yorliqlar qatori yo'q
  if (/^\/(daromadlar|xarajatlar)\/bolim(\/|$)/.test(pathname)) return null;

  // Navigatsiya — yon panel orqali: yon panelda bor sahifalar tepada takrorlanmaydi (masalan, Bosh sahifa › Hududlar);
  // tepada faqat yon panelda yo'q ichki sahifalar qoladi. Hech biri qolmasa — qator ko'rsatilmaydi.
  const tabsLeft = section.tabs.filter((t) => !SIDEBAR_HREFS.has(t.href));
  if (!tabsLeft.length) return null;

  const period = searchParams.get('period');
  const keep = period && PERIOD_RE.test(period) && section.item.href !== '/sozlamalar' ? `?period=${period}` : '';

  // Birinchi qator: guruhsiz sahifalar va har guruhdan bitta yorliq (birinchi sahifasi o'rnida)
  const groups = new Map<string, { href: string; label: string }[]>();
  for (const tab of tabsLeft) if (tab.group) groups.set(tab.group, [...(groups.get(tab.group) ?? []), { href: tab.href, label: tab.label }]);
  const items: { href: string; label: string; group?: string }[] = [];
  const seen = new Set<string>();
  for (const tab of tabsLeft) {
    if (!tab.group) items.push({ href: `${tab.href}${keep}`, label: tab.label });
    else if (!seen.has(tab.group)) {
      seen.add(tab.group);
      items.push({ href: `${tab.href}${keep}`, label: `${tab.group} ▾`, group: tab.group });
    }
  }
  const activeGroup = tabsLeft.find((t) => t.group && isTabActive(t.href, pathname))?.group ?? null;
  const children = activeGroup ? (groups.get(activeGroup) ?? []) : [];

  return (
    <div className="no-print space-y-2.5 px-4 pt-5 md:px-6">
      <TabPills
        items={items}
        active={(item) => {
          const g = items.find((x) => x.href === item.href)?.group;
          return g ? g === activeGroup : isTabActive(item.href.split('?')[0] ?? item.href, pathname);
        }}
      />
      {children.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2 rounded-xl bg-white/70 p-1.5 shadow-card" aria-label={activeGroup ?? ''}>
          <span className="px-2 text-xs font-bold uppercase tracking-wide text-brand-700">{activeGroup}:</span>
          {children.map((c) => {
            const on = isTabActive(c.href, pathname);
            return (
              <Link
                key={c.href}
                href={`${c.href}${keep}`}
                aria-current={on ? 'page' : undefined}
                className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors', on ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-300' : 'font-medium text-heading hover:bg-brand-50 hover:text-brand-700')}
              >
                {c.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
