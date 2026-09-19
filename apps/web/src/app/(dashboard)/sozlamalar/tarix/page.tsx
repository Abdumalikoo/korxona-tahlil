'use client';

import { auditApi, type AuditAction, type AuditLog } from '@/features/shared/audit-api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from '@/components/shared/pagination';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
  { href: '/sozlamalar/zaxira', label: 'Zaxira' },
];

const actionLabels: Record<AuditAction, string> = {
  CREATE: 'Yaratildi',
  UPDATE: "O'zgartirildi",
  DELETE: "O'chirildi",
  RESTORE: 'Tiklandi',
  LOGIN: 'Kirish',
  IMPORT: 'Import',
  EXPORT: 'Eksport',
};

const actionTones: Record<AuditAction, 'income' | 'expense' | 'warn' | 'neutral'> = {
  CREATE: 'income',
  UPDATE: 'warn',
  DELETE: 'expense',
  RESTORE: 'income',
  LOGIN: 'neutral',
  IMPORT: 'neutral',
  EXPORT: 'neutral',
};

const entityLabels: Record<string, string> = {
  employee: 'Xodim',
  expense: 'Xarajat',
  income: 'Daromad',
  category: 'Kategoriya',
  department: "Bo'lim",
};

export default function AuditPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const logs = useAsync(
    () =>
      auditApi.list({
        entity: entity || undefined,
        action: (action || undefined) as AuditAction | undefined,
        page,
        limit: 50,
      }),
    [entity, action, page],
  );

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  if (!ready || !isAdmin) return <LoadingState />;

  const items = logs.data?.data ?? [];
  const meta = logs.data?.meta;

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Tizimda qilingan o'zgarishlar tarixi"
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* Filtrlar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-48">
            <Select
              options={[
                { value: '', label: 'Barcha bo\u2018limlar' },
                { value: 'employee', label: 'Xodimlar' },
                { value: 'expense', label: 'Xarajatlar' },
                { value: 'income', label: 'Daromadlar' },
              ]}
              value={entity}
              onChange={(event) => {
                setEntity(event.target.value);
                setPage(1);
              }}
              className="h-9"
            />
          </div>

          <div className="w-44">
            <Select
              options={[
                { value: '', label: 'Barcha amallar' },
                { value: 'CREATE', label: 'Yaratish' },
                { value: 'UPDATE', label: "O'zgartirish" },
                { value: 'DELETE', label: "O'chirish" },
                { value: 'IMPORT', label: 'Import' },
              ]}
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
              className="h-9"
            />
          </div>
        </div>

        {/* Jadval */}
        <Card className="overflow-hidden">
          {logs.loading ? (
            <LoadingState />
          ) : logs.error ? (
            <ErrorState message={logs.error} onRetry={logs.reload} />
          ) : items.length === 0 ? (
            <EmptyState title="Yozuv yo'q" />
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th className="w-44">Vaqt</Th>
                    <Th className="w-32">Amal</Th>
                    <Th className="w-28">Bo&apos;lim</Th>
                    <Th>Tafsilot</Th>
                    <Th className="w-40">Kim</Th>
                  </Tr>
                </THead>

                <TBody>
                  {items.map((log) => (
                    <Tr key={log.id}>
                      <Td className="money text-xs text-[--color-text-muted]">
                        {formatDateTime(log.createdAt)}
                      </Td>

                      <Td>
                        <Badge tone={actionTones[log.action]}>
                          {actionLabels[log.action]}
                        </Badge>
                      </Td>

                      <Td className="text-[--color-text-muted]">
                        {entityLabels[log.entityType] ?? log.entityType}
                      </Td>

                      <Td>
                        <ChangeDetails log={log} />
                      </Td>

                      <Td className="text-[--color-text-muted]">
                        {log.user.fullName}
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
    </>
  );
}

/** O'zgarishlarni o'qiladigan ko'rinishda ko'rsatadi */
function ChangeDetails({ log }: { log: AuditLog }) {
  const summary = log.changes?.summary;
  const fields = log.changes?.fields ?? {};
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return <span className="text-sm">{summary ?? '\u2014'}</span>;
  }

  return (
    <div className="space-y-0.5">
      {summary && <p className="text-sm font-medium">{summary}</p>}

      {entries.slice(0, 4).map(([field, change]) => (
        <p key={field} className="text-xs text-[--color-text-muted]">
          <span className="font-medium">{fieldLabel(field)}:</span>{' '}
          {change.from !== null && change.from !== undefined && (
            <>
              <span className="line-through">{String(change.from)}</span>
              {' \u2192 '}
            </>
          )}
          <span>{String(change.to)}</span>
        </p>
      ))}

      {entries.length > 4 && (
        <p className="text-xs text-[--color-text-faint]">
          va yana {entries.length - 4} ta
        </p>
      )}
    </div>
  );
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    lastName: 'Familiya',
    firstName: 'Ism',
    middleName: 'Otasining ismi',
    employmentType: 'Ish turi',
    regionCode: 'Hudud',
    districtId: 'Tuman',
    departmentId: "Bo'lim",
    position: 'Lavozim',
    isActive: 'Holat',
    count: 'Soni',
    totalTiyin: 'Summa',
    filter: 'Filtr',
  };

  return labels[field] ?? field;
}
