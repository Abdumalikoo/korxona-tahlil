'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { IconDownload } from '@/components/ui/icons';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { downloadSignedAct, warehouseApi, type SignListItem } from '@/features/warehouse/api';
import { DocKindBadge } from '@/features/warehouse/bits';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Imzolar — QR orqali elektron tasdiqlangan dalolatnomalar arxivi.
// Imzolangan har bir dalolatnomaning imzoli nusxasi (Word) shu yerda saqlanadi,
// Telegramga esa 2 nusxa ketadi: xodimga va arxiv guruhiga.
// ═══════════════════════════════════════════════════════════

type Tab = 'SIGNED' | 'PENDING';

export default function WarehouseSignsPage() {
  const [tab, setTab] = useState<Tab>('SIGNED');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { isAdmin } = useAuth();
  const list = useAsync(() => warehouseApi.signs(), []);
  const w = useWarehouseDialogs(list.reload);

  const all = list.data?.data ?? [];
  const signed = all.filter((r) => r.status === 'SIGNED');
  const pending = all.filter((r) => r.status === 'PENDING');
  const q = search.trim().toLowerCase();
  const rows = (tab === 'SIGNED' ? signed : pending).filter((r) => !q || `${r.number} ${r.signerName} ${r.kindLabel}`.toLowerCase().includes(q));
  const tgMissing = signed.filter((r) => r.telegram?.employee !== 'yuborildi' || r.telegram?.archive !== 'yuborildi').length;

  const download = async (r: SignListItem) => {
    setBusy(r.docId);
    try {
      await downloadSignedAct({ id: r.docId, number: r.number });
    } catch (e) {
      w.notify(errorMessage(e, "Imzoli nusxani yuklab bo'lmadi"), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Imzolangan dalolatnomalar" description="Xodim QR kodni skaner qilib telefonda imzolagan dalolatnomalar · qatorni bosing — dalolatnoma" />

      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Imzolangan" value={signed.length} tone="text-emerald-700" />
          <Stat label="Imzo kutilmoqda" value={pending.length} tone="text-amber-700" />
          <Stat
            label="Telegramga yetib bormagan"
            value={tgMissing}
            tone={tgMissing ? 'text-(--color-expense)' : 'text-(--color-text-muted)'}
            hint={
              isAdmin ? (
                <Link href="/sozlamalar/telegram" className="text-brand-700 hover:underline">
                  Arxiv guruhini sozlash →
                </Link>
              ) : (
                <span className="text-(--color-text-faint)">Arxiv guruhini administrator sozlaydi</span>
              )
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SubTabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'SIGNED', label: `Imzolangan · ${signed.length}` },
              { value: 'PENDING', label: `Kutilmoqda · ${pending.length}` },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Raqam yoki xodim" className="w-72" />
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={6} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={tab === 'SIGNED' ? "Hali imzolangan dalolatnoma yo'q" : "Imzo kutayotgan dalolatnoma yo'q"}
              description="Berish, ko'chirish yoki qaytarishda «Tasdiqlash (QR kod)» bosiladi — xodim imzolagach hujjat saqlanadi va shu yerga tushadi."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-32">Raqam</Th>
                  <Th className="w-28">Sana</Th>
                  <Th className="w-36">Turi</Th>
                  <Th>Imzolovchi</Th>
                  <Th className="w-44">{tab === 'SIGNED' ? 'Imzolandi' : 'QR berildi'}</Th>
                  {tab === 'SIGNED' && <Th className="w-56">Telegram</Th>}
                  <Th className="w-12" />
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.docId} clickable onClick={() => w.openDoc(r.docId, 'act')}>
                    <Td className="money font-semibold text-brand-700">{r.number}</Td>
                    <Td>{formatDate(r.date)}</Td>
                    <Td>
                      <DocKindBadge kind={r.kind} />
                    </Td>
                    <Td className="font-medium text-heading">
                      {r.signerName}
                      {r.status === 'SIGNED' && <span className="ml-2 text-[11px] font-normal text-(--color-text-muted)">{r.method === 'PHOTO' ? '· yuz surati' : '· imzo'}</span>}
                    </Td>
                    <Td className="text-(--color-text-muted)">{formatDateTime(tab === 'SIGNED' ? (r.signedAt ?? r.createdAt) : r.createdAt)}</Td>
                    {tab === 'SIGNED' && (
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <TgBadge label="xodim" v={r.telegram?.employee} />
                          <TgBadge label="arxiv" v={r.telegram?.archive} />
                        </span>
                      </Td>
                    )}
                    <Td className="pr-3 text-right">
                      {tab === 'SIGNED' && (
                        <button
                          type="button"
                          title="Imzolangan nusxa (Word)"
                          disabled={busy === r.docId}
                          onClick={(e) => {
                            e.stopPropagation();
                            void download(r);
                          }}
                          className="rounded p-1.5 text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                        >
                          <IconDownload className="size-4" />
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {w.element}
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-0.5 text-2xl font-semibold', tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px]">{hint}</p>}
    </Card>
  );
}

function TgBadge({ label, v }: { label: string; v?: string }) {
  const ok = v === 'yuborildi';
  return (
    <span title={v ?? "yuborilmagan"}>
      <Badge tone={ok ? 'income' : 'warn'}>
        {ok ? '✓' : '!'} {label}
      </Badge>
    </span>
  );
}