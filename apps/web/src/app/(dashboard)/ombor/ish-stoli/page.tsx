'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { IconSearch } from '@/components/ui/icons';
import { EmptyState, TableSkeleton } from '@/components/ui/states';
import { DOC_KIND_HINTS, DOC_KIND_LABELS, DOC_KIND_PATHS, qtyText, warehouseApi, type DocKind } from '@/features/warehouse/api';
import { DocKindBadge } from '@/features/warehouse/bits';
import { receiptsApi } from '@/features/purchases/api';
import { drafts } from '@/features/warehouse/entry/memory';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { useAuth } from '@/lib/auth-context';
import { formatDateLong, formatTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Ish stoli — omborchining bosh sahifasi (rahbar ko'rinishi emas):
//   beshta amal — katta tugmalar (bugun nechta qilingani bilan),
//   tugatilmagan qoralamalar, bugun kiritilganlar, kam qolganlar (xaridchiga xabar),
//   inventar raqami bo'yicha tez topish.
// ═══════════════════════════════════════════════════════════

const ACTIONS: { kind: DocKind; tone: string; ring: string; key: string }[] = [
  { kind: 'ISSUE', tone: 'from-sky-500 to-blue-600', ring: 'hover:ring-sky-200', key: '2' },
  { kind: 'TRANSFER', tone: 'from-amber-500 to-orange-500', ring: 'hover:ring-amber-200', key: '3' },
  { kind: 'RETURN', tone: 'from-slate-500 to-slate-600', ring: 'hover:ring-slate-200', key: '4' },
  { kind: 'WRITE_OFF', tone: 'from-rose-500 to-rose-600', ring: 'hover:ring-rose-200', key: '5' },
];

const KINDS = ACTIONS.map((a) => a.kind);

function hello(): string {
  const h = new Date().getHours();
  return h < 11 ? 'Xayrli tong' : h < 17 ? 'Xayrli kun' : 'Xayrli kech';
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function WarehouseDeskPage() {
  const { user } = useAuth();
  const router = useRouter();
  const today = todayInput();
  const docs = useAsync(() => warehouseApi.docs({ from: today, to: today }), [today]);
  const items = useAsync(() => warehouseApi.items(), []);
  const pendingReceipts = useAsync(() => receiptsApi.summary(), []);
  const waiting = pendingReceipts.data?.data.pending ?? 0;
  const w = useWarehouseDialogs(() => {
    docs.reload();
    items.reload();
  });
  const [pending, setPending] = useState<ReturnType<typeof drafts.list>>([]);
  const [find, setFind] = useState('');
  const [findMsg, setFindMsg] = useState<string | null>(null);

  useEffect(() => setPending(drafts.list(KINDS)), []);

  const todayDocs = (docs.data?.data ?? []).filter((d) => !d.cancelled);
  const countBy = (k: DocKind) => todayDocs.filter((d) => d.kind === k).length;
  const low = (items.data?.data ?? []).filter((i) => i.low);
  const firstName = (user?.fullName ?? '').split(/\s+/)[1] ?? user?.fullName ?? '';

  const findAsset = async () => {
    const term = find.trim();
    if (!term) return;
    setFindMsg(null);
    const digits = /^(?:INV-?)?(\d{1,6})$/i.exec(term);
    const inv = digits ? `INV-${digits[1]!.padStart(6, '0')}` : null;
    try {
      const r = await warehouseApi.assets({ search: inv ?? term });
      const all = r.data;
      const hit = inv ? all.find((a) => a.inventoryNo === inv) : all.length === 1 ? all[0] : null;
      if (hit) {
        w.openAsset(hit.id);
        setFind('');
      } else setFindMsg(all.length > 1 ? `${all.length} ta topildi — aniqroq yozing` : 'Topilmadi');
    } catch {
      setFindMsg('Qidirib bo‘lmadi');
    }
  };

  // Klaviatura: 1–5 — amal sahifasi (maydonda yozilmayotgan bo'lsa)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1') return router.push('/ombor/qabul');
      const a = ACTIONS.find((x) => x.key === e.key);
      if (a) router.push(DOC_KIND_PATHS[a.kind]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <>
      <PageHeader title="Ish stoli" description={`${hello()}${firstName ? `, ${firstName}` : ''} · ${formatDateLong(today)}`} />

      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        {/* Amallar */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Link href="/ombor/qabul" className="group relative overflow-hidden rounded-(--radius-card) bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 text-white shadow-card ring-4 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg hover:ring-emerald-200">
            <span className="absolute right-3 top-3 rounded bg-white/20 px-1.5 font-mono text-[11px]">1</span>
            <p className="text-lg font-bold">Qabul qilish</p>
            <p className="mt-1 text-xs text-white/85">Xaridchi yuborgan tovar</p>
            <p className="mt-3 text-xs font-semibold text-white/90">{waiting ? `Kutmoqda: ${waiting} ta` : 'Kutayotgani yo‘q'}</p>
          </Link>
          {ACTIONS.map((a) => (
            <Link
              key={a.kind}
              href={DOC_KIND_PATHS[a.kind]}
              className={cn('group relative overflow-hidden rounded-(--radius-card) bg-gradient-to-br p-4 text-white shadow-card ring-4 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg', a.tone, a.ring)}
            >
              <span className="absolute right-3 top-3 rounded bg-white/20 px-1.5 font-mono text-[11px]">{a.key}</span>
              <p className="text-lg font-bold">{DOC_KIND_LABELS[a.kind]}</p>
              <p className="mt-1 text-xs text-white/85">{DOC_KIND_HINTS[a.kind]}</p>
              <p className="mt-3 text-xs font-semibold text-white/90">{countBy(a.kind) ? `Bugun: ${countBy(a.kind)} ta` : 'Bugun: —'}</p>
            </Link>
          ))}
        </div>

        {/* Mashina va pochta */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/mashinalar" className="flex items-center justify-between gap-3 rounded-(--radius-card) border-2 border-sky-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-sky-400">
            <span>
              <span className="block text-base font-bold text-heading">Mashina xarajati</span>
              <span className="block text-xs text-(--color-text-muted)">Benzin, moyka, ta&apos;mir, texnik xizmat</span>
            </span>
            <span className="text-2xl text-sky-500">→</span>
          </Link>
          <Link href="/ombor/pochta" className="flex items-center justify-between gap-3 rounded-(--radius-card) border-2 border-violet-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-violet-400">
            <span>
              <span className="block text-base font-bold text-heading">Pochta to&apos;lovi</span>
              <span className="block text-xs text-(--color-text-muted)">Pochta korxonasiga to&apos;langan summa</span>
            </span>
            <span className="text-2xl text-violet-500">→</span>
          </Link>
        </div>

        {/* Tugatilmagan qoralamalar */}
        {pending.length > 0 && (
          <Card className="border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm font-semibold text-heading">Tugatilmagan hujjatlar</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <Link key={p.kind} href={DOC_KIND_PATHS[p.kind]} className="rounded-(--radius-control) border border-amber-300 bg-white px-3 py-2 text-sm hover:border-brand-300 hover:text-brand-700">
                  <b>{DOC_KIND_LABELS[p.kind]}</b> · {p.lines} qator · {time(p.savedAt)} — davom ettirish →
                </Link>
              ))}
            </div>
          </Card>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Bugun kiritilganlar */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Bugun kiritilganlar"
              description={todayDocs.length ? `${todayDocs.length} ta hujjat` : undefined}
              actions={
                <Link href="/ombor/hujjatlar" className="text-xs font-semibold text-brand-700 hover:underline">
                  Jurnal →
                </Link>
              }
            />
            {docs.loading && !docs.data ? (
              <TableSkeleton rows={4} cols={3} />
            ) : todayDocs.length === 0 ? (
              <EmptyState title="Bugun hali hujjat yo'q" description="Yuqoridagi tugmalardan birini bosing yoki 1–5 raqam tugmasini bosing." />
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {todayDocs.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => w.openDoc(d.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-brand-50/50">
                      <span className="w-12 shrink-0 text-xs text-(--color-text-muted)">{time(d.createdAt)}</span>
                      <DocKindBadge kind={d.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs font-semibold text-brand-700">{d.number}</span>
                        <span className="block truncate text-sm text-heading">
                          {d.kind === 'RECEIPT' ? (d.counterparty ?? 'Kirim') : d.kind === 'WRITE_OFF' ? d.reason : d.kind === 'RETURN' ? (d.from?.text ?? d.to.text) : d.to.text}
                        </span>
                      </span>
                      <span className="money shrink-0 text-sm font-semibold">{formatTiyin(d.totalTiyin)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-5">
            {/* Tez topish */}
            <Card className="p-5">
              <p className="text-[15px] font-bold text-heading">Asosiy vositani topish</p>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">Inventar raqami (masalan 15), nomi yoki seriyasi — kimda turgani va tarixi</p>
              <div className="mt-3 flex gap-2">
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void findAsset();
                  }}
                  placeholder="INV-000015"
                  className="h-10 min-w-0 flex-1 rounded-(--radius-control) border border-(--color-line-strong) px-3 font-mono text-sm focus:border-brand-600"
                />
                <button type="button" onClick={() => void findAsset()} className="flex size-10 items-center justify-center rounded-(--radius-control) bg-brand-600 text-white hover:bg-brand-700" aria-label="Topish">
                  <IconSearch className="size-4" />
                </button>
              </div>
              {findMsg && <p className="mt-2 text-xs text-(--color-warn)">{findMsg}</p>}
            </Card>

            {/* Kam qolganlar */}
            <Card className="overflow-hidden">
              <CardHeader title="Kam qolganlar" description="Qoldiq minimaldan kam — xaridchiga xabar bering" />
              {low.length === 0 ? (
                <p className="px-5 py-4 text-sm text-(--color-text-muted)">Hammasi yetarli.</p>
              ) : (
                <ul className="divide-y divide-(--color-line)">
                  {low.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium text-heading">{i.name}</span>
                      <span className="money shrink-0 text-xs">
                        <b className="text-(--color-expense)">{qtyText(i.inStock)}</b>
                        <span className="text-(--color-text-muted)"> / {qtyText(i.minQty ?? 0)} {i.unit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>

      {w.element}
    </>
  );
}