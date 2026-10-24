'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { SubTabs } from '@/components/ui/tabs';
import { ExpenseList } from '@/features/expenses/expense-list';
import { IncomeList } from '@/features/incomes/income-list';
import { formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { ENTRY_UNITS, unitBySlug } from '@/lib/segments';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { UnitCategories } from './unit-categories';
import type { EntryKind } from './api';

// ═══════════════════════════════════════════════════════════
// Kiritish bo'limi sahifasi: Daromadlar yoki Xarajatlar › Markaz | Hududlar | Tax free | Marksheyder |
// Fermer xo'jaligi | Buxgalteriya xizmatlari.
// Ichida: Doimiy va Boshqa yozuvlar (faqat shu bo'lim), «Moddalar» — shu bo'limning o'z moddalar ro'yxati.
// ═══════════════════════════════════════════════════════════

type Tab = 'DOIMIY' | 'BOSHQA' | 'MODDALAR';

const BASE: Record<EntryKind, string> = { expense: '/xarajatlar/bolim', income: '/daromadlar/bolim' };
const TITLE: Record<EntryKind, string> = { expense: 'Xarajatlar', income: 'Daromadlar' };

export function UnitLedger({ kind, slug }: { kind: EntryKind; slug: string }) {
  const unit = unitBySlug(slug);
  const router = useRouter();
  const params = useSearchParams();
  const { month } = usePeriod();
  const raw = params.get('section');
  const tab: Tab = raw === 'BOSHQA' ? 'BOSHQA' : raw === 'MODDALAR' ? 'MODDALAR' : 'DOIMIY';

  if (!unit) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-(--color-text-muted)">
          Bunday bo&apos;lim yo&apos;q.{' '}
          <Link href={`${BASE[kind]}/markaz`} className="font-semibold text-brand-700 hover:underline">
            Markazga o&apos;tish
          </Link>
        </Card>
      </div>
    );
  }

  const setTab = (next: Tab) => router.replace(`${BASE[kind]}/${unit.slug}?section=${next}`, { scroll: false });

  return (
    <>
      <PageHeader title={`${TITLE[kind]} · ${unit.label}`} description={`${unit.hint} — faqat shu bo'lim yozuvlari va moddalari · ${formatPeriod(month)}`} />

      <div className="space-y-4 p-4 md:p-6">
        {/* Bo'limlar: bir bosishda boshqasiga */}
        <nav aria-label="Bo'limlar" className="flex flex-wrap gap-1.5">
          {ENTRY_UNITS.map((u) => (
            <Link
              key={u.code}
              href={`${BASE[kind]}/${u.slug}?section=${tab}`}
              aria-current={u.code === unit.code ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                u.code === unit.code ? 'border-brand-600 bg-brand-600 text-white shadow-sm' : 'border-(--color-line) bg-white text-heading hover:border-brand-300 hover:bg-brand-50',
              )}
            >
              {u.label}
            </Link>
          ))}
        </nav>

        <SubTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'DOIMIY', label: 'Doimiy', hint: 'Muntazam yozuvlar' },
            { value: 'BOSHQA', label: 'Boshqa', hint: 'Bir martalik yozuvlar' },
            { value: 'MODDALAR', label: kind === 'expense' ? 'Moddalar' : 'Xizmat turlari', hint: "Shu bo'limda ishlatiladigan moddalar ro'yxati" },
          ]}
        />

        {tab === 'MODDALAR' ? (
          <UnitCategories kind={kind} unit={unit} />
        ) : kind === 'expense' ? (
          <ExpenseList key={`${unit.code}-${tab}`} section={tab} unit={unit} />
        ) : (
          <IncomeList key={`${unit.code}-${tab}`} section={tab} unit={unit} />
        )}
      </div>
    </>
  );
}