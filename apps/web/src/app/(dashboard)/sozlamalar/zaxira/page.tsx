'use client';

import { backupApi, downloadBackup } from '@/features/shared/backup-api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconCheck, IconDownload } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
  { href: '/sozlamalar/zaxira', label: 'Zaxira' },
];

/** Baytni o'qiladigan ko'rinishga keltiradi */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const backups = useAsync(() => backupApi.list(), []);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  async function handleCreate() {
    setCreating(true);

    try {
      const result = await backupApi.create();
      setToast(`Zaxira olindi: ${result.data.name}`);
      backups.reload();
    } catch (err) {
      setToast(errorMessage(err, 'Zaxira olishda xatolik'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(name: string) {
    setDownloading(name);

    try {
      await downloadBackup(name);
    } catch (err) {
      setToast(errorMessage(err, 'Faylni yuklab bo\u2018lmadi'));
    } finally {
      setDownloading(null);
    }
  }

  if (!ready || !isAdmin) return <LoadingState />;

  const data = backups.data?.data;
  const files = data?.files ?? [];
  const stats = data?.stats;

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Baza zaxiralari"
        actions={
          <Button size="sm" onClick={() => void handleCreate()} loading={creating}>
            Zaxira olish
          </Button>
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* Umumiy holat */}
        <Card>
          <CardBody>
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[--color-income-soft]">
                <IconCheck className="size-6 text-[--color-income]" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  {stats?.count ?? 0} ta zaxira
                </p>

                <p className="mt-0.5 text-sm text-[--color-text-muted]">
                  {stats?.lastBackup
                    ? `Oxirgisi: ${formatDateTime(stats.lastBackup)}`
                    : 'Hali zaxira olinmagan'}
                </p>

                <p className="mt-2 text-xs text-[--color-text-faint]">
                  Har kuni soat 2:00 da avtomatik olinadi &middot;{' '}
                  {stats?.retentionDays ?? 30} kun saqlanadi
                </p>

                {stats?.directory && (
                  <p className="money mt-1 text-xs text-[--color-text-faint]">
                    {stats.directory}
                  </p>
                )}
              </div>

              {stats && stats.totalBytes > 0 && (
                <div className="shrink-0 text-right">
                  <p className="text-xs uppercase tracking-wide text-[--color-text-muted]">
                    Jami hajm
                  </p>
                  <p className="money mt-1 text-lg font-semibold">
                    {formatSize(stats.totalBytes)}
                  </p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Ro'yxat */}
        <Card className="overflow-hidden">
          {backups.loading ? (
            <LoadingState />
          ) : backups.error ? (
            <ErrorState message={backups.error} onRetry={backups.reload} />
          ) : files.length === 0 ? (
            <EmptyState
              title="Zaxira yo'q"
              description="Birinchi zaxirani olish uchun yuqoridagi tugmani bosing"
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-44">Olingan vaqt</Th>
                  <Th align="right" className="w-28">
                    Hajm
                  </Th>
                  <Th className="w-32" />
                </Tr>
              </THead>

              <TBody>
                {files.map((file) => (
                  <Tr key={file.name}>
                    <Td className="money text-sm">{file.name}</Td>

                    <Td className="text-sm text-[--color-text-muted]">
                      {formatDateTime(file.createdAt)}
                    </Td>

                    <Td align="right" className="money text-sm text-[--color-text-muted]">
                      {formatSize(file.sizeBytes)}
                    </Td>

                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDownload(file.name)}
                        loading={downloading === file.name}
                      >
                        <IconDownload className="size-4" />
                        Yuklab olish
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Tiklash haqida */}
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Zaxiradan tiklash</p>
            <p className="mt-1 text-sm text-[--color-text-muted]">
              Tiklash dastur orqali bajarilmaydi &mdash; bu xavfli amal.
              Zarur bo&rsquo;lsa terminalda quyidagi buyruqni ishlating:
            </p>

            <pre className="money mt-3 overflow-x-auto rounded-[--radius-control] bg-[--color-surface-sunken] px-3 py-2 text-xs">
              psql -U postgres -d korxona_tahlil -f zaxira_fayli.sql
            </pre>
          </CardBody>
        </Card>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}
