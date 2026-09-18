'use client';

import {
  DateRangePicker,
  defaultRange,
  type DateRange,
} from '@/components/shared/date-range-picker';
import { expensesApi } from '@/features/expenses/api';
import { incomesApi } from '@/features/incomes/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useState } from 'react';

import { IconDashboard, IconTrendUp, IconWallet } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';

export default function DashboardPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<DateRange>(defaultRange);

  const filters = { dateFrom: range.from, dateTo: range.to, limit: 1 };

  const expenses = useAsync(
    () => expensesApi.list(filters),
    [range.from, range.to],
  );
  const incomes = useAsync(
    () => incomesApi.list(filters),
    [range.from, range.to],
  );

  const expenseTotal = expenses.data?.meta.sumTiyin ?? '0';
  const incomeTotal = incomes.data?.meta.sumTiyin ?? '0';
  const profit = String(Number(incomeTotal) - Number(expenseTotal));

  const query = `?dateFrom=${range.from}&dateTo=${range.to}`;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-5xl">
        {/* Davr */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <p className="text-sm text-[--color-text-muted]">{user?.fullName}</p>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        {/* Uchta bo'lim */}
        <div className="grid gap-5 sm:grid-cols-3">
          <SectionCard
            href={`/tahlil/daromad${query}`}
            label="Daromad"
            icon={<IconTrendUp className="size-10" strokeWidth={1.5} />}
            accent="text-[--color-income]"
            hover="hover:border-[--color-income]"
            tiyin={incomeTotal}
            tone="income"
            loading={incomes.loading}
            count={incomes.data?.meta.total}
          />

          <SectionCard
            href={`/tahlil/xarajat${query}`}
            label="Xarajat"
            icon={<IconWallet className="size-10" strokeWidth={1.5} />}
            accent="text-[--color-expense]"
            hover="hover:border-[--color-expense]"
            tiyin={expenseTotal}
            tone="expense"
            loading={expenses.loading}
            count={expenses.data?.meta.total}
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
          />
        </div>
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
}: {
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
      className={`group flex flex-col items-center justify-center gap-3 rounded-[--radius-card] border border-[--color-line] bg-white py-12 transition-all hover:shadow-md ${hover}`}
    >
      <div className={`transition-transform group-hover:scale-110 ${accent}`}>
        {icon}
      </div>

      <span className="text-xl font-semibold text-[--color-text]">{label}</span>

      {loading ? (
        <span className="h-7 w-32 animate-pulse rounded bg-[--color-surface-sunken]" />
      ) : (
        <Money tiyin={tiyin} tone={tone} className="text-lg font-semibold" />
      )}

      <span className="text-xs text-[--color-text-faint]">
        {hint ?? (count !== undefined ? `${count} ta yozuv` : '')}
      </span>
    </Link>
  );
}
