'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { errorMessage } from '@/lib/error-message';
import {
  incomesApi,
  downloadIncomesExcel,
  type IncomeFilters,
} from '@/features/incomes/api';
import { IncomeDrawer } from '@/features/incomes/income-drawer';
import { referencesApi } from '@/features/shared/references';
import { currentPeriod, formatDate, formatPeriod } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { PeriodPicker } from '@/components/shared/period-picker';
import { SearchInput } from '@/components/shared/search-input';
import { StatCard } from '@/components/shared/stat-card';
import { Pagination } from '@/components/shared/pagination';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { PaymentBadge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SimpleImportDialog } from '@/components/shared/simple-import-dialog';
import { IconPlus, IconTrendUp, IconEdit, IconTrash, IconUpload, IconDownload } from '@/components/ui/icons';
import type { Income, PaymentStatus } from '@/lib/types';

const PAGE_LIMIT = 25;

const tabs = [
  { href: '/daromadlar', label: "Ro'yxat" },
  { href: '/daromadlar/tahlil', label: 'Tahlil' },
  { href: '/daromadlar/hududlar', label: 'Hududlar' },
  { href: '/daromadlar/natijalar', label: 'Xodim natijalari' },
];

export default function IncomesPage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [departmentId, setDepartmentId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Income | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'selected' | 'filter' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  /** Excel faylni yuklab olish */
  async function handleExport() {
    setExporting(true);
    try {
      await downloadIncomesExcel(filters);
    } catch (err) {
      setToast(errorMessage(err, 'Faylni yuklab bolmadi'));
    } finally {
      setExporting(false);
    }
  }

  /** Bitta qatorni belgilash */
  function toggleOne(id: string) {
    setSelectedIds((state) => {
      const next = new Set(state);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Sahifadagi hammasini belgilash */
  function toggleAll() {
    setSelectedIds((state) =>
      state.size === items.length ? new Set() : new Set(items.map((item) => item.id)),
    );
  }

  /** Tanlangan yoki filtrga mos yozuvlarni ochiradi */
  async function handleBulkDelete() {
    setBulkDeleting(true);

    try {
      const result =
        bulkConfirm === 'filter'
          ? await incomesApi.removeByFilter(filters)
          : await incomesApi.removeMany([...selectedIds]);

      setToast(`${result.data.count} ta yozuv savatga tushdi`);
      setSelectedIds(new Set());
      list.reload();
      comparison.reload();
    } catch (err) {
      setToast(errorMessage(err, 'Ochirishda xatolik'));
    } finally {
      setBulkDeleting(false);
      setBulkConfirm(null);
    }
  }

  const filters: IncomeFilters = {
    period,
    departmentId: departmentId || undefined,
    categoryCode: categoryCode || undefined,
    paymentStatus: (paymentStatus || undefined) as PaymentStatus | undefined,
    search: search || undefined,
    page,
    limit: PAGE_LIMIT,
  };

  const departments = useAsync(() => referencesApi.departments(), []);
  const categories = useAsync(() => referencesApi.incomeCategories(), []);

  const list = useAsync(
    () => incomesApi.list(filters),
    [period, departmentId, categoryCode, paymentStatus, search, page],
  );

  const comparison = useAsync(
    () => incomesApi.comparison(period, departmentId || undefined),
    [period, departmentId],
  );

  const changeFilter = useCallback((setter: () => void) => {
    setter();
    setPage(1);
  }, []);

  const handleSaved = useCallback(
    (message: string) => {
      setToast(message);
      list.reload();
      comparison.reload();
    },
    [list, comparison],
  );

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  const categoryOptions = [
    { value: '', label: 'Barcha xizmatlar' },
    ...(categories.data?.data ?? []).map((item) => ({
      value: item.code,
      label: item.label,
    })),
  ];

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const hasFilters = Boolean(departmentId || categoryCode || paymentStatus || search);

  return (
    <>
      <PageHeader
        title="Daromadlar"
        description={formatPeriod(period)}
        actions={
          isAdmin && (
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

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <IconUpload className="size-4" />
                Yuklash
              </Button>

              <Button size="sm" onClick={() => setCreating(true)}>
                <IconPlus className="size-4" />
                Yangi daromad
              </Button>
            </>
          )
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

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
              value={categoryCode}
              onChange={(event) => changeFilter(() => setCategoryCode(event.target.value))}
              className="h-9"
            />
          </div>

          <div className="w-44">
            <Select
              options={[
                { value: '', label: 'Barcha holatlar' },
                { value: 'PAID', label: "To'langan" },
                { value: 'PARTIAL', label: 'Qisman' },
                { value: 'UNPAID', label: "To'lanmagan" },
              ]}
              value={paymentStatus}
              onChange={(event) => changeFilter(() => setPaymentStatus(event.target.value))}
              className="h-9"
            />
          </div>

          <SearchInput
            value={search}
            onChange={(value) => changeFilter(() => setSearch(value))}
            placeholder="Mijoz, shartnoma, tavsif"
            className="w-64"
          />

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                changeFilter(() => {
                  setDepartmentId('');
                  setCategoryCode('');
                  setPaymentStatus('');
                  setSearch('');
                })
              }
            >
              Tozalash
            </Button>
          )}
        </div>

        {/* Yig'indi */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Jami daromad"
            tiyin={meta?.sumTiyin ?? 0}
            tone="income"
            hint={meta ? `${meta.total} ta yozuv` : undefined}
            icon={<IconTrendUp className="size-4" />}
          />

          <StatCard
            label="Tushgan"
            tiyin={meta?.paidTiyin ?? 0}
            tone="income"
          />

          <StatCard
            label="Debitorlik qarzi"
            tiyin={meta?.receivableTiyin ?? 0}
            tone={Number(meta?.receivableTiyin ?? 0) > 0 ? 'expense' : 'neutral'}
          />

          <StatCard
            label="O'tgan oyga nisbatan"
            tiyin={comparison.data?.data.previous.amountTiyin ?? 0}
            changePercent={comparison.data?.data.previous.changePercent}
            positiveIsGood
            hint={
              comparison.data
                ? formatPeriod(comparison.data.data.previous.period)
                : undefined
            }
          />
        </div>

        {isAdmin && selectedIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-brand-200 bg-brand-50 px-4 py-2.5">
            <span className="text-sm font-medium text-brand-800">
              {selectedIds.size} ta yozuv tanlandi
            </span>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Bekor qilish
              </Button>

              {meta && meta.total > items.length && (
                <Button variant="ghost" size="sm" onClick={() => setBulkConfirm('filter')}>
                  Barcha {meta.total} tasini ochirish
                </Button>
              )}

              <Button variant="danger" size="sm" onClick={() => setBulkConfirm('selected')}>
                <IconTrash className="size-4" />
                Ochirish
              </Button>
            </div>
          </div>
        )}

        {/* Jadval */}
        <Card className="overflow-hidden">
          {list.loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'Hech narsa topilmadi' : "Bu oyda daromad yo'q"}
              description={
                hasFilters
                  ? "Filtrlarni o'zgartirib ko'ring"
                  : isAdmin
                    ? 'Birinchi daromadni kiriting'
                    : undefined
              }
              action={
                !hasFilters && isAdmin ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <IconPlus className="size-4" />
                    Yangi daromad
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    {isAdmin && (
                      <Th className="w-10 pl-4">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && selectedIds.size === items.length}
                          onChange={toggleAll}
                          className="size-4 rounded border-[--color-line-strong]"
                          aria-label="Hammasini belgilash"
                        />
                      </Th>
                    )}

                    <Th className="w-28">Sana</Th>
                    <Th>Xizmat turi</Th>
                    <Th>Mijoz</Th>
                    <Th className="w-44">Bo&apos;lim</Th>
                    <Th className="w-28">Holat</Th>
                    <Th align="right" className="w-40">
                      Summa
                    </Th>
                    <Th className="w-10" />
                  </Tr>
                </THead>

                <TBody>
                  {items.map((income) => (
                    <Tr
                      key={income.id}
                      clickable
                      className="group"
                      onClick={() => setSelected(income)}
                    >
                      {isAdmin && (
                        <Td className="pl-4" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(income.id)}
                            onChange={() => toggleOne(income.id)}
                            className="size-4 rounded border-[--color-line-strong]"
                            aria-label="Belgilash"
                          />
                        </Td>
                      )}

                      <Td className="money whitespace-nowrap text-[--color-text-muted]">
                        {formatDate(income.date)}
                      </Td>

                      <Td>{income.category.label}</Td>

                      <Td className="max-w-xs truncate">
                        {income.clientName ?? '-'}
                        {income.contractNo && (
                          <p className="text-xs text-[--color-text-muted]">
                            {income.contractNo}
                          </p>
                        )}
                      </Td>

                      <Td className="text-[--color-text-muted]">
                        {income.department?.name ?? 'Umumkorxona'}
                      </Td>

                      <Td>
                        {income.paymentStatus !== 'PAID' && (
                          <PaymentBadge status={income.paymentStatus} />
                        )}
                      </Td>

                      <Td money>
                        <Money tiyin={income.amountTiyin} tone="income" />
                        {income.paymentStatus === 'PARTIAL' && (
                          <p className="text-xs text-[--color-text-muted]">
                            <Money tiyin={income.paidTiyin} /> tushgan
                          </p>
                        )}
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

      <IncomeDrawer
        income={selected}
        creating={creating}
        categories={categories.data?.data ?? []}
        departments={departments.data?.data ?? []}
        onClose={() => {
          setSelected(null);
          setCreating(false);
        }}
        onSaved={handleSaved}
        onCategoriesChanged={categories.reload}
      />

      <ConfirmDialog
        open={bulkConfirm !== null}
        title="Yozuvlarni ochirish"
        message={
          bulkConfirm === 'filter'
            ? `Filtrga mos ${meta?.total ?? 0} ta yozuv savatga tushadi. 15 kun ichida tiklash mumkin.`
            : `${selectedIds.size} ta yozuv savatga tushadi. 15 kun ichida tiklash mumkin.`
        }
        confirmLabel="Ochirish"
        danger
        loading={bulkDeleting}
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setBulkConfirm(null)}
      />

      <SimpleImportDialog
        open={importOpen}
        kind="income"
        onClose={() => setImportOpen(false)}
        onImported={(message) => {
          setToast(message);
          list.reload();
          comparison.reload();
        }}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}
