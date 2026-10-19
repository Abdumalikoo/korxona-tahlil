'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconDownload } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import {
  downloadCard,
  holderQuery,
  qtyText,
  targetSearch,
  warehouseApi,
  type Holdings,
} from '@/features/warehouse/api';
import { EMPTY_TARGET, TargetPicker, targetEmpty, type TargetValue } from '@/features/warehouse/target-picker';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Kimda nima bor: odam, bo'lim yoki hudud tanlanadi —
//   unga biriktirilgan asosiy vositalar va berilgan (qaytmagan) TMZ,
//   mulk kartochkasi (Word, imzo uchun), «Qaytarish», «Yana berish», tanlanganlarni «Ko'chirish».
// Pastda — bo'limlar ro'yxati: bir bosishda tanlash.
// ═══════════════════════════════════════════════════════════

function fromParams(params: URLSearchParams): TargetValue {
  return {
    holderPinfl: params.get('holderPinfl') ?? '',
    holderName: params.get('holderName') ?? '',
    departmentId: params.get('departmentId') ?? '',
    regionCode: params.get('regionCode') ?? (params.get('departmentId') ? '0' : ''),
  };
}

function KimdaInner() {
  const params = useSearchParams();
  const { canWrite } = useAuth();
  const editable = canWrite('/ombor');
  const [target, setTarget] = useState<TargetValue>(() => fromParams(params));
  const [data, setData] = useState<Holdings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [tick, setTick] = useState(0);
  const w = useWarehouseDialogs(() => setTick((t) => t + 1));
  const overview = useAsync(() => warehouseApi.overview('2000-01-01', '2100-01-01'), []);

  useEffect(() => {
    setSelected([]);
    if (targetEmpty(target)) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    warehouseApi
      .holdings(holderQuery(target))
      .then((r) => alive && setData(r.data))
      .catch((err) => alive && setError(errorMessage(err, "Ma'lumotni olib bo'lmadi")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [target.holderPinfl, target.holderName, target.departmentId, target.regionCode, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = async () => {
    setDownloading(true);
    try {
      await downloadCard(holderQuery(target));
    } catch (err) {
      w.notify(errorMessage(err, "Kartochkani yuklab bo'lmadi"), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const places = overview.data?.data.byPlace ?? [];
  const assetsValue = (data?.assets ?? []).reduce((s, a) => s + Number(a.priceTiyin), 0);
  const tmzValue = (data?.tmz ?? []).reduce((s, t) => s + Math.round(t.qty * Number(t.avgPriceTiyin)), 0);
  const q = targetSearch(target);
  const allChecked = (data?.assets.length ?? 0) > 0 && data!.assets.every((a) => selected.includes(a.id));

  const pickPlace = (key: string) => {
    if (key.startsWith('d:')) setTarget({ ...EMPTY_TARGET, departmentId: key.slice(2), regionCode: '0' });
    else if (key.startsWith('r:')) setTarget({ ...EMPTY_TARGET, regionCode: key.slice(2) });
    else if (key === 'center') setTarget({ ...EMPTY_TARGET, regionCode: '0' });
  };

  return (
    <>
      <PageHeader title="Kimda nima bor" description="Odam, bo'lim yoki hudud — unga biriktirilgan mulk va mulk kartochkasi" />

      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <Card className="p-5">
          <TargetPicker value={target} onChange={setTarget} lookups={w.lookups} label="Kim" hint="Xodimni ism yoki PINFL bo'yicha qidiring, yoki bo'lim / hududni tanlang" />
        </Card>

        {targetEmpty(target) ? (
          <Card className="overflow-hidden">
            <CardHeader title="Bo'limlar va hududlar" description="Kimga biriktirilgan mulk bor — bosing" />
            {places.length === 0 ? (
              <EmptyState title="Hali hech kimga hech narsa berilmagan" />
            ) : (
              <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {places
                  .filter((p) => p.key !== 'person')
                  .map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => pickPlace(p.key)}
                      className="rounded-(--radius-control) border border-(--color-line) px-4 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                    >
                      <p className="font-semibold text-heading">{p.name}</p>
                      <p className="mt-0.5 text-xs text-(--color-text-muted)">
                        {p.assets} ta asosiy vosita · {formatTiyin(p.assetsValueTiyin)} so&apos;m
                        {Number(p.tmzIssuedTiyin) > 0 ? ` · TMZ ${formatTiyin(p.tmzIssuedTiyin)}` : ''}
                      </p>
                    </button>
                  ))}
              </div>
            )}
          </Card>
        ) : loading && !data ? (
          <LoadingState />
        ) : error ? (
          <Card className="p-5 text-sm text-(--color-expense)">{error}</Card>
        ) : data ? (
          <>
            {/* Kim va amallar */}
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Moddiy javobgar</p>
                  <p className="mt-1 text-xl font-bold text-heading">{data.title}</p>
                  <p className="mt-1 text-sm text-(--color-text-muted)">
                    {data.assets.length} ta asosiy vosita · <span className="money">{formatTiyin(assetsValue)}</span> so&apos;m
                    {data.tmz.length > 0 && (
                      <>
                        {' '}
                        · {data.tmz.length} xil TMZ · <span className="money">{formatTiyin(tmzValue)}</span> so&apos;m
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void card()} loading={downloading} disabled={data.assets.length === 0 && data.tmz.length === 0}>
                    <IconDownload className="size-4" />
                    Mulk kartochkasi (Word)
                  </Button>
                  {editable && (
                    <>
                      <Link
                        href={`/ombor/chiqim?${q}`}
                        className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-4 text-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      >
                        Yana berish
                      </Link>
                      <Link
                        href={`/ombor/qaytarish?${q}`}
                        className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-4 text-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      >
                        Qaytarish
                      </Link>
                    </>
                  )}
                </div>
              </div>
              {data.lastIssue && (
                <p className="mt-3 text-xs text-(--color-text-muted)">
                  Oxirgi berilgan: {formatDate(data.lastIssue.date)} ·{' '}
                  <button type="button" onClick={() => w.openDoc(data.lastIssue!.id)} className="font-mono font-semibold text-brand-700 hover:underline">
                    {data.lastIssue.number}
                  </button>
                </p>
              )}
            </Card>

            {/* Asosiy vositalar */}
            <Card className="overflow-hidden">
              <CardHeader
                title={`Asosiy vositalar · ${data.assets.length} ta`}
                description="Qatorni bosing — harakat tarixi"
                actions={
                  editable && selected.length > 0 ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => w.newDoc('TRANSFER', selected)}>
                        Ko&apos;chirish ({selected.length})
                      </Button>
                      <Link
                        href={`/ombor/qaytarish?${q}&assets=${selected.join(',')}`}
                        className="inline-flex h-9 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3.5 text-sm hover:border-brand-300 hover:bg-brand-50"
                      >
                        Qaytarish ({selected.length})
                      </Link>
                    </div>
                  ) : undefined
                }
              />
              {data.assets.length === 0 ? (
                <p className="px-5 py-4 text-sm text-(--color-text-muted)">Biriktirilgan asosiy vosita yo&apos;q.</p>
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      {editable && (
                        <Th className="w-10">
                          <input type="checkbox" className="size-4" checked={allChecked} onChange={() => setSelected(allChecked ? [] : data.assets.map((a) => a.id))} aria-label="Hammasini belgilash" />
                        </Th>
                      )}
                      <Th className="w-32">Inventar</Th>
                      <Th>Nomi</Th>
                      <Th>Qayerda</Th>
                      <Th className="w-28">Kirim</Th>
                      <Th className="w-36" align="right">
                        Qiymati
                      </Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {data.assets.map((a) => {
                      const on = selected.includes(a.id);
                      return (
                        <Tr key={a.id} clickable onClick={() => w.openAsset(a.id)} className={cn(on && 'bg-brand-50/60')}>
                          {editable && (
                            <Td onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" className="size-4" checked={on} onChange={() => setSelected((l) => (on ? l.filter((x) => x !== a.id) : [...l, a.id]))} aria-label={`${a.inventoryNo} belgilash`} />
                            </Td>
                          )}
                          <Td className="money text-xs font-semibold text-brand-700">{a.inventoryNo}</Td>
                          <Td>
                            <span className="font-medium text-heading">{a.name}</span>
                            {a.serialNo && <span className="ml-2 text-xs text-(--color-text-muted)">S/N {a.serialNo}</span>}
                          </Td>
                          <Td className="text-(--color-text-muted)">{a.place.text}</Td>
                          <Td className="text-(--color-text-muted)">{formatDate(a.acquiredAt)}</Td>
                          <Td align="right" money>
                            {formatTiyin(a.priceTiyin)}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                  <TFoot>
                    <Tr>
                      <Td colSpan={editable ? 5 : 4} className="font-semibold">
                        Jami
                      </Td>
                      <Td align="right" money className="font-bold">
                        {formatTiyin(assetsValue)}
                      </Td>
                    </Tr>
                  </TFoot>
                </Table>
              )}
            </Card>

            {/* TMZ */}
            <Card className="overflow-hidden">
              <CardHeader title={`Berilgan TMZ (qaytmagan) · ${data.tmz.length} xil`} description="Chiqim − qaytarish. Sarflanadigan buyumlar ishlatilib bo'lgan bo'lishi mumkin." />
              {data.tmz.length === 0 ? (
                <p className="px-5 py-4 text-sm text-(--color-text-muted)">Berilgan TMZ yo&apos;q.</p>
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-28">Kod</Th>
                      <Th>Nomi</Th>
                      <Th className="w-36" align="right">
                        Miqdor
                      </Th>
                      <Th className="w-40" align="right">
                        Summa
                      </Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {data.tmz.map((t) => (
                      <Tr key={t.itemId}>
                        <Td className="money text-xs text-(--color-text-muted)">{t.itemCode}</Td>
                        <Td className="font-medium text-heading">{t.itemName}</Td>
                        <Td align="right" money>
                          {qtyText(t.qty)} {t.unit}
                        </Td>
                        <Td align="right" money>
                          {formatTiyin(Math.round(t.qty * Number(t.avgPriceTiyin)))}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                  <TFoot>
                    <Tr>
                      <Td colSpan={3} className="font-semibold">
                        Jami
                      </Td>
                      <Td align="right" money className="font-bold">
                        {formatTiyin(tmzValue)}
                      </Td>
                    </Tr>
                  </TFoot>
                </Table>
              )}
            </Card>
          </>
        ) : null}
      </div>

      {w.element}
    </>
  );
}

export default function KimdaPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <KimdaInner />
    </Suspense>
  );
}