'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconAlert, IconCheck, IconDownload } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import { downloadSourceFile, sourceArchiveApi, type SourceEntry, type SourceKind } from '@/features/source-archive/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Manba fayllar: yuklangan har fayl (ish haqi tarkibi, soliq hisoboti, bo'lim vedomostlari, 23106)
// o'z yuklashi bilan bog'langan holda saqlanadi. Yangi bog'liqlik qo'shilsa — eski fayllarga ham o'zi qo'llanadi,
// qayta yuklash shart emas. Bu yerda — holati, qo'lda qayta qo'llash va yuklab olish.
// ═══════════════════════════════════════════════════════════

const KINDS: { key: SourceKind | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Hammasi' },
  { key: 'salary-composition', label: 'Ish haqi tarkibi' },
  { key: 'payroll', label: 'Soliq hisoboti' },
  { key: 'unit-payroll', label: 'Bo‘lim vedomostlari' },
  { key: 'acc-23106', label: '23106' },
];

function size(b: number) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SourceFilesPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<SourceKind | 'ALL'>('ALL');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  // Faqat administrator (boshqalarga so'rov yuborilmaydi)
  const list = useAsync(() => (ready && isAdmin ? sourceArchiveApi.list(kind === 'ALL' ? undefined : kind).then((r) => r.data) : Promise.resolve(null)), [kind, ready, isAdmin]);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  if (!ready || !isAdmin) return <LoadingState />;
  const v = list.data;

  async function relinkAll(force: boolean) {
    setBusy(force ? 'force' : 'all');
    try {
      const r = (await sourceArchiveApi.relink(kind === 'ALL' ? undefined : kind, force)).data;
      setToast({ message: r.files ? `${r.files} faylga bog‘liqliklar qo‘llandi${r.failed ? ` · ${r.failed} tasi xato` : ''}` : 'Hamma fayl bog‘langan — yangi ish yo‘q', tone: r.failed ? 'error' : 'success' });
      list.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Qo‘llab bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function relinkOne(e: SourceEntry) {
    setBusy(e.id);
    try {
      const r = (await sourceArchiveApi.relinkOne(e.kind, e.id)).data;
      const bad = Object.values(r).filter((s) => !s.ok).length;
      setToast({ message: bad ? `«${e.fileName}»: ${bad} ta bog‘liqlik xato` : `«${e.fileName}»: bog‘liqliklar qayta qo‘llandi`, tone: bad ? 'error' : 'success' });
      list.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Qo‘llab bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function download(e: SourceEntry) {
    setBusy(`d:${e.id}`);
    try {
      await downloadSourceFile(e);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni yuklab bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const linkerCount = v ? Object.values(v.linkers).reduce((s, l) => s + l.length, 0) : 0;

  return (
    <>
      <PageHeader
        title="Manba fayllar"
        description="Yuklangan fayllar o‘z yuklashi bilan bog‘langan holda saqlanadi — yangi bog‘liqliklar eski fayllarga ham o‘zi qo‘llanadi"
        actions={
          <Button size="sm" loading={busy === 'all'} onClick={() => void relinkAll(false)}>
            Bog‘liqliklarni qo‘llash
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardBody className="flex items-start gap-3 text-sm">
              <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', v?.encrypted ? 'bg-(--color-income-soft) text-(--color-income)' : 'bg-(--color-warn-soft) text-(--color-warn)')}>{v?.encrypted ? <IconCheck className="size-4" /> : <IconAlert className="size-4" />}</span>
              <div>
                <p className="font-semibold">{v?.encrypted ? 'Fayllar shifrlab saqlanadi' : 'Fayllar shifrlanmagan'}</p>
                <p className="mt-1 text-(--color-text-muted)">
                  {v?.encrypted ? (
                    <>AES-256 bilan, serverdagi <code className="money">APP_ENCRYPTION_KEY</code> kaliti bilan. Kalit yo‘qolsa, fayllarni ochib bo‘lmaydi.</>
                  ) : (
                    <>
                      Fayllarda xodimlarning shaxsiy ma‘lumotlari bor. Serverdagi <code className="money">.env</code> ga <code className="money">APP_ENCRYPTION_KEY</code> (kamida 32 belgi) qo‘shing — yangi fayllar shifrlanadi.
                    </>
                  )}
                </p>
                {v?.directory && <p className="money mt-1 text-xs text-(--color-text-faint)">…/{v.directory}</p>}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-sm">
              <p className="font-semibold">Bog‘liqliklar: {linkerCount} ta</p>
              <ul className="mt-1 space-y-0.5 text-(--color-text-muted)">
                {v &&
                  Object.entries(v.linkers).flatMap(([k, ls]) =>
                    ls.map((l) => (
                      <li key={`${k}:${l.name}`}>
                        {KINDS.find((x) => x.key === k)?.label}: {l.label} <span className="text-(--color-text-faint)">· v{l.version}</span>
                      </li>
                    )),
                  )}
              </ul>
              <p className="mt-2 text-xs text-(--color-text-faint)">API ishga tushganda yangi yoki yangilangan bog‘liqliklar arxivdagi hamma saqlangan fayllarga o‘zi qo‘llanadi.</p>
              <button type="button" className="mt-1 text-xs text-brand-700 hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void relinkAll(true)}>
                Hammasini qaytadan qo‘llash
              </button>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn('rounded-full border px-3 py-1 text-xs', kind === k.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted)')}>
              {k.label}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          {list.loading && !v ? (
            <LoadingState />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !v?.entries.length ? (
            <EmptyState title="Arxivda fayl yo‘q" description="Bundan keyingi har yuklash shu yerda saqlanadi. Oldingi yuklashlarning fayli saqlanmagan." />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-44">Turi</Th>
                  <Th className="w-32">Oy</Th>
                  <Th className="w-28">Holat</Th>
                  <Th>Bog‘liqliklar</Th>
                  <Th className="w-48" />
                </Tr>
              </THead>
              <TBody>
                {v.entries.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <span className="block font-medium text-heading">{e.fileName}</span>
                      <span className="text-xs text-(--color-text-muted)">
                        {size(e.size)} · {formatDateTime(e.linkedAt ?? e.at)}
                        {e.sealed ? ' · shifrlangan' : ''}
                      </span>
                    </Td>
                    <Td className="text-xs">
                      {e.kindLabel}
                      {e.unit ? ` · ${e.unit}` : ''}
                    </Td>
                    <Td className="text-xs">{e.periods.map(formatPeriod).join(', ') || '—'}</Td>
                    <Td>{e.status === 'LINKED' ? <Badge tone="income">saqlangan</Badge> : <Badge tone="neutral">bekor qilingan</Badge>}</Td>
                    <Td className="text-xs">
                      {Object.entries(e.links).length === 0 ? (
                        <span className="text-(--color-text-muted)">—</span>
                      ) : (
                        Object.entries(e.links).map(([n, s]) => (
                          <span key={n} className={cn('block', s.ok ? 'text-(--color-text-muted)' : 'text-(--color-expense)')}>
                            {s.ok ? '✓' : '✗'} {s.note}
                          </span>
                        ))
                      )}
                    </Td>
                    <Td align="right">
                      <span className="inline-flex gap-1">
                        {e.status === 'LINKED' && (
                          <Button size="sm" variant="ghost" loading={busy === e.id} onClick={() => void relinkOne(e)}>
                            Qayta qo‘llash
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" loading={busy === `d:${e.id}`} onClick={() => void download(e)} title="Yuklab olish (tarixga yoziladi)">
                          <IconDownload className="size-4" />
                        </Button>
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}
