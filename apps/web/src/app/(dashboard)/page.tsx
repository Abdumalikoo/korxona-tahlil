'use client';

import { expensesApi } from '@/features/expenses/api';
import { SetupChecklist } from '@/features/entries/setup-checklist';
import type { MarkItem } from '@/features/reactions/api';
import { Mark } from '@/features/reactions/mark';
import { controlsApi, reactionsApi } from '@/features/reactions/api';
import { incomesApi } from '@/features/incomes/api';
import { useAuth } from '@/lib/auth-context';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { useAsOf, usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { BriefNote, useBrief } from '@/lib/view-mode';
import { CalcButton } from '@/components/ui/calc';
import { calcRecords, calcResult, type Calc } from '@/lib/calc';
import { formatDate } from '@/lib/format';
import Link from 'next/link';

import { IconDashboard, IconTrendUp, IconWallet } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { AlertsPreview } from '@/features/alerts/alerts-view';

export default function DashboardPage() {
  const { user } = useAuth();
  /** Qisqa (rahbar) rejimi: uchta kartochka va eng jiddiy 3 ta ogohlantirish */
  const brief = useBrief();
  /** Davr — yuqori paneldagi «Davr» tugmasidan (hamma bo'lim uchun bitta) */
  const { range } = usePeriod();

  const filters = { dateFrom: range.from, dateTo: range.to, limit: 1 };

  const expenses = useAsync(() => expensesApi.list(filters), [range.from, range.to]);
  const incomes = useAsync(() => incomesApi.list(filters), [range.from, range.to]);

  const expenseTotal = expenses.data?.meta.sumTiyin ?? '0';
  const incomeTotal = incomes.data?.meta.sumTiyin ?? '0';
  const profit = String(Number(incomeTotal) - Number(expenseTotal));

  const query = `?dateFrom=${range.from}&dateTo=${range.to}`;

  // «Qanday hisoblandi?»
  const periodText = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  const incomeCalc = calcRecords('Daromad', incomeTotal, incomes.data?.meta.total, periodText, "Daromadlar ro'yxati");
  const expenseCalc = calcRecords('Xarajat', expenseTotal, expenses.data?.meta.total, periodText, "Xarajatlar ro'yxati");
  const profitCalc = calcResult(incomeTotal, expenseTotal, { title: 'Foyda', note: periodText });

  // Munosabat: ochiq va muddati tugaganlar
  const reactions = useAsync(() => reactionsApi.list('OPEN').then((r) => r.data), []);
  const openCount = reactions.data?.length ?? 0;
  const overdueCount = reactions.data?.filter((r) => r.overdue).length ?? 0;
  const worseCount = reactions.data?.reduce((s, r) => s + r.worse, 0) ?? 0;

  // Nazorat: faol qoidalar holati
  const asOf = useAsOf();
  const controls = useAsync(() => controlsApi.list(asOf).then((r) => r.data.filter((c) => c.isActive)), [asOf]);
  const controlCount = controls.data?.length ?? 0;
  const breachCount = controls.data?.filter((c) => c.status === 'breach').length ?? 0;
  const riskCount = controls.data?.filter((c) => c.status === 'risk').length ?? 0;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-5xl">
        {/* Yangi dastur: nimani qaysi tartibda to'ldirish (faqat administrator, hammasi bajarilguncha) */}
        <SetupChecklist className="mb-6" />
        <div className="mb-8 flex flex-col items-center gap-3">
          <p className="text-sm text-(--color-text-muted)">{user?.fullName}</p>
          <p className="money text-xs text-(--color-text-faint)">{periodText}</p>
        </div>

        <PeriodDataHint className="mb-5" />
        <BriefNote className="mb-5" shows="Daromad, xarajat, foyda va eng jiddiy 3 ta ogohlantirish" hidden="Munosabat va Nazorat holati, hamma ogohlantirishlar" />
        <div className="grid gap-5 sm:grid-cols-3">
          <SectionCard
            href={`/tahlil/daromad${query}`}
            label="Daromad"
            icon={<IconTrendUp className="size-10" strokeWidth={1.5} />}
            accent="text-(--color-income)"
            hover="hover:border-(--color-income)"
            tiyin={incomeTotal}
            tone="income"
            loading={incomes.loading}
            count={incomes.data?.meta.total}
            mark={{ kind: 'INCOME', label: 'Barcha daromadlar', filter: {}, origin: 'Bosh sahifa' }}
            calc={incomeCalc}
          />

          <SectionCard
            href={`/tahlil/xarajat${query}`}
            label="Xarajat"
            icon={<IconWallet className="size-10" strokeWidth={1.5} />}
            accent="text-(--color-expense)"
            hover="hover:border-(--color-expense)"
            tiyin={expenseTotal}
            tone="expense"
            loading={expenses.loading}
            count={expenses.data?.meta.total}
            mark={{ kind: 'EXPENSE', label: 'Barcha xarajatlar', filter: {}, origin: 'Bosh sahifa' }}
            calc={expenseCalc}
          />

          <SectionCard
            href={`/tahlil/umumiy${query}`}
            label="Tahlil"
            icon={<IconDashboard className="size-10" strokeWidth={1.5} />}
            accent="text-brand-700"
            hover="hover:border-brand-600"
            tiyin={profit}
            tone="auto"
            loading={expenses.loading || incomes.loading}
            hint="Foyda"
            mark={{ kind: 'RESULT', label: 'Korxona natijasi (foyda)', filter: {}, origin: 'Bosh sahifa' }}
            calc={profitCalc}
          />
        </div>

        {!brief && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Link
            href="/munosabat"
            className="group flex items-center gap-5 rounded-(--radius-card) border border-(--color-line) bg-white px-6 py-5 transition-all hover:border-amber-500 hover:shadow-md"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-2xl font-semibold text-amber-700 transition-transform group-hover:scale-110">
              +
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-(--color-text)">Munosabat</span>
              <span className="block text-sm text-(--color-text-muted)">
                {reactions.loading
                  ? 'Yuklanmoqda…'
                  : openCount === 0
                    ? "Ochiq munosabat yo'q — tepadagi «+ Munosabat» bilan boshlang"
                    : `${openCount} ta ochiq${overdueCount ? ` · ${overdueCount} tasining muddati tugagan` : ''}${worseCount ? ` · ${worseCount} ta modda yomonlashgan` : ''}`}
              </span>
            </span>
          </Link>

          <Link
            href="/nazorat"
            className="group flex items-center gap-5 rounded-(--radius-card) border border-(--color-line) bg-white px-6 py-5 transition-all hover:border-slate-700 hover:shadow-md"
          >
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold transition-transform group-hover:scale-110 ${
                breachCount ? 'bg-(--color-expense-soft) text-(--color-expense)' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {breachCount || '✓'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-(--color-text)">Nazorat</span>
              <span className="block text-sm text-(--color-text-muted)">
                {controls.loading
                  ? 'Yuklanmoqda…'
                  : controlCount === 0
                    ? "Nazoratda modda yo'q"
                    : `${controlCount} ta modda · ${breachCount ? `${breachCount} tasida chegara buzilgan` : 'hammasi chegara ichida'}${riskCount ? ` · ${riskCount} tasi xavf ostida` : ''}`}
              </span>
            </span>
          </Link>
        </div>
        )}

        {/* Tizim o'zi topgan, muhokama talab qiladigan holatlar */}
        <AlertsPreview limit={brief ? 3 : 5} className="mt-5" />
      </div>
    </div>
  );
}

function SectionCard({
  href,
  label,
  icon,
  accent,
  hover,
  tiyin,
  tone,
  loading,
  count,
  hint,
  mark,
  calc,
}: {
  /** «Qanday hisoblandi?» — chap yuqori burchakdagi ƒx */
  calc?: Calc | null;
  /** Munosabat belgisi (belgilash rejimida ko'rinadi) */
  mark?: MarkItem;
  href: string;
  label: string;
  icon: React.ReactNode;
  accent: string;
  hover: string;
  tiyin: string;
  tone: 'income' | 'expense' | 'auto';
  loading: boolean;
  count?: number;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col items-center justify-center gap-3 rounded-(--radius-card) border border-(--color-line) bg-white py-12 transition-all hover:shadow-md ${hover}`}
    >
      {calc && !loading && (
        <span className="absolute left-3 top-3">
          <CalcButton calc={calc} />
        </span>
      )}
      {mark && (
        <span className="absolute right-3 top-3">
          <Mark item={mark} label="Belgilash" />
        </span>
      )}
      <div className={`transition-transform group-hover:scale-110 ${accent}`}>
        {icon}
      </div>

      <span className="text-xl font-semibold text-(--color-text)">{label}</span>

      {loading ? (
        <span className="h-7 w-32 animate-pulse rounded bg-(--color-surface-sunken)" />
      ) : (
        <Money tiyin={tiyin} tone={tone} className="text-lg font-semibold" />
      )}

      <span className="text-xs text-(--color-text-faint)">
        {hint ?? (count !== undefined ? `${count} ta yozuv` : '')}
      </span>
    </Link>
  );
}