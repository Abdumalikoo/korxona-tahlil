'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconDownload, IconPlus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { downloadCountAct, qtyText, warehouseApi, type StockCount } from '@/features/warehouse/api';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Inventarizatsiya (sanoq):
//   ro'yxat → «Yangi inventarizatsiya» → sanash varag'i (?id=…):
//     haqiqatdagi miqdorni yozasiz (Enter — keyingi qator), farq o'zi hisoblanadi;
//     omborda turgan asosiy vositalar — «bor / yo'q» (inventar raqamini yozib Enter — «bor»);
//     har o'zgarish o'zi saqlanadi — bir necha kunda sanash mumkin;
//   «Yakunlash» — kamomad hisobdan chiqariladi, ortiqcha kirim qilinadi (xarajatsiz); dalolatnoma Word'da.
// ═══════════════════════════════════════════════════════════

const EPS = 1e-9;

function parseQty(v: string): number | null {
  const t = v.replace(',', '.').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function CountList() {
  const router = useRouter();
  const { canWrite } = useAuth();
  const editable = canWrite('/ombor');
  const list = useAsync(() => warehouseApi.counts(), []);
  const [creating, setCreating] = useState(false);
  const [date, setDate] = useState(todayInput());
  const [chairman, setChairman] = useState('');
  const [commission, setCommission] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const p = JSON.parse(window.localStorage.getItem('korxona_wh_prefs') ?? '{}') as { responsible?: string; commission?: string };
      setChairman(p.responsible ?? '');
      setCommission(p.commission ?? '');
    } catch {
      // eslab qolinmagan
    }
  }, []);

  const rows = list.data?.data ?? [];
  const draft = rows.find((r) => r.status === 'DRAFT');

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await warehouseApi.createCount({ date, chairman: chairman || null, commission: commission || null });
      router.push(`/ombor/inventarizatsiya?id=${r.data.id}`);
    } catch (err) {
      setError(errorMessage(err, "Boshlab bo'lmadi"));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Inventarizatsiya" description="Ombordagi narsalarni sanab chiqish va hisob bilan solishtirish" />
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        {draft ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50/60 p-5">
            <div>
              <p className="font-semibold text-heading">
                Tugallanmagan: <span className="font-mono">{draft.number}</span> ({formatDate(draft.date)})
              </p>
              <p className="text-sm text-(--color-text-muted)">
                Sanalgan: {draft.counted} / {draft.lines}
              </p>
            </div>
            <Button onClick={() => router.push(`/ombor/inventarizatsiya?id=${draft.id}`)}>Sanashni davom ettirish →</Button>
          </Card>
        ) : editable ? (
          <Card className="p-5">
            {!creating ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-heading">Yangi inventarizatsiya</p>
                  <p className="text-sm text-(--color-text-muted)">Barcha faol TMZ va omborda turgan asosiy vositalar ro&apos;yxati tayyorlanadi. Hisobdagi qoldiq har safar jonli hisoblanadi.</p>
                </div>
                <Button onClick={() => setCreating(true)}>
                  <IconPlus className="size-4" />
                  Boshlash
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input label="Sana" type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
                  <Input label="Komissiya raisi" value={chairman} onChange={(e) => setChairman(e.target.value)} placeholder="F.I.Sh." />
                  <Input label="Komissiya a'zolari" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="F.I.Sh., vergul bilan" />
                </div>
                {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                    Bekor qilish
                  </Button>
                  <Button onClick={() => void start()} loading={busy}>
                    Sanash varag&apos;ini ochish
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ) : null}

        <Card className="overflow-hidden">
          <CardHeader title="O'tkazilgan inventarizatsiyalar" />
          {list.loading && !list.data ? (
            <TableSkeleton rows={3} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState title="Hali inventarizatsiya o'tkazilmagan" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-36">Raqam</Th>
                  <Th className="w-28">Sana</Th>
                  <Th>Holati</Th>
                  <Th align="right">Sanalgan</Th>
                  <Th align="right">Kamomad</Th>
                  <Th align="right">Ortiqcha</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.id} clickable onClick={() => router.push(`/ombor/inventarizatsiya?id=${r.id}`)}>
                    <Td className="money font-semibold text-brand-700">{r.number}</Td>
                    <Td>{formatDate(r.date)}</Td>
                    <Td>{r.status === 'DONE' ? <Badge tone="income">Yakunlangan {r.finishedAt ? formatDate(r.finishedAt) : ''}</Badge> : <Badge tone="warn">Sanalmoqda</Badge>}</Td>
                    <Td align="right" money>
                      {r.counted} / {r.lines}
                    </Td>
                    <Td align="right" money className={cn(r.shortages && 'font-semibold text-(--color-expense)')}>
                      {r.shortages ?? '—'}
                    </Td>
                    <Td align="right" money>
                      {r.surpluses ?? '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

type Filter = 'all' | 'todo' | 'diff';

function CountSheet({ id }: { id: string }) {
  const router = useRouter();
  const { canWrite } = useAuth();
  const [count, setCount] = useState<StockCount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Kiritilayotgan qiymatlar (matn) — serverga yuborilmaganlari */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirtyLines, setDirtyLines] = useState<Record<string, number | null>>({});
  const [dirtyAssets, setDirtyAssets] = useState<Record<string, boolean | null>>({});
  const [head, setHead] = useState<{ chairman: string; commission: string } | null>(null);
  const [headDirty, setHeadDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [invInput, setInvInput] = useState('');
  const [invMsg, setInvMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const w = useWarehouseDialogs(() => undefined);

  const load = useCallback(() => {
    warehouseApi
      .count(id)
      .then((r) => {
        setCount(r.data);
        setHead({ chairman: r.data.chairman ?? '', commission: r.data.commission ?? '' });
      })
      .catch((err) => setLoadError(errorMessage(err, "Ochib bo'lmadi")));
  }, [id]);
  useEffect(load, [load]);

  const editable = canWrite('/ombor') && count?.status === 'DRAFT';

  // ── Avtomatik saqlash (1 soniya jimlikdan keyin) ──
  const pending = useRef({ dirtyLines, dirtyAssets, head, headDirty });
  // Eng so'nggi qiymat — render paytida emas, effektda
  useLayoutEffect(() => {
    pending.current = { dirtyLines, dirtyAssets, head, headDirty };
  });
  const flush = useCallback(async () => {
    const p = pending.current;
    const lines = Object.entries(p.dirtyLines).map(([itemId, actualQty]) => ({ itemId, actualQty }));
    const assets = Object.entries(p.dirtyAssets).map(([assetId, found]) => ({ assetId, found }));
    if (!lines.length && !assets.length && !p.headDirty) return;
    setSaving(true);
    try {
      const r = await warehouseApi.saveCount(id, {
        ...(lines.length ? { lines } : {}),
        ...(assets.length ? { assets } : {}),
        ...(p.headDirty && p.head ? { chairman: p.head.chairman || null, commission: p.head.commission || null } : {}),
      });
      setCount(r.data);
      // Yuborilganlar tozalanadi (shu orada yangi o'zgargani qoladi)
      setDirtyLines((d) => {
        const n = { ...d };
        for (const l of lines) if (n[l.itemId] === l.actualQty) delete n[l.itemId];
        return n;
      });
      setDirtyAssets((d) => {
        const n = { ...d };
        for (const a of assets) if (n[a.assetId] === a.found) delete n[a.assetId];
        return n;
      });
      if (p.headDirty) setHeadDirty(false);
      setSavedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi — qayta urinib ko'riladi"));
    } finally {
      setSaving(false);
    }
  }, [id]);

  const dirtyCount = Object.keys(dirtyLines).length + Object.keys(dirtyAssets).length + (headDirty ? 1 : 0);
  useEffect(() => {
    if (!dirtyCount) return;
    const t = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(t);
  }, [dirtyCount, dirtyLines, dirtyAssets, headDirty, flush]);

  // Sahifadan chiqishda saqlanmagan bo'lsa — ogohlantirish
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current.dirtyLines).length || Object.keys(pending.current.dirtyAssets).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const actualOf = (itemId: string, server: number | null) => (itemId in dirtyLines ? dirtyLines[itemId]! : server);
  const foundOf = (assetId: string, server: boolean | null) => (assetId in dirtyAssets ? dirtyAssets[assetId]! : server);

  const setActual = (itemId: string, value: string) => {
    setDrafts((d) => ({ ...d, [itemId]: value }));
    const q = parseQty(value);
    if (value.trim() === '' || q !== null) setDirtyLines((d) => ({ ...d, [itemId]: value.trim() === '' ? null : q }));
  };

  const lines = useMemo(() => {
    if (!count) return [];
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return count.lines.filter((l) => {
      if (words.length && !words.every((w) => `${l.name} ${l.code} ${l.group ?? ''}`.toLowerCase().includes(w))) return false;
      const a = actualOf(l.itemId, l.actualQty);
      if (filter === 'todo') return a === null;
      if (filter === 'diff') return a !== null && Math.abs(a - l.bookQty) > EPS;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, search, filter, dirtyLines]);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!count || !head) return <LoadingState />;

  // Jonli hisob (saqlanmaganlar bilan)
  const live = count.lines.map((l) => {
    const a = actualOf(l.itemId, l.actualQty);
    const diff = a === null ? null : Math.round((a - l.bookQty) * 1000) / 1000;
    return { ...l, a, diff, amount: diff === null ? 0 : Math.round(diff * Number(l.priceTiyin)) };
  });
  const checkAssets = count.assets.filter((a) => !a.moved);
  const counted = live.filter((l) => l.a !== null).length + checkAssets.filter((a) => foundOf(a.assetId, a.found) !== null).length;
  const total = live.length + checkAssets.length;
  const shortage = -live.filter((l) => (l.diff ?? 0) < -EPS).reduce((s, l) => s + l.amount, 0) + checkAssets.filter((a) => foundOf(a.assetId, a.found) === false).reduce((s, a) => s + Number(a.priceTiyin), 0);
  const surplus = live.filter((l) => (l.diff ?? 0) > EPS).reduce((s, l) => s + l.amount, 0);
  const shortLines = live.filter((l) => (l.diff ?? 0) < -EPS).length + checkAssets.filter((a) => foundOf(a.assetId, a.found) === false).length;
  const extraLines = live.filter((l) => (l.diff ?? 0) > EPS).length;
  const pct = total ? Math.round((counted / total) * 100) : 100;

  const fillRest = () => {
    const patch: Record<string, number | null> = {};
    for (const l of count.lines) if (actualOf(l.itemId, l.actualQty) === null) patch[l.itemId] = l.bookQty;
    setDirtyLines((d) => ({ ...d, ...patch }));
    setDrafts((d) => {
      const n = { ...d };
      for (const k of Object.keys(patch)) delete n[k];
      return n;
    });
  };
  const allAssetsFound = () => {
    const patch: Record<string, boolean> = {};
    for (const a of checkAssets) if (foundOf(a.assetId, a.found) === null) patch[a.assetId] = true;
    setDirtyAssets((d) => ({ ...d, ...patch }));
  };

  const markInv = () => {
    const t = invInput.trim().toUpperCase();
    const m = /^(?:INV-?)?(\d{1,6})$/.exec(t);
    const inv = m ? `INV-${m[1]!.padStart(6, '0')}` : t;
    const a = checkAssets.find((x) => x.inventoryNo === inv);
    if (!a) setInvMsg(`${inv} — ombordagi ro'yxatda yo'q`);
    else {
      setDirtyAssets((d) => ({ ...d, [a.assetId]: true }));
      setInvMsg(`${inv} — bor ✓`);
      setInvInput('');
    }
  };

  const focusNext = (itemId: string) => {
    const i = lines.findIndex((l) => l.itemId === itemId);
    const next = lines[i + 1];
    if (next) document.querySelector<HTMLInputElement>(`[data-count="${next.itemId}"]`)?.focus();
  };

  const finish = async () => {
    setBusy(true);
    try {
      await flush();
      const r = await warehouseApi.finishCount(id);
      setCount(r.data);
      setConfirm(null);
      w.notify(`${r.data.number} yakunlandi`);
    } catch (err) {
      setError(errorMessage(err, "Yakunlab bo'lmadi"));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await warehouseApi.removeCount(id);
      router.push('/ombor/inventarizatsiya');
    } catch (err) {
      setError(errorMessage(err, "O'chirib bo'lmadi"));
      setConfirm(null);
      setBusy(false);
    }
  };

  const act = async () => {
    setDownloading(true);
    try {
      await flush();
      await downloadCountAct(count);
    } catch (err) {
      setError(errorMessage(err, "Dalolatnomani yuklab bo'lmadi"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader title={`Inventarizatsiya ${count.number}`} description={`${formatDate(count.date)} · ${count.status === 'DONE' ? `yakunlangan ${count.finishedAt ? formatDateTime(count.finishedAt) : ''}` : 'sanalmoqda — har o‘zgarish o‘zi saqlanadi'}`} />

      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        {/* Holat */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="min-w-[12rem] flex-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-heading">
                  Sanalgan: {counted} / {total}
                </span>
                <span className="text-(--color-text-muted)">{pct}%</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-(--color-income)' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div>
              <p className="text-xs text-(--color-text-muted)">Kamomad</p>
              <p className="money text-lg font-bold text-(--color-expense)">
                {formatTiyin(shortage)} <span className="text-xs font-normal text-(--color-text-muted)">· {shortLines} qator</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-(--color-text-muted)">Ortiqcha</p>
              <p className="money text-lg font-bold text-(--color-income)">
                {formatTiyin(surplus)} <span className="text-xs font-normal text-(--color-text-muted)">· {extraLines} qator</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void act()} loading={downloading}>
                <IconDownload className="size-4" />
                Dalolatnoma{count.status === 'DRAFT' ? ' (qoralama)' : ''}
              </Button>
              {editable && (
                <Button onClick={() => setConfirm('finish')} disabled={counted < total}>
                  Yakunlash
                </Button>
              )}
            </div>
          </div>
          {editable && (
            <div className="mt-4 grid gap-3 border-t border-(--color-line) pt-4 sm:grid-cols-2">
              <Input
                label="Komissiya raisi"
                value={head.chairman}
                onChange={(e) => {
                  setHead({ ...head, chairman: e.target.value });
                  setHeadDirty(true);
                }}
              />
              <Input
                label="Komissiya a'zolari"
                value={head.commission}
                onChange={(e) => {
                  setHead({ ...head, commission: e.target.value });
                  setHeadDirty(true);
                }}
                placeholder="F.I.Sh., vergul bilan"
              />
            </div>
          )}
          {count.status === 'DONE' && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-(--color-line) pt-4 text-sm">
              <span className="text-(--color-text-muted)">Yaratilgan hujjatlar:</span>
              {count.writeOffDocId && (
                <button type="button" onClick={() => w.openDoc(count.writeOffDocId!)} className="font-semibold text-brand-700 hover:underline">
                  Hisobdan chiqarish (kamomad) →
                </button>
              )}
              {count.receiptDocId && (
                <button type="button" onClick={() => w.openDoc(count.receiptDocId!)} className="font-semibold text-brand-700 hover:underline">
                  Kirim (ortiqcha, xarajatsiz) →
                </button>
              )}
              {!count.writeOffDocId && !count.receiptDocId && <span className="font-semibold text-(--color-income)">Farq yo&apos;q — hammasi hisobdagidek</span>}
            </div>
          )}
          {error && <p className="mt-3 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        </Card>

        {/* TMZ */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-line) px-5 py-4">
            <h2 className="text-[15px] font-bold text-heading">TMZ · {count.lines.length} xil</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Qidirish…"
                className="h-9 w-48 rounded-(--radius-control) border border-(--color-line-strong) px-3 text-sm"
              />
              {(
                [
                  ['all', 'Hammasi'],
                  ['todo', 'Sanalmagan'],
                  ['diff', 'Farqli'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={cn('rounded-lg px-3 py-1.5 text-sm', filter === k ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-200' : 'text-(--color-text-muted) hover:bg-(--color-surface-muted)')}
                >
                  {label}
                </button>
              ))}
              {editable && (
                <Button size="sm" variant="secondary" onClick={fillRest} title="Sanalmagan qatorlarga hisobdagi miqdorni qo'yish">
                  Qolganlari hisobdagidek
                </Button>
              )}
            </div>
          </div>
          {lines.length === 0 ? (
            <EmptyState title={filter === 'todo' ? 'Hammasi sanalgan' : filter === 'diff' ? "Farq yo'q" : 'Topilmadi'} />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Nomi</Th>
                  <Th className="w-32" align="right">
                    Hisobda
                  </Th>
                  <Th className="w-40" align="right">
                    Haqiqatda
                  </Th>
                  <Th className="w-28" align="right">
                    Farq
                  </Th>
                  <Th className="w-36" align="right">
                    Farq, so&apos;m
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {lines.map((l) => {
                  const a = actualOf(l.itemId, l.actualQty);
                  const diff = a === null ? null : Math.round((a - l.bookQty) * 1000) / 1000;
                  const text = l.itemId in drafts ? drafts[l.itemId]! : a === null ? '' : String(a);
                  return (
                    <Tr key={l.itemId} className={cn(diff !== null && diff < -EPS && 'bg-(--color-expense-soft)/40', diff !== null && diff > EPS && 'bg-(--color-income-soft)/40')}>
                      <Td>
                        <span className="font-medium text-heading">{l.name}</span>
                        <span className="ml-2 text-xs text-(--color-text-muted)">
                          {l.code}
                          {l.group ? ` · ${l.group}` : ''}
                        </span>
                      </Td>
                      <Td align="right" money>
                        {qtyText(l.bookQty)} <span className="text-xs text-(--color-text-muted)">{l.unit}</span>
                      </Td>
                      <Td align="right">
                        {editable ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setActual(l.itemId, String(l.bookQty))}
                              className="rounded px-1.5 py-1 text-[11px] text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700"
                              title="Hisobdagidek"
                            >
                              =
                            </button>
                            <input
                              data-count={l.itemId}
                              inputMode="decimal"
                              value={text}
                              onChange={(e) => setActual(l.itemId, e.target.value.replace(/[^\d.,]/g, ''))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  focusNext(l.itemId);
                                }
                              }}
                              className={cn('money h-9 w-24 rounded-(--radius-control) border bg-white px-2 text-right text-sm focus:border-brand-600', a === null ? 'border-amber-300' : 'border-(--color-line-strong)')}
                              placeholder="—"
                            />
                          </div>
                        ) : (
                          <span className="money">{a === null ? '—' : qtyText(a)}</span>
                        )}
                      </Td>
                      <Td align="right" money className={cn('font-semibold', diff !== null && diff < -EPS && 'text-(--color-expense)', diff !== null && diff > EPS && 'text-(--color-income)')}>
                        {diff === null ? '' : Math.abs(diff) < EPS ? '✓' : `${diff > 0 ? '+' : ''}${qtyText(diff)}`}
                      </Td>
                      <Td align="right" money>
                        {diff === null || Math.abs(diff) < EPS ? '' : formatTiyin(Math.round(diff * Number(l.priceTiyin)))}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Asosiy vositalar */}
        {count.assets.length > 0 && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-line) px-5 py-4">
              <h2 className="text-[15px] font-bold text-heading">Omborda turishi kerak bo&apos;lgan asosiy vositalar · {checkAssets.length} ta</h2>
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={invInput}
                    onChange={(e) => {
                      setInvInput(e.target.value);
                      setInvMsg(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') markInv();
                    }}
                    placeholder="Inventar № + Enter"
                    className="h-9 w-56 rounded-(--radius-control) border border-(--color-line-strong) px-3 font-mono text-sm"
                  />
                  <Button size="sm" variant="secondary" onClick={allAssetsFound}>
                    Qolganlari bor
                  </Button>
                </div>
              )}
            </div>
            {invMsg && <p className="border-b border-(--color-line) bg-(--color-surface-muted) px-5 py-2 text-xs">{invMsg}</p>}
            <Table>
              <TBody>
                {count.assets.map((a) => {
                  const f = foundOf(a.assetId, a.found);
                  return (
                    <Tr key={a.assetId} className={cn(f === false && 'bg-(--color-expense-soft)/40')}>
                      <Td className="w-32 font-mono text-xs font-semibold text-brand-700">{a.inventoryNo}</Td>
                      <Td>
                        <span className="font-medium text-heading">{a.name}</span>
                        {a.serialNo && <span className="ml-2 text-xs text-(--color-text-muted)">S/N {a.serialNo}</span>}
                      </Td>
                      <Td align="right" money className="w-32">
                        {formatTiyin(a.priceTiyin)}
                      </Td>
                      <Td className="w-48 text-right">
                        {a.moved ? (
                          <span className="text-xs text-(--color-text-muted)">sanoq paytida berilgan</span>
                        ) : editable ? (
                          <div className="inline-flex overflow-hidden rounded-(--radius-control) border border-(--color-line-strong)">
                            <button
                              type="button"
                              onClick={() => setDirtyAssets((d) => ({ ...d, [a.assetId]: f === true ? null : true }))}
                              className={cn('px-3 py-1.5 text-sm', f === true ? 'bg-(--color-income) font-semibold text-white' : 'hover:bg-(--color-surface-muted)')}
                            >
                              Bor
                            </button>
                            <button
                              type="button"
                              onClick={() => setDirtyAssets((d) => ({ ...d, [a.assetId]: f === false ? null : false }))}
                              className={cn('border-l border-(--color-line-strong) px-3 py-1.5 text-sm', f === false ? 'bg-(--color-expense) font-semibold text-white' : 'hover:bg-(--color-surface-muted)')}
                            >
                              Yo&apos;q
                            </button>
                          </div>
                        ) : (
                          <span className={cn('text-sm font-semibold', f === false ? 'text-(--color-expense)' : 'text-(--color-income)')}>{f === null ? '—' : f ? 'bor' : "yo'q"}</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        )}

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--color-text-muted)">
            <span>{saving ? 'Saqlanmoqda…' : dirtyCount ? 'Saqlanmagan o‘zgarishlar bor…' : savedAt ? `Saqlandi ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Har o‘zgarish o‘zi saqlanadi'}</span>
            <button type="button" onClick={() => setConfirm('remove')} className="font-semibold text-(--color-expense) hover:underline">
              Bu inventarizatsiyani o&apos;chirish
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === 'remove'}
        loading={busy}
        title={confirm === 'remove' ? "Inventarizatsiyani o'chirish" : 'Inventarizatsiyani yakunlash'}
        message={
          confirm === 'remove'
            ? "Sanalgan miqdorlar o'chadi. Qoldiq va hujjatlarga ta'sir qilmaydi."
            : `Kamomad: ${shortLines} qator, ${formatTiyin(shortage)} so'm — «Hisobdan chiqarish» hujjati bo'ladi. Ortiqcha: ${extraLines} qator, ${formatTiyin(surplus)} so'm — kirim (xarajatga yozilmaydi). Yakunlangach o'zgartirib bo'lmaydi.`
        }
        confirmLabel={confirm === 'remove' ? "O'chirish" : 'Yakunlash'}
        onConfirm={() => void (confirm === 'remove' ? remove() : finish())}
        onCancel={() => setConfirm(null)}
      />
      {w.element}
    </>
  );
}

function Inner() {
  const params = useSearchParams();
  const id = params.get('id');
  return id ? <CountSheet key={id} id={id} /> : <CountList />;
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Inner />
    </Suspense>
  );
}