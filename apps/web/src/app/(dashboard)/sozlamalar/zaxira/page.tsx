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
import { IconAlert, IconCheck, IconDownload } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/komponentlar', label: 'Ish haqi komponentlari' },
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
  const encOn = Boolean(stats?.encryption);
  const mirrorOn = Boolean(stats?.mirror?.configured);
  const mirrorFailed = stats?.mirror?.last?.ok === false;

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
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-(--color-income-soft)">
                <IconCheck className="size-6 text-(--color-income)" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  {stats?.count ?? 0} ta zaxira
                </p>

                <p className="mt-0.5 text-sm text-(--color-text-muted)">
                  {stats?.lastBackup
                    ? `Oxirgisi: ${formatDateTime(stats.lastBackup)}`
                    : 'Hali zaxira olinmagan'}
                </p>

                <p className="mt-2 text-xs text-(--color-text-faint)">
                  Har kuni soat 2:00 da avtomatik olinadi &middot;{' '}
                  {stats?.retentionDays ?? 30} kun saqlanadi
                </p>

                {stats?.directory && (
                  <p className="money mt-1 text-xs text-(--color-text-faint)">
                    {stats.directory}
                  </p>
                )}
              </div>

              {stats && stats.totalBytes > 0 && (
                <div className="shrink-0 text-right">
                  <p className="text-xs uppercase tracking-wide text-(--color-text-muted)">
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

        {/* Himoya: shifrlash va ikkinchi joy */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardBody>
              <div className="flex items-start gap-3">
                <span className={encOn ? 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-income-soft) text-(--color-income)' : 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-warn-soft) text-(--color-warn)'}>
                  {encOn ? <IconCheck className="size-4" /> : <IconAlert className="size-4" />}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{encOn ? 'Zaxiralar shifrlanadi' : 'Zaxiralar shifrlanmagan'}</p>
                  <p className="mt-1 text-(--color-text-muted)">
                    {encOn ? (
                      <>Yangi zaxira siqiladi va AES-256 bilan shifrlanadi (.sql.gz.enc). Ochiq SQL diskka yozilmaydi; har zaxira olingach to&apos;liq ochib tekshiriladi.</>
                    ) : (
                      <>
                        Zaxirada xodimlarning shaxsiy ma&apos;lumotlari ochiq turadi. Serverdagi <code className="money">.env</code> ga <code className="money">BACKUP_ENCRYPTION_KEY</code> (kamida 16 belgi) qo&apos;shing va API&apos;ni qayta ishga tushiring.
                      </>
                    )}
                  </p>
                  {encOn && <p className="mt-1 text-xs text-(--color-warn)">Kalit yo&apos;qolsa, zaxirani ochib bo&apos;lmaydi — nusxasini server tashqarisida saqlang.</p>}
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="flex items-start gap-3">
                <span className={mirrorOn && !mirrorFailed ? 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-income-soft) text-(--color-income)' : 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-warn-soft) text-(--color-warn)'}>
                  {mirrorOn && !mirrorFailed ? <IconCheck className="size-4" /> : <IconAlert className="size-4" />}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{!mirrorOn ? 'Ikkinchi joy sozlanmagan' : mirrorFailed ? "Ikkinchi joyga nusxa olinmadi" : 'Ikkinchi joyga nusxalanadi'}</p>
                  <p className="mt-1 text-(--color-text-muted)">
                    {!mirrorOn ? (
                      <>
                        Disk buzilsa, zaxira ham yo&apos;qoladi. <code className="money">.env</code> ga <code className="money">BACKUP_MIRROR_DIR</code> — boshqa disk yoki tarmoq papkasi yo&apos;lini qo&apos;shing.
                      </>
                    ) : (
                      <>
                        <span className="money break-all">{stats?.mirror?.directory}</span>
                        {stats?.mirror?.last ? ` · oxirgi urinish: ${formatDateTime(stats.mirror.last.at)}` : ''}
                      </>
                    )}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

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
                    <Td className="money text-sm">
                      {file.name}
                      <span className="ml-2 inline-flex gap-1 align-middle font-sans">
                        {file.encrypted ? (
                          <span className="rounded-full bg-(--color-income-soft) px-2 py-0.5 text-[10px] font-semibold text-(--color-income)">shifrlangan</span>
                        ) : (
                          <span className="rounded-full bg-(--color-warn-soft) px-2 py-0.5 text-[10px] font-semibold text-(--color-warn)">ochiq</span>
                        )}
                        {file.mirrored === true && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">2 joyda</span>}
                      </span>
                    </Td>

                    <Td className="text-sm text-(--color-text-muted)">
                      {formatDateTime(file.createdAt)}
                    </Td>

                    <Td align="right" className="money text-sm text-(--color-text-muted)">
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
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Tiklash dastur orqali bajarilmaydi &mdash; bu xavfli amal. Avval yangi (bo&apos;sh) bazaga tiklab tekshiring, keyin almashtiring.
            </p>

            <p className="mt-3 text-xs font-medium text-(--color-text-muted)">Shifrlangan zaxira (.sql.gz.enc) — API papkasida, kalit muhitdan olinadi:</p>
            <pre className="money mt-1 overflow-x-auto whitespace-pre rounded-(--radius-control) bg-(--color-surface-sunken) px-3 py-2 text-xs">
              {`node scripts/backup-decrypt.js zaxira_fayli.sql.gz.enc --check
node scripts/backup-decrypt.js zaxira_fayli.sql.gz.enc > zaxira.sql
psql -U postgres -d korxona_tiklash -f zaxira.sql`}
            </pre>
            <p className="mt-3 text-xs font-medium text-(--color-text-muted)">Ochiq zaxira (.sql):</p>
            <pre className="money mt-1 overflow-x-auto rounded-(--radius-control) bg-(--color-surface-sunken) px-3 py-2 text-xs">
              psql -U postgres -d korxona_tiklash -f zaxira_fayli.sql
            </pre>
            <p className="mt-2 text-xs text-(--color-text-faint)">Ochilgan zaxira.sql ichida shaxsiy ma&apos;lumotlar ochiq — tiklagach o&apos;chirib tashlang.</p>
          </CardBody>
        </Card>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}