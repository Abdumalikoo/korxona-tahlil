'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { employeesApi, regionsApi, type EmployeeFilters } from '@/features/employees/api';
import { referencesApi } from '@/features/shared/references';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { Pagination } from '@/components/shared/pagination';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { IconPlus, IconUsers, IconEdit } from '@/components/ui/icons';
import { EmployeeDrawer } from '@/features/employees/employee-drawer';
import type { Employee } from '@/lib/types';

const PAGE_LIMIT = 50;
const CENTRAL_REGION = 0;

const groupOptions = [
  { value: '', label: 'Barcha guruhlar' },
  { value: 'markaz-shtat', label: 'Markaz — shtat' },
  { value: 'tuman-shtat', label: 'Tuman — shtat' },
  { value: 'shartnoma', label: 'Shartnoma' },
];

export default function EmployeesPage() {
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const filters: EmployeeFilters = {
    search: search || undefined,
    group: group || undefined,
    regionCode: regionCode ? Number(regionCode) : undefined,
    departmentId: departmentId || undefined,
    includeInactive: includeInactive || undefined,
    page,
    limit: PAGE_LIMIT,
  };

  const regions = useAsync(() => regionsApi.tree(), []);
  const departments = useAsync(() => referencesApi.departments(), []);
  const stats = useAsync(() => employeesApi.stats(), []);

  const list = useAsync(
    () => employeesApi.list(filters),
    [search, group, regionCode, departmentId, includeInactive, page],
  );

  const changeFilter = useCallback((setter: () => void) => {
    setter();
    setPage(1);
  }, []);

  const handleSaved = useCallback(
    (message: string) => {
      setToast(message);
      list.reload();
      stats.reload();
    },
    [list, stats],
  );

  const regionOptions = [
    { value: '', label: 'Barcha hududlar' },
    ...(regions.data?.data ?? []).map((region) => ({
      value: String(region.code),
      label: region.code === CENTRAL_REGION ? region.name : `${region.code} — ${region.name}`,
    })),
  ];

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((dept) => ({
      value: dept.id,
      label: `${dept.index} — ${dept.name}`,
    })),
  ];

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const hasFilters = Boolean(search || group || regionCode || departmentId || includeInactive);

  const statsData = stats.data?.data;

  return (
    <>
      <PageHeader
        title="Xodimlar"
        description={statsData ? `${statsData.total} ta faol xodim` : undefined}
        actions={
          isAdmin && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <IconPlus className="size-4" />
              Yangi xodim
            </Button>
          )
        }
      />

      <div className="space-y-4 p-6">
        {/* Guruhlar */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="Jami" value={statsData?.total} icon />
          <StatBox label="Markaz — shtat" value={statsData?.centralStaff} />
          <StatBox label="Tuman — shtat" value={statsData?.regionalStaff} />
          <StatBox label="Shartnoma" value={statsData?.contract} />
        </div>

        {/* Filtrlar */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={(value) => changeFilter(() => setSearch(value))}
            placeholder="Ism yoki PINFL"
            className="w-64"
          />

          <div className="w-44">
            <Select
              options={groupOptions}
              value={group}
              onChange={(event) => changeFilter(() => setGroup(event.target.value))}
              className="h-9"
            />
          </div>

          <div className="w-52">
            <Select
              options={regionOptions}
              value={regionCode}
              onChange={(event) => changeFilter(() => setRegionCode(event.target.value))}
              className="h-9"
            />
          </div>

          <div className="w-56">
            <Select
              options={departmentOptions}
              value={departmentId}
              onChange={(event) => changeFilter(() => setDepartmentId(event.target.value))}
              className="h-9"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[--color-text-muted]">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) =>
                changeFilter(() => setIncludeInactive(event.target.checked))
              }
              className="size-4 rounded border-[--color-line-strong]"
            />
            Arxivlanganlar
          </label>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                changeFilter(() => {
                  setSearch('');
                  setGroup('');
                  setRegionCode('');
                  setDepartmentId('');
                  setIncludeInactive(false);
                })
              }
            >
              Tozalash
            </Button>
          )}
        </div>

        {/* Jadval */}
        <Card className="overflow-hidden">
          {list.loading ? (
            <TableSkeleton rows={10} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'Hech narsa topilmadi' : "Xodimlar yo'q"}
              description={hasFilters ? "Filtrlarni o'zgartirib ko'ring" : undefined}
              icon={<IconUsers className="size-10" strokeWidth={1.5} />}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>F.I.Sh.</Th>
                    <Th className="w-40">PINFL</Th>
                    <Th className="w-28">Ish turi</Th>
                    <Th className="w-56">Joylashuv</Th>
                    <Th className="w-10" />
                  </Tr>
                </THead>

                <TBody>
                  {items.map((employee) => (
                    <Tr
                      key={employee.pinfl}
                      clickable
                      className="group"
                      onClick={() => setSelected(employee)}
                    >
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className={employee.isActive ? '' : 'text-[--color-text-faint]'}>
                            {employee.fullName}
                          </span>
                          {!employee.isActive && <Badge tone="neutral">Arxiv</Badge>}
                        </div>
                        {employee.position && (
                          <p className="text-xs text-[--color-text-muted]">
                            {employee.position}
                          </p>
                        )}
                      </Td>

                      <Td className="money text-[--color-text-muted]">{employee.pinfl}</Td>

                      <Td>
                        <Badge tone={employee.employmentType === 'SHTAT' ? 'brand' : 'warn'}>
                          {employee.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma'}
                        </Badge>
                      </Td>

                      <Td className="text-[--color-text-muted]">
                        {employee.regionCode === CENTRAL_REGION
                          ? (employee.department?.name ?? 'Markaz')
                          : `${employee.region.name}${employee.district ? ` · ${employee.district.name}` : ''}`}
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

      <EmployeeDrawer
        employee={selected}
        creating={creating}
        regions={regions.data?.data ?? []}
        departments={departments.data?.data ?? []}
        onClose={() => {
          setSelected(null);
          setCreating(false);
        }}
        onSaved={handleSaved}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value?: number;
  icon?: boolean;
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
          {label}
        </p>
        {icon && <IconUsers className="size-4 text-[--color-text-faint]" />}
      </div>
      <p className="money mt-2 text-xl font-semibold">{value ?? '—'}</p>
    </div>
  );
}
