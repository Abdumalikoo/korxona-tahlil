'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { SubTabs, TabPills } from '@/components/ui/tabs';
import { IncomeList } from '@/features/incomes/income-list';
import { formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { unitBySlug, type EntryUnit } from '@/lib/segments';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CompositionWorkspace } from '@/app/(dashboard)/xarajatlar/tarkib/_components/composition-workspace';
import { UnitBankView } from '@/features/unit-bank/unit-bank-view';
import { UnitEntriesView } from '@/features/unit-entries/unit-entries-view';
import { UnitLeaseView } from '@/features/unit-lease/unit-lease-view';
import { UnitPayrollView } from '@/features/unit-payroll/unit-payroll-view';
import { UnitPolicyView } from '@/features/unit-policy/unit-policy-view';
import { UnitCategories } from './unit-categories';
import { unitTabs } from './structure';
import type { EntryKind } from './api';

// ═══════════════════════════════════════════════════════════
// Bo'lim sahifasi: Daromadlar yoki Xarajatlar › Markaz | Hududlar | Tax free | Marksheyder |
// Fermer xo'jaligi | Buxgalteriya xizmatlari. Bo'limlar o'rtasida chap menyu orqali o'tiladi.
//
// Xarajatlar: har bo'lim o'z tarkibiy tuzilmalari bilan (yorliqlar qatori — umumiy Xarajatlar sahifasidagidek).
//   Masalan, Tax free: Ish haqi · Ish haqi tarkibi · Ijara va kommunal · Asosiy vositalar · Bank · Reklama · Boshqa.
//   Hozircha faqat tugmalar — har birining yuklash tartibi va shabloni keyin qo'shiladi.
// Daromadlar: Doimiy / Boshqa / Xizmat turlari (faqat shu bo'lim).
// ═══════════════════════════════════════════════════════════

const BASE: Record<EntryKind, string> = { expense: '/xarajatlar/bolim', income: '/daromadlar/bolim' };
const TITLE: Record<EntryKind, string> = { expense: 'Xarajatlar', income: 'Daromadlar' };
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function UnitLedger({ kind, slug, tab }: { kind: EntryKind; slug: string; tab?: string }) {
  const unit = unitBySlug(slug);
  const { month } = usePeriod();

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

  return (
    <>
      <PageHeader title={`${TITLE[kind]} · ${unit.label}`} description={`${unit.hint} · ${formatPeriod(month)}`} />
      {kind === 'expense' ? <ExpenseUnit unit={unit} tab={tab} /> : <IncomeUnit unit={unit} />}
    </>
  );
}

/** Xarajatlar bo'limi: tuzilmalar qatori + tanlangan tuzilma */
function ExpenseUnit({ unit, tab }: { unit: EntryUnit; tab?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const period = params.get('period');
  const keep = period && PERIOD_RE.test(period) ? `?period=${period}` : '';
  const base = `${BASE.expense}/${unit.slug}`;
  const tabs = unitTabs('expense', unit.code);
  const current = tab ? tabs.find((t) => t.slug === tab) : undefined;

  if (!tabs.length) {
    return (
      <div className="p-4 md:p-6">
        <Card className="px-6 py-12 text-center">
          <p className="text-sm font-semibold text-heading">«{unit.label}» bo&apos;limining tuzilmalari hali belgilanmagan</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">Tuzilmalar (Ish haqi, Ijara va h.k.) ro&apos;yxati berilgach, shu yerda tugmalar chiqadi.</p>
        </Card>
      </div>
    );
  }

  const items = tabs.map((t) => ({ href: `${base}/${t.slug}${keep}`, label: t.label }));

  return (
    <>
      <div className="no-print px-4 pt-5 md:px-6">
        <TabPills items={items} active={(item) => (item.href.split('?')[0] ?? item.href) === pathname} />
      </div>
      <div className="p-4 md:p-6">
        {tab && !current ? (
          <Card className="p-6 text-sm text-(--color-text-muted)">
            Bunday tuzilma yo&apos;q.{' '}
            <Link href={`${base}${keep}`} className="font-semibold text-brand-700 hover:underline">
              «{unit.label}» bo&apos;limiga qaytish
            </Link>
          </Card>
        ) : current?.view === 'payroll' ? (
          <UnitPayrollView unit={unit} />
        ) : current?.view === 'composition' ? (
          <CompositionWorkspace unit={unit} />
        ) : current?.view === 'lease' ? (
          <UnitLeaseView unit={unit} />
        ) : current?.view === 'bank' ? (
          <UnitBankView unit={unit} />
        ) : current?.view === 'policy' ? (
          <UnitPolicyView unit={unit} />
        ) : current?.view === 'entries' && current.entryKind ? (
          <UnitEntriesView key={current.entryKind} unit={unit} kind={current.entryKind} />
        ) : current ? (
          <Card className="px-6 py-14 text-center">
            <p className="text-base font-bold text-heading">{current.label}</p>
            <p className="mt-1 text-sm text-(--color-text-muted)">«{unit.label}» bo&apos;limi</p>
            <p className="mx-auto mt-4 max-w-md text-xs text-(--color-text-muted)">
              Bu tuzilmaning yuklash tartibi va shabloni hali belgilanmagan — tayyor bo&apos;lgach shu yerda ishlaydi.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tabs.map((t, i) => (
              <Link
                key={t.slug}
                href={`${base}/${t.slug}${keep}`}
                className="group flex items-center gap-3 rounded-(--radius-card) bg-white px-4 py-4 shadow-card transition-all hover:-translate-y-px hover:shadow-md"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 group-hover:bg-brand-500 group-hover:text-white">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-heading">{t.label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

type IncomeTab = 'DOIMIY' | 'BOSHQA' | 'MODDALAR';

/** Daromadlar bo'limi: Doimiy / Boshqa / Xizmat turlari */
function IncomeUnit({ unit }: { unit: EntryUnit }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('section');
  const tab: IncomeTab = raw === 'BOSHQA' ? 'BOSHQA' : raw === 'MODDALAR' ? 'MODDALAR' : 'DOIMIY';
  const setTab = (next: IncomeTab) => router.replace(`${BASE.income}/${unit.slug}?section=${next}`, { scroll: false });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SubTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'DOIMIY', label: 'Doimiy', hint: 'Muntazam yozuvlar' },
          { value: 'BOSHQA', label: 'Boshqa', hint: 'Bir martalik yozuvlar' },
          { value: 'MODDALAR', label: 'Xizmat turlari', hint: "Shu bo'limning xizmat turlari" },
        ]}
      />
      {tab === 'MODDALAR' ? <UnitCategories kind="income" unit={unit} /> : <IncomeList key={`${unit.code}-${tab}`} section={tab} unit={unit} />}
    </div>
  );
}