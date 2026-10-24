'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { useMonthChange, usePeriod } from '@/lib/period';
import { downloadIncomesExcel, incomesApi, type IncomeFilters } from '@/features/incomes/api';
import { IncomeDrawer } from '@/features/incomes/income-drawer';
import { Mark } from '@/features/reactions/mark';
import { categoryMark, clientMark, recordMark } from '@/features/reactions/marks';
import { moveMessage, otherSection, SECTION_LABELS, sectionsApi, type SectionValue } from '@/features/sections/api';
import { SectionTabs } from '@/features/sections/section-tabs';
import { referencesApi } from '@/features/shared/references';
import { useAuth } from '@/lib/auth-context';
import { placeText, type EntryUnit } from '@/lib/segments';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from '@/components/shared/pagination';
import { SearchInput } from '@/components/shared/search-input';
import { SimpleImportDialog } from '@/components/shared/simple-import-dialog';
import { StatCard } from '@/components/shared/stat-card';
import { Badge, PaymentBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconArrowRight, IconEdit, IconPlus, IconTrendUp } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import type { Income, PaymentStatus } from '@/lib/types';

const PAGE_LIMIT = 25;

/** Hududlar tushumi va Markaz tushumi (fayldan / kunlik ma'lumotnomadan) — bu yerda o'zgartirilmaydi */
function isLocked(income: Income): boolean {
  return income.source === 'IMPORT' && income.regionCode !== null && income.regionCode !== undefined;
}

/**
 * Daromadlar ro'yxati — bitta bo'lim (Doimiy yoki Boshqa) uchun.
 * Boshqa bo'limdagi yozuvlar bu yerda umuman ko'rinmaydi.
 */
export function IncomeList({ section, unit = null }: { section: SectionValue; unit?: EntryUnit | null }) {
  const { isAdmin } = useAuth();
  /** Bo'lim sahifasida (Markaz, Hududlar, Tax free …): faqat shu bo'lim yozuvlari */
  const showDepartment = !unit || unit.code === 'CENTER';
  const searchParams = useSearchParams();

  const target = otherSection(section);

  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period } = usePeriod();
  const [departmentId, setDepartmentId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  // Global qidiruvdan kelganda (?q=...) qidiruv so'zi tayyor turadi
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Income | null>(null);
  // «+ Kiritish» dan kelganda (?new=1 / ?import=1) oyna darhol ochiladi
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'selected' | 'filter' | null>(null);
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1');
  const [exporting, setExporting] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);

  const filters: IncomeFilters = {
    period,
    section,
    ...(unit ? { unit: unit.code } : {}),
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
    [section, unit?.code, period, departmentId, categoryCode, paymentStatus, search, page],
  );

  const overview = useAsync(() => sectionsApi.overview('income', period), [period]);
  const summary = overview.data?.data.sections.find((s) => s.section === section);

  const reloadAll = useCallback(() => {
    list.reload();
    overview.reload();
  }, [list, overview]);

  // Oy almashganda — birinchi sahifaga
  useMonthChange(period, () => setPage(1));

  /** Excel faylni yuklab olish */
  async function handleExport() {
    setExporting(true);
    try {
      await downloadIncomesExcel(filters);
    } catch (err) {
      setToast(errorMessage(err, 'Faylni yuklab bo‘lmadi'));
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

  /** Tanlangan yoki filtrga mos yozuvlarni o'chiradi */
  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      const result =
        bulkConfirm === 'filter'
          ? await incomesApi.removeByFilter(filters)
          : await incomesApi.removeMany([...selectedIds]);

      setToast(`${result.data.count} ta yozuv savatga tushdi`);
      setSelectedIds(new Set());
      reloadAll();
    } catch (err) {
      setToast(errorMessage(err, 'O‘chirishda xatolik'));
    } finally {
      setBulkDeleting(false);
      setBulkConfirm(null);
    }
  }

  /** Boshqa bo'limga o'tkazish — tanlanganlar yoki bitta qator */
  async function handleMove(ids: string[], key: string) {
    if (ids.length === 0) return;
    setMoving(key);
    try {
      const result = await sectionsApi.move('income', ids, target);
      setToast(moveMessage(result.data));
      setSelectedIds(new Set());
      reloadAll();
    } catch (err) {
      setToast(errorMessage(err, 'O‘tkazib bo‘lmadi'));
    } finally {
      setMoving(null);
    }
  }

  const changeFilter = useCallback((setter: () => void) => {
    setter();
    setPage(1);
  }, []);

  const handleSaved = useCallback(
    (message: string) => {
      setToast(message);
      reloadAll();
    },
    [reloadAll],
  );

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];

  const categoryOptions = [
    { value: '', label: 'Barcha xizmatlar' },
    ...(categories.data?.data ?? []).map((item) => ({ value: item.code, label: item.label })),
  ];

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const hasFilters = Boolean(departmentId || categoryCode || paymentStatus || search);
  const movableSelected = items.filter((item) => selectedIds.has(item.id) && !isLocked(item));

  return (
    <>
      {!unit && (
        <>
          <PageHeader
            title="Daromadlar"
            description={`${SECTION_LABELS[section]} · ${formatPeriod(period)}`}
          />

          <SectionTabs kind="income" section={section} />
        </>
      )}

      <div className={unit ? 'space-y-4' : 'space-y-4 p-6'}>
        {/* Amallar: qo'shish, yuklash, yuklab olish, o'chirish — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          add={{ label: 'Yangi daromad', onClick: () => setCreating(true) }}
          // Bo'lim sahifasida Excel yuklash yo'q: yuklangan yozuvlarda joy (Markaz/hudud/yo'nalish) bo'lmaydi
          {...(unit ? {} : { upload: { label: "Excel'dan yuklash", onClick: () => setImportOpen(true), hint: 'Shablon yuklash oynasining ichida' } })}
          download={{ label: "Excel'ga yuklab olish", onClick: () => void handleExport(), loading: exporting, disabled: items.length === 0 }}
          {...(unit ? {} : { deleteData: {
            target: 'INCOME',
            scope: { section },
            selectedIds: [...selectedIds],
            month: period,
            place: `Daromadlar › ${SECTION_LABELS[section]}`,
            onDone: ({ count }: { count: number }) => {
              setToast(`${count} ta yozuv savatga tushdi`);
              setSelectedIds(new Set());
              reloadAll();
            },
          } })}
        />

        {/* Filtrlar */}
        <div className="flex flex-wrap items-center gap-3">
          {showDepartment && (
            <div className="w-48">
              <Select
                options={departmentOptions}
                value={departmentId}
                onChange={(event) => changeFilter(() => setDepartmentId(event.target.value))}
                className="h-9"
              />
            </div>
          )}

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
            label={hasFilters ? 'Filtr bo‘yicha' : unit ? `${unit.label} · ${SECTION_LABELS[section].toLowerCase()}` : `${SECTION_LABELS[section]} daromad`}
            tiyin={meta?.sumTiyin ?? 0}
            tone="income"
            hint={meta ? `${meta.total} ta yozuv` : undefined}
            icon={<IconTrendUp className="size-4" />}
          />

          <StatCard label="Tushgan" tiyin={meta?.paidTiyin ?? 0} tone="income" />

          <StatCard
            label="Debitorlik qarzi"
            tiyin={meta?.receivableTiyin ?? 0}
            tone={Number(meta?.receivableTiyin ?? 0) > 0 ? 'expense' : 'neutral'}
          />

          {!unit && (
            <StatCard
              label="O'tgan oyga nisbatan"
              tiyin={summary?.previousTiyin ?? 0}
              changePercent={summary?.previousChange}
              positiveIsGood
              hint={overview.data ? formatPeriod(overview.data.data.previousPeriod) : undefined}
            />
          )}
        </div>

        {/* Tanlanganlar bilan amallar */}
        {isAdmin && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-brand-200 bg-brand-50 px-4 py-2.5">
            <span className="text-sm font-medium text-brand-800">
              {selectedIds.size} ta yozuv tanlandi
              {movableSelected.length < selectedIds.size && (
                <span className="ml-2 text-xs font-normal text-(--color-text-muted)">
                  ({selectedIds.size - movableSelected.length} tasi hududlar tushumi &mdash; o&rsquo;tkazilmaydi)
                </span>
              )}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Bekor qilish
              </Button>

              <Button
                variant="secondary"
                size="sm"
                loading={moving === 'bulk'}
                disabled={movableSelected.length === 0}
                onClick={() => void handleMove(movableSelected.map((item) => item.id), 'bulk')}
              >
                <IconArrowRight className="size-4" />
                {SECTION_LABELS[target]}ga o&rsquo;tkazish
              </Button>

              {meta && meta.total > items.length && (
                <Button variant="ghost" size="sm" onClick={() => setBulkConfirm('filter')}>
                  Barcha {meta.total} tasini o&rsquo;chirish
                </Button>
              )}
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
              title={hasFilters ? 'Hech narsa topilmadi' : `Bu oyda ${SECTION_LABELS[section].toLowerCase()} daromad yo'q`}
              description={
                hasFilters
                  ? "Filtrlarni o'zgartirib ko'ring"
                  : isAdmin
                    ? section === 'BOSHQA'
                      ? 'Yangi daromad kiriting yoki Doimiy ro‘yxatidan o‘tkazing'
                      : 'Yangi daromad kiriting yoki Boshqa ro‘yxatidan o‘tkazing'
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
                          className="size-4 rounded border-(--color-line-strong)"
                          aria-label="Hammasini belgilash"
                        />
                      </Th>
                    )}

                    <Th className="w-28">Sana</Th>
                    <Th>Xizmat turi</Th>
                    <Th>Mijoz</Th>
                    <Th className="w-44">Qayerga tegishli</Th>
                    <Th className="w-28">Holat</Th>
                    <Th align="right" className="w-40">
                      Summa
                    </Th>
                    <Th className={isAdmin ? 'w-36' : 'w-10'} />
                  </Tr>
                </THead>

                <TBody>
                  {items.map((income) => {
                    const locked = isLocked(income);
                    return (
                      <Tr key={income.id} clickable className="group" onClick={() => setSelected(income)}>
                        {isAdmin && (
                          <Td className="pl-4" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(income.id)}
                              onChange={() => toggleOne(income.id)}
                              className="size-4 rounded border-(--color-line-strong)"
                              aria-label="Belgilash"
                            />
                          </Td>
                        )}

                        <Td className="money whitespace-nowrap text-(--color-text-muted)">
                          <span className="inline-flex items-center gap-1.5">
                            <Mark item={recordMark('INCOME', income, 'Daromadlar › yozuv')} />
                            {formatDate(income.date)}
                          </span>
                        </Td>

                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <Mark item={categoryMark('INCOME', income.categoryCode, income.category.label, 'Daromadlar')} />
                            <span>{income.category.label}</span>
                            {locked && (
                              <Badge tone="brand">{income.regionCode === 0 ? 'Markaz tushumi' : 'Hududlar'}</Badge>
                            )}
                          </div>
                        </Td>

                        <Td className="max-w-xs truncate">
                          <Mark item={clientMark(income.clientName, 'Daromadlar')} className="mr-1.5 align-middle" />
                          {income.clientName ?? '-'}
                          {income.contractNo && (
                            <p className="text-xs text-(--color-text-muted)">{income.contractNo}</p>
                          )}
                        </Td>

                        <Td className="text-(--color-text-muted)">
                          {placeText(income) ?? <span className="text-(--color-warn)">Biriktirilmagan</span>}
                        </Td>

                        <Td>
                          {income.paymentStatus !== 'PAID' && <PaymentBadge status={income.paymentStatus} />}
                        </Td>

                        <Td money>
                          <Money tiyin={income.amountTiyin} tone="income" />
                          {income.paymentStatus === 'PARTIAL' && (
                            <p className="text-xs text-(--color-text-muted)">
                              <Money tiyin={income.paidTiyin} /> tushgan
                            </p>
                          )}
                        </Td>

                        <Td className="pr-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {isAdmin && !locked && (
                              <button
                                type="button"
                                disabled={moving !== null}
                                onClick={() => void handleMove([income.id], income.id)}
                                className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-brand-700 opacity-0 transition-opacity hover:bg-brand-50 group-hover:opacity-100 disabled:opacity-40"
                                title={`${SECTION_LABELS[target]} bo‘limiga o‘tkazish`}
                              >
                                {moving === income.id ? '…' : `→ ${SECTION_LABELS[target]}`}
                              </button>
                            )}
                            <IconEdit className="size-4 text-(--color-text-faint) opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
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
        section={section}
        unit={unit?.code ?? null}
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
        title="Yozuvlarni o‘chirish"
        message={
          bulkConfirm === 'filter'
            ? `Filtrga mos ${meta?.total ?? 0} ta yozuv savatga tushadi. 15 kun ichida tiklash mumkin.`
            : `${selectedIds.size} ta yozuv savatga tushadi. 15 kun ichida tiklash mumkin.`
        }
        confirmLabel="O‘chirish"
        danger
        loading={bulkDeleting}
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setBulkConfirm(null)}
      />

      <SimpleImportDialog
        open={importOpen}
        kind="income"
        section={section}
        onClose={() => setImportOpen(false)}
        onImported={(message) => {
          setToast(`${message} — «${SECTION_LABELS[section]}» bo‘limiga`);
          reloadAll();
        }}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} duration={5000} />}
    </>
  );
}