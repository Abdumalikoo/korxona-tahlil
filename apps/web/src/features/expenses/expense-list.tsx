'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { useMonthChange, usePeriod } from '@/lib/period';
import { regionsApi } from '@/features/employees/api';
import { placeText, type EntryUnit } from '@/lib/segments';
import { useUnitCategories } from '@/features/units/api';
import { Mark } from '@/features/reactions/mark';
import { categoryMark, counterpartyMark, recordMark } from '@/features/reactions/marks';
import { downloadExpensesExcel, expensesApi, type ExpenseFilters, type SortField, type SortOrder } from '@/features/expenses/api';
import { ExpenseDrawer } from '@/features/expenses/expense-drawer';
import { moveMessage, otherSection, SECTION_LABELS, SECTION_NAV, sectionsApi, type SectionValue } from '@/features/sections/api';
import { SectionTabs } from '@/features/sections/section-tabs';
import { referencesApi } from '@/features/shared/references';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from '@/components/shared/pagination';
import { SearchInput } from '@/components/shared/search-input';
import { SimpleImportDialog } from '@/components/shared/simple-import-dialog';
import { StatCard } from '@/components/shared/stat-card';
import { Badge, BehaviorBadge, PaymentBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconArrowRight, IconEdit, IconPlus, IconWallet } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { SortableTh } from '@/components/ui/sortable-th';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import type { Expense, PaymentStatus } from '@/lib/types';

const PAGE_LIMIT = 25;

/** Moduldan yozilgan xarajat — boshqa bo'limga o'tkazilmaydi */
const LOCKED_SOURCES: Record<string, string> = {
  PAYROLL: 'Ish haqi',
  LEASE: 'Ijara',
  VEHICLE: 'Mashina',
  WAREHOUSE: 'Ombor',
  ASSET: 'Asosiy vositalar sarfi',
  TAX: 'Soliqlar',
};

/**
 * Xarajatlar ro'yxati — bitta bo'lim (Doimiy yoki Boshqa) uchun.
 * Boshqa bo'limdagi yozuvlar bu yerda umuman ko'rinmaydi.
 */
export function ExpenseList({ section, unit = null }: { section: SectionValue; unit?: EntryUnit | null }) {
  const { isAdmin } = useAuth();
  const searchParams = useSearchParams();

  const target = otherSection(section);
  /** Bo'lim sahifasida (Markaz, Hududlar, Tax free …): faqat shu bo'lim yozuvlari, yangisi ham shu bo'limga */
  const newHref = `${SECTION_NAV.expense.newHref}?section=${section}${unit ? `&unit=${unit.code}` : ''}`;
  const showDepartment = !unit || unit.code === 'CENTER';
  const showRegion = !unit || unit.code === 'REGION';

  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period } = usePeriod();
  const [departmentId, setDepartmentId] = useState('');
  const [rootCategoryCode, setRootCategoryCode] = useState('');
  // Global qidiruvdan kelganda (?q=...) qidiruv so'zi tayyor turadi
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Expense | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // «+ Kiritish» dan kelganda (?import=1) yuklash oynasi darhol ochiladi
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'selected' | 'filter' | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const filters: ExpenseFilters = {
    period,
    section,
    ...(unit ? { unit: unit.code } : {}),
    departmentId: departmentId || undefined,
    rootCategoryCode: rootCategoryCode || undefined,
    paymentStatus: (paymentStatus || undefined) as PaymentStatus | undefined,
    regionCode: regionCode ? Number(regionCode) : undefined,
    search: search || undefined,
    page,
    limit: PAGE_LIMIT,
    sortBy,
    sortOrder,
  };

  // Ma'lumotnomalar bir marta yuklanadi
  const departments = useAsync(() => referencesApi.departments(), []);
  const regions = useAsync(() => regionsApi.list(), []);
  const categoryTree = useAsync(() => referencesApi.expenseTree(), []);
  const categoryLeaves = useAsync(() => referencesApi.expenseLeaves(), []);
  /** Bo'lim sahifasida — filtrda faqat shu bo'lim moddalari guruhlari */
  const unitLists = useUnitCategories('expense');
  const unitCodes = unit && unitLists.lists.get(unit.code)?.length ? new Set(unitLists.lists.get(unit.code)) : null;

  const list = useAsync(
    () => expensesApi.list(filters),
    [section, unit?.code, period, departmentId, rootCategoryCode, paymentStatus, regionCode, search, page, sortBy, sortOrder],
  );

  const overview = useAsync(() => sectionsApi.overview('expense', period), [period]);
  const summary = overview.data?.data.sections.find((s) => s.section === section);

  // reload — barqaror funksiyalar (useAsync), shuning uchun reloadAll ham barqaror
  const reloadList = list.reload;
  const reloadOverview = overview.reload;
  const reloadAll = useCallback(() => {
    reloadList();
    reloadOverview();
  }, [reloadList, reloadOverview]);

  // Oy almashganda — birinchi sahifaga
  useMonthChange(period, () => setPage(1));

  /** Bitta qatorni belgilash */
  function toggleOne(id: string) {
    setSelectedIds((state) => {
      const next = new Set(state);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Sahifadagi hammasini belgilash yoki bekor qilish */
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
          ? await expensesApi.removeByFilter(filters)
          : await expensesApi.removeMany([...selectedIds]);

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
      const result = await sectionsApi.move('expense', ids, target);
      setToast(moveMessage(result.data));
      setSelectedIds(new Set());
      reloadAll();
    } catch (err) {
      setToast(errorMessage(err, 'O‘tkazib bo‘lmadi'));
    } finally {
      setMoving(null);
    }
  }

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

  /** Filtr o'zgarganda birinchi sahifaga qaytamiz */
  const changeFilter = useCallback((setter: () => void) => {
    setter();
    setPage(1);
  }, []);

  /** Panel yopilgach ro'yxat va yig'indilarni yangilaymiz */
  const handleSaved = useCallback(
    (message: string) => {
      setToast(message);
      reloadAll();
    },
    [reloadAll, setToast],
  );

  const departmentOptions = [
    { value: '', label: 'Barcha bo‘limlar' },
    ...(departments.data?.data ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];

  const categoryOptions = [
    { value: '', label: 'Barcha kategoriyalar' },
    ...(categoryTree.data?.data ?? [])
      .filter((item) => !unitCodes || unitCodes.has(item.code) || (item.children ?? []).some((c) => unitCodes.has(c.code)))
      .map((item) => ({ value: item.code, label: item.label })),
  ];

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const hasFilters = Boolean(departmentId || rootCategoryCode || paymentStatus || regionCode || search);
  const movableSelected = items.filter((item) => selectedIds.has(item.id) && !LOCKED_SOURCES[item.source]);

  return (
    <>
      {!unit && (
        <>
          <PageHeader
            title="Xarajatlar"
            description={`${SECTION_LABELS[section]} · ${formatPeriod(period)}`}
          />

          <SectionTabs kind="expense" section={section} />
        </>
      )}

      <div className={unit ? 'space-y-4' : 'space-y-4 p-6'}>
        {/* Amallar: qo'shish, yuklash, yuklab olish, o'chirish — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          add={{ label: 'Yangi xarajat', href: newHref }}
          // Bo'lim sahifasida Excel yuklash yo'q: yuklangan yozuvlarda joy (Markaz/hudud/yo'nalish) bo'lmaydi
          {...(unit ? {} : { upload: { label: "Excel'dan yuklash", onClick: () => setImportOpen(true), hint: 'Shablon yuklash oynasining ichida' } })}
          download={{ label: "Excel'ga yuklab olish", onClick: () => void handleExport(), loading: exporting, disabled: items.length === 0 }}
          {...(unit ? {} : { deleteData: {
            target: 'EXPENSE',
            scope: { section },
            selectedIds: [...selectedIds],
            month: period,
            place: `Xarajatlar › ${SECTION_LABELS[section]}`,
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
              value={rootCategoryCode}
              onChange={(event) => changeFilter(() => setRootCategoryCode(event.target.value))}
              className="h-9"
            />
          </div>

          {showRegion && (
          <div className="w-48">
            <Select
              options={[
                { value: '', label: 'Barcha hududlar' },
                ...(regions.data?.data ?? []).filter((r) => !unit || r.code !== 0).map((r) => ({
                  value: String(r.code),
                  label: r.code === 0 ? r.name : `${r.code} \u2014 ${r.name}`,
                })),
              ]}
              value={regionCode}
              onChange={(event) => changeFilter(() => setRegionCode(event.target.value))}
              className="h-9"
            />
          </div>
          )}

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
                  setRegionCode('');
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
            label={hasFilters ? 'Filtr bo‘yicha' : unit ? `${unit.label} · ${SECTION_LABELS[section].toLowerCase()}` : `${SECTION_LABELS[section]} xarajat`}
            tiyin={meta?.sumTiyin ?? 0}
            tone="expense"
            hint={meta ? `${meta.total} ta yozuv` : undefined}
            icon={<IconWallet className="size-4" />}
          />

          {!unit && (<>
          <StatCard
            label="O‘tgan oyga nisbatan"
            tiyin={summary?.previousTiyin ?? 0}
            changePercent={summary?.previousChange}
            positiveIsGood={false}
            hint={overview.data ? formatPeriod(overview.data.data.previousPeriod) : undefined}
          />

          <StatCard
            label="O‘tgan yilning shu oyi"
            tiyin={summary?.lastYearTiyin ?? 0}
            changePercent={summary?.lastYearChange}
            positiveIsGood={false}
            hint={overview.data ? formatPeriod(overview.data.data.lastYearPeriod) : undefined}
          />
          </>)}

          <StatCard
            label="To‘lanmagan"
            tiyin={meta?.unpaidTiyin ?? 0}
            tone={Number(meta?.unpaidTiyin ?? 0) > 0 ? 'expense' : 'neutral'}
            hint={meta ? `${meta.unpaidCount} ta yozuv` : undefined}
          />
        </div>

        {/* Tanlanganlar bilan amallar */}
        {isAdmin && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-brand-200 bg-brand-50 px-4 py-2.5">
            <span className="text-sm font-medium text-brand-800">
              {selectedIds.size} ta yozuv tanlandi
              {movableSelected.length < selectedIds.size && (
                <span className="ml-2 text-xs font-normal text-(--color-text-muted)">
                  ({selectedIds.size - movableSelected.length} tasi qulflangan &mdash; o&rsquo;tkazilmaydi)
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

        <Card className="overflow-hidden">
          {list.loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'Hech narsa topilmadi' : `Bu oyda ${SECTION_LABELS[section].toLowerCase()} xarajat yo‘q`}
              description={
                hasFilters
                  ? 'Filtrlarni o‘zgartirib ko‘ring'
                  : isAdmin
                    ? section === 'BOSHQA'
                      ? 'Yangi xarajat yarating yoki Doimiy ro‘yxatidan o‘tkazing'
                      : 'Yangi xarajat kiriting yoki Boshqa ro‘yxatidan o‘tkazing'
                    : undefined
              }
              action={
                !hasFilters && isAdmin ? (
                  <Link href={newHref} className={buttonClass('primary', 'sm')}>
                    <IconPlus className="size-4" />
                    Yangi xarajat
                  </Link>
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

                    <SortableTh field="date" activeField={sortBy} activeOrder={sortOrder} onSort={handleSort} className="w-28">
                      Sana
                    </SortableTh>

                    <SortableTh field="categoryCode" activeField={sortBy} activeOrder={sortOrder} onSort={handleSort}>
                      Kategoriya
                    </SortableTh>

                    <Th className="w-48">Qayerga tegishli</Th>
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

                    <Th className={isAdmin ? 'w-36' : 'w-10'} />
                  </Tr>
                </THead>

                <TBody>
                  {items.map((expense) => {
                    const locked = LOCKED_SOURCES[expense.source];
                    return (
                      <Tr key={expense.id} clickable className="group" onClick={() => setSelected(expense)}>
                        {isAdmin && (
                          <Td className="pl-4" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(expense.id)}
                              onChange={() => toggleOne(expense.id)}
                              className="size-4 rounded border-(--color-line-strong)"
                              aria-label="Belgilash"
                            />
                          </Td>
                        )}

                        <Td className="money whitespace-nowrap text-(--color-text-muted)">
                          <span className="inline-flex items-center gap-1.5">
                            <Mark item={recordMark('EXPENSE', expense, 'Xarajatlar › yozuv')} />
                            {formatDate(expense.date)}
                          </span>
                        </Td>

                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <Mark item={categoryMark('EXPENSE', expense.categoryCode, expense.category.label, 'Xarajatlar')} />
                            <span>{expense.category.label}</span>
                            {locked && <Badge tone="brand">{locked}</Badge>}
                            {expense.category.behavior && <BehaviorBadge behavior={expense.category.behavior} />}
                          </div>
                        </Td>

                        <Td className="text-(--color-text-muted)">
                          {placeText(expense) ?? <span className="text-(--color-warn)">Biriktirilmagan</span>}
                        </Td>

                        <Td className="max-w-xs truncate text-(--color-text-muted)">
                          <Mark item={counterpartyMark(expense.counterparty, 'Xarajatlar')} className="mr-1.5 align-middle" />
                          {expense.description ?? expense.counterparty ?? '-'}
                          {expense.description && expense.counterparty && (
                            <p className="truncate text-xs text-(--color-text-faint)">{expense.counterparty}</p>
                          )}
                          {expense.counterpartyInn && <p className="money text-[11px] text-(--color-text-muted)">ИНН {expense.counterpartyInn}</p>}
                        </Td>

                        <Td>
                          {expense.paymentStatus !== 'PAID' && <PaymentBadge status={expense.paymentStatus} />}
                        </Td>

                        <Td money>
                          <Money tiyin={expense.amountTiyin} tone="expense" />
                        </Td>

                        <Td className="pr-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {isAdmin && !locked && (
                              <button
                                type="button"
                                disabled={moving !== null}
                                onClick={() => void handleMove([expense.id], expense.id)}
                                className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-brand-700 opacity-0 transition-opacity hover:bg-brand-50 group-hover:opacity-100 disabled:opacity-40"
                                title={`${SECTION_LABELS[target]} bo‘limiga o‘tkazish`}
                              >
                                {moving === expense.id ? '…' : `→ ${SECTION_LABELS[target]}`}
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

      <ExpenseDrawer
        expense={selected}
        categories={categoryLeaves.data?.data ?? []}
        departments={departments.data?.data ?? []}
        onClose={() => setSelected(null)}
        onSaved={handleSaved}
        onCategoryCreated={categoryLeaves.reload}
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
        kind="expense"
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