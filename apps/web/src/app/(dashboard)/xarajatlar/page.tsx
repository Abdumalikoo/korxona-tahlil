'use client';

import { expensesApi, downloadExpensesExcel, type ExpenseFilters, type SortField, type SortOrder } from '@/features/expenses/api';
import { ExpenseDrawer } from '@/features/expenses/expense-drawer';
import { referencesApi } from '@/features/shared/references';
import { useAuth } from '@/lib/auth-context';
import { currentPeriod, formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from '@/components/shared/pagination';
import { PeriodPicker } from '@/components/shared/period-picker';
import { SearchInput } from '@/components/shared/search-input';
import { StatCard } from '@/components/shared/stat-card';
import { BehaviorBadge, PaymentBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconPlus, IconWallet, IconDownload, IconEdit } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { SortableTh } from '@/components/ui/sortable-th';
import { Toast } from '@/components/ui/toast';
import type { Expense, PaymentStatus } from '@/lib/types';

const PAGE_LIMIT = 25;

export default function ExpensesPage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [departmentId, setDepartmentId] = useState('');
  const [rootCategoryCode, setRootCategoryCode] = useState('');
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Expense | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  /** Ustun sarlavhasi bosilganda tartibni almashtiradi */
  function handleSort(field: string) {
    const next = field as SortField;
    if (sortBy === next) {
      setSortOrder((state) => (state === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(next);
      setSortOrder('desc');
    }
    setPage(1);
  }

  /** Excel faylni yuklab olish */
  async function handleExport() {
    setExporting(true);
    try {
      await downloadExpensesExcel(filters);
    } catch {
      setToast('Faylni yuklab bo‘lmadi');
    } finally {
      setExporting(false);
    }
  }

  const filters: ExpenseFilters = {
    period,
    departmentId: departmentId || undefined,
    rootCategoryCode: rootCategoryCode || undefined,
    paymentStatus: (paymentStatus || undefined) as PaymentStatus | undefined,
    search: search || undefined,
    page,
    limit: PAGE_LIMIT,
    sortBy,
    sortOrder,
  };

  // Malumotnomalar bir marta yuklanadi
  const departments = useAsync(() => referencesApi.departments(), []);
  const categoryTree = useAsync(() => referencesApi.expenseTree(), []);
  const categoryLeaves = useAsync(() => referencesApi.expenseLeaves(), []);

  const list = useAsync(
    () => expensesApi.list(filters),
    [period, departmentId, rootCategoryCode, paymentStatus, search, page, sortBy, sortOrder],
  );

  const comparison = useAsync(
    () => expensesApi.comparison(period, departmentId || undefined),
    [period, departmentId],
  );

  /** Filtr ozgarganda birinchi sahifaga qaytamiz */
  const changeFilter = useCallback((setter: () => void) => {
    setter();
    setPage(1);
  }, []);

  /** Panel yopilgach royxat va yigindilarni yangilaymiz */
  const handleSaved = useCallback(
    (message: string) => {
      setToast(message);
      list.reload();
      comparison.reload();
    },
    [list, comparison],
  );

  const departmentOptions = [
    { value: '', label: 'Barcha bo‘limlar' },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  const categoryOptions = [
    { value: '', label: 'Barcha kategoriyalar' },
    ...(categoryTree.data?.data ?? []).map((item) => ({
      value: item.code,
      label: item.label,
    })),
  ];

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const hasFilters = Boolean(departmentId || rootCategoryCode || paymentStatus || search);

  return (
    <>
      <PageHeader
        title="Xarajatlar"
        description={formatPeriod(period)}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExport()}
              loading={exporting}
              disabled={items.length === 0}
            >
              <IconDownload className="size-4" />
              Excel
            </Button>

            {isAdmin && (
              <Link href="/xarajatlar/yangi">
                <Button size="sm">
                  <IconPlus className="size-4" />
                  Yangi xarajat
                </Button>
              </Link>
            )}
          </>
        }
      />

      <Tabs
        items={[
          { href: '/xarajatlar', label: 'Ro‘yxat' },
          { href: '/xarajatlar/tahlil', label: 'Tahlil' },
          { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
        ]}
        className="bg-white px-6"
      />

      <div className="space-y-4 p-6">
        {/* Filtrlar */}
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker
            value={period}
            onChange={(value) => changeFilter(() => setPeriod(value))}
          />

          <div className="w-48">
            <Select
              options={departmentOptions}
              value={departmentId}
              onChange={(event) => changeFilter(() => setDepartmentId(event.target.value))}
              className="h-9"
            />
          </div>

          <div className="w-52">
            <Select
              options={categoryOptions}
              value={rootCategoryCode}
              onChange={(event) =>
                changeFilter(() => setRootCategoryCode(event.target.value))
              }
              className="h-9"
            />
          </div>

          <div className="w-44">
            <Select
              options={[
                { value: '', label: 'Barcha holatlar' },
                { value: 'PAID', label: 'To‘langan' },
                { value: 'UNPAID', label: 'To‘lanmagan' },
                { value: 'PARTIAL', label: 'Qisman' },
              ]}
              value={paymentStatus}
              onChange={(event) => changeFilter(() => setPaymentStatus(event.target.value))}
              className="h-9"
            />
          </div>

          <SearchInput
            value={search}
            onChange={(value) => changeFilter(() => setSearch(value))}
            placeholder="Tavsif, kontragent, hujjat"
            className="w-64"
          />

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                changeFilter(() => {
                  setDepartmentId('');
                  setRootCategoryCode('');
                  setPaymentStatus('');
                  setSearch('');
                })
              }
            >
              Tozalash
            </Button>
          )}
        </div>

        {/* Yigindi */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Jami xarajat"
            tiyin={meta?.sumTiyin ?? 0}
            tone="expense"
            hint={meta ? `${meta.total} ta yozuv` : undefined}
            icon={<IconWallet className="size-4" />}
          />

          <StatCard
            label="O‘tgan oyga nisbatan"
            tiyin={comparison.data?.data.previous.amountTiyin ?? 0}
            changePercent={comparison.data?.data.previous.changePercent}
            positiveIsGood={false}
            hint={
              comparison.data
                ? formatPeriod(comparison.data.data.previous.period)
                : undefined
            }
          />

          <StatCard
            label="O‘tgan yilning shu oyi"
            tiyin={comparison.data?.data.lastYear.amountTiyin ?? 0}
            changePercent={comparison.data?.data.lastYear.changePercent}
            positiveIsGood={false}
            hint={
              comparison.data
                ? formatPeriod(comparison.data.data.lastYear.period)
                : undefined
            }
          />

          <StatCard
            label="To‘lanmagan"
            tiyin={meta?.unpaidTiyin ?? 0}
            tone={Number(meta?.unpaidTiyin ?? 0) > 0 ? 'expense' : 'neutral'}
             hint={meta ? `${meta.unpaidCount} ta yozuv` : undefined}
          />
        </div>

        {/* Jadval */}
        <Card className="overflow-hidden">
          {list.loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'Hech narsa topilmadi' : 'Bu oyda xarajat yo‘q'}
              description={
                hasFilters
                  ? 'Filtrlarni o‘zgartirib ko‘ring'
                  : isAdmin
                    ? 'Birinchi xarajatni kiriting'
                    : undefined
              }
              action={
                !hasFilters && isAdmin ? (
                  <Link href="/xarajatlar/yangi">
                    <Button size="sm">
                      <IconPlus className="size-4" />
                      Yangi xarajat
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <SortableTh
                      field="date"
                      activeField={sortBy}
                      activeOrder={sortOrder}
                      onSort={handleSort}
                      className="w-28"
                    >
                      Sana
                    </SortableTh>

                    <SortableTh
                      field="categoryCode"
                      activeField={sortBy}
                      activeOrder={sortOrder}
                      onSort={handleSort}
                    >
                      Kategoriya
                    </SortableTh>

                    <Th className="w-44">Bo‘lim</Th>
                    <Th>Tavsif</Th>
                    <Th className="w-28">Holat</Th>

                    <SortableTh
                      field="amountTiyin"
                      activeField={sortBy}
                      activeOrder={sortOrder}
                      onSort={handleSort}
                      align="right"
                      className="w-40"
                    >
                      Summa
                    </SortableTh>

                    <Th className="w-10" />
                  </Tr>
                </THead>

                <TBody>
                  {items.map((expense) => (
                    <Tr key={expense.id} clickable className="group" onClick={() => setSelected(expense)}>
                      <Td className="money whitespace-nowrap text-[--color-text-muted]">
                        {formatDate(expense.date)}
                      </Td>

                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{expense.category.label}</span>
                          {expense.category.behavior && (
                            <BehaviorBadge behavior={expense.category.behavior} />
                          )}
                        </div>
                      </Td>

                      <Td className="text-[--color-text-muted]">
                        {expense.department?.name ?? 'Umumkorxona'}
                      </Td>

                      <Td className="max-w-xs truncate text-[--color-text-muted]">
                        {expense.description ?? expense.counterparty ?? '-'}
                      </Td>

                      <Td>
                        {expense.paymentStatus !== 'PAID' && (
                          <PaymentBadge status={expense.paymentStatus} />
                        )}
                      </Td>

                      <Td money>
                        <Money tiyin={expense.amountTiyin} tone="expense" />
                      </Td>

                      <Td className="pr-3 text-right">
                        <IconEdit className="ml-auto size-4 text-[--color-text-faint] opacity-0 transition-opacity group-hover:opacity-100" />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              {meta && (
                <Pagination
                  page={meta.page}
                  totalPages={meta.totalPages}
                  total={meta.total}
                  limit={meta.limit}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </Card>
      </div>

      <ExpenseDrawer
        expense={selected}
        categories={categoryLeaves.data?.data ?? []}
        departments={departments.data?.data ?? []}
        onClose={() => setSelected(null)}
        onSaved={handleSaved}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}
