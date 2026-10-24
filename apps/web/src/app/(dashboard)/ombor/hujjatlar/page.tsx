'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconDownload, IconTrash } from '@/components/ui/icons';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { DOC_KIND_HINTS, DOC_KIND_LABELS, DOC_KIND_PATHS, downloadAct, warehouseApi, type DocKind, type WarehouseDoc } from '@/features/warehouse/api';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { DocKindBadge } from '@/features/warehouse/bits';
import { DocButtons } from '@/features/warehouse/doc-buttons';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Hujjatlar — davrdagi barcha hujjatlar, tur bo'yicha yorliqlar.
// Qatorni bosing — tafsilot; o'ngdagi belgi — Word dalolatnoma; savatcha — bekor qilish (o'chirish).
// Belgilab bir nechtasini birdan bekor qilish mumkin: eng yangisidan boshlab (keyingi harakatlar avval).
// ═══════════════════════════════════════════════════════════

type KindTab = 'ALL' | DocKind;
const KINDS: DocKind[] = ['RECEIPT', 'ISSUE', 'TRANSFER', 'RETURN', 'WRITE_OFF'];

/** Ro'yxatdagi «Kimga / kimdan» ustuni */
function partyText(d: WarehouseDoc): string {
  if (d.kind === 'RECEIPT') return [d.counterparty, d.to.text !== 'Ombor' ? `hisobiga: ${d.to.text}` : null].filter(Boolean).join(' · ') || '—';
  if (d.kind === 'WRITE_OFF') return d.reason ?? '—';
  if (d.kind === 'RETURN') return `${d.from?.text ?? d.to.text} → Ombor`;
  if (d.kind === 'TRANSFER') return `${d.from?.text ?? 'turli joylardan'} → ${d.to.text}`;
  return `Ombor → ${d.to.text}`;
}

export default function WarehouseDocsPage() {
  const searchParams = useSearchParams();
  const initialKind = searchParams.get('kind');
  const [kind, setKind] = useState<KindTab>(KINDS.includes(initialKind as DocKind) ? (initialKind as DocKind) : 'ALL');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const { range } = usePeriod();
  const { canWrite, isAdmin } = useAuth();
  const editable = canWrite('/ombor');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<WarehouseDoc[] | null>(null);
  const [removing, setRemoving] = useState(false);

  const list = useAsync(
    () => warehouseApi.docs({ kind: kind === 'ALL' ? undefined : kind, from: range.from, to: range.to, search }),
    [kind, range.from, range.to, search],
  );
  const w = useWarehouseDialogs(list.reload);
  // Filtr o'zgarsa — belgilashlar tozalanadi
  useEffect(() => setSelected([]), [kind, range.from, range.to, search]);

  const docs = list.data?.data ?? [];
  const active = docs.filter((d) => !d.cancelled);
  const total = active.reduce((s, d) => s + Number(d.totalTiyin), 0);

  /** Bekor qilish mumkinmi: bekor qilinmagan; kirim — faqat administrator (moliyaviy yozuv) */
  const removable = (d: WarehouseDoc) => editable && !d.cancelled && (d.kind !== 'RECEIPT' || isAdmin);
  const selectable = docs.filter(removable);
  const allChecked = selectable.length > 0 && selectable.every((d) => selected.includes(d.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const remove = async () => {
    if (!confirm) return;
    setRemoving(true);
    try {
      const r = (await warehouseApi.cancelDocs(confirm.map((d) => d.id))).data;
      if (r.failed.length) {
        w.notify(
          `${r.cancelled.length} ta bekor qilindi, ${r.failed.length} tasi bekor bo'lmadi: ${r.failed
            .slice(0, 3)
            .map((f) => `${f.number} — ${f.reason}`)
            .join('; ')}${r.failed.length > 3 ? ' …' : ''}`,
          'error',
        );
      } else {
        w.notify(`${r.cancelled.length} ta hujjat bekor qilindi${r.cancelled.length <= 3 ? `: ${r.cancelled.map((c) => c.number).join(', ')}` : ''}`);
      }
      setSelected([]);
      list.reload();
    } catch (err) {
      w.notify(errorMessage(err, "Bekor qilib bo'lmadi"), 'error');
    } finally {
      setRemoving(false);
      setConfirm(null);
    }
  };

  const act = async (d: WarehouseDoc) => {
    setDownloading(d.id);
    try {
      await downloadAct(d);
    } catch (err) {
      w.notify(errorMessage(err, "Dalolatnomani yuklab bo'lmadi"), 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader title="Hujjatlar jurnali" description={`${formatDate(range.from)} – ${formatDate(range.to)} · qatorni bosing — tafsilot; «Nusxa» — shu hujjat asosida yangisi`} />

      <div className="space-y-4 p-6">
        <SourceActions
          add={{ label: w.keeper ? 'Qabul qilish' : 'Kirim', onClick: () => w.newDoc('RECEIPT'), hint: DOC_KIND_HINTS.RECEIPT }}
          extra={<DocButtons onNew={(k) => w.newDoc(k)} />}
          remove={
            editable
              ? {
                  count: selected.length,
                  label: "Belgilanganlarni o'chirish",
                  hint: isAdmin ? "Qatorlarni belgilang — bekor qilinadi (qoldiq va vositalar holati qaytadi)" : "Qatorlarni belgilang. Kirimni faqat administrator bekor qiladi",
                  onClick: () => setConfirm(docs.filter((d) => selected.includes(d.id))),
                }
              : undefined
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SubTabs<KindTab>
            value={kind}
            onChange={setKind}
            options={[{ value: 'ALL', label: 'Barchasi' }, ...KINDS.map((k) => ({ value: k, label: DOC_KIND_LABELS[k], hint: DOC_KIND_HINTS[k] }))]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Raqam, yetkazib beruvchi, buyum, odam" className="w-80" />
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : docs.length === 0 ? (
            <EmptyState title="Hujjat topilmadi" hint={search ? 'search' : 'period'} />
          ) : (
            <Table>
              <THead>
                <Tr>
                  {editable && (
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Hammasini belgilash"
                        checked={allChecked}
                        disabled={!selectable.length}
                        onChange={() => setSelected(allChecked ? [] : selectable.map((d) => d.id))}
                        className="size-4"
                      />
                    </Th>
                  )}
                  <Th className="w-36">Raqam</Th>
                  <Th className="w-36">Sana · kiritdi</Th>
                  <Th className="w-40">Turi</Th>
                  <Th>Kimga / kimdan</Th>
                  <Th className="w-24" align="right">
                    Qatorlar
                  </Th>
                  <Th className="w-40" align="right">
                    Summa, so&apos;m
                  </Th>
                  <Th className={editable ? 'w-36' : 'w-12'} />
                </Tr>
              </THead>
              <TBody>
                {docs.map((d) => (
                  <Tr key={d.id} clickable onClick={() => w.openDoc(d.id)} className={cn(selected.includes(d.id) && 'bg-brand-50/60')}>
                    {editable && (
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`${d.number} belgilash`}
                          disabled={!removable(d)}
                          title={d.cancelled ? 'Bekor qilingan' : !removable(d) ? 'Kirimni faqat administrator bekor qiladi' : undefined}
                          checked={selected.includes(d.id)}
                          onChange={() => toggle(d.id)}
                          className="size-4"
                        />
                      </Td>
                    )}
                    <Td className={cn('money font-semibold text-brand-700', d.cancelled && 'text-(--color-text-faint)')}>{d.number}</Td>
                    <Td>
                      {formatDate(d.date)}
                      {d.createdByName && <p className="max-w-[9rem] truncate text-[11px] text-(--color-text-faint)" title={`Kiritdi: ${d.createdByName}`}>{d.createdByName}</p>}
                    </Td>
                    <Td>
                      {d.cancelled ? <Badge tone="neutral">Bekor qilingan</Badge> : <DocKindBadge kind={d.kind} />}
                    </Td>
                    <Td className={cn('text-(--color-text-muted)', d.cancelled && 'line-through')}>{partyText(d)}</Td>
                    <Td align="right" money>
                      {d.lines.length + (d.kind === 'RECEIPT' ? 0 : d.assets.length)}
                    </Td>
                    <Td align="right" money className={cn('font-semibold', d.cancelled && 'text-(--color-text-faint) line-through')}>
                      {formatTiyin(d.totalTiyin)}
                    </Td>
                    <Td className="whitespace-nowrap pr-3 text-right">
                      {editable && (
                        <Link
                          href={`${DOC_KIND_PATHS[d.kind]}?copy=${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title="Shu hujjat asosida yangisini ochish (qatorlar va oluvchi tayyor)"
                          className="mr-1 rounded px-1.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                        >
                          Nusxa
                        </Link>
                      )}
                      <button
                        type="button"
                        title="Dalolatnoma (Word)"
                        disabled={downloading === d.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void act(d);
                        }}
                        className="rounded p-1.5 text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                      >
                        <IconDownload className="size-4" />
                      </button>
                      {removable(d) && (
                        <button
                          type="button"
                          title="O'chirish (bekor qilish)"
                          aria-label={`${d.number} — o'chirish`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirm([d]);
                          }}
                          className="rounded p-1.5 text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
                        >
                          <IconTrash className="size-4" />
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
              <TFoot>
                <Tr>
                  <Td colSpan={editable ? 6 : 5} className="font-semibold">
                    Jami: {active.length} ta hujjat{docs.length > active.length ? ` (bekor qilinganlar hisobga olinmagan: ${docs.length - active.length})` : ''}
                  </Td>
                  <Td align="right" money className="font-bold" title={kind === 'ALL' ? "Turli hujjat turlarini qo'shib bo'lmaydi — turni tanlang" : undefined}>
                    {kind === 'ALL' ? '—' : formatTiyin(total)}
                  </Td>
                  <Td />
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm && confirm.length > 1 ? `${confirm.length} ta hujjatni o'chirish` : "Hujjatni o'chirish"}
        message={
          confirm
            ? `${confirm.length > 1 ? `${confirm.slice(0, 5).map((d) => d.number).join(', ')}${confirm.length > 5 ? ' …' : ''} bekor qilinadi` : `${confirm[0]?.number ?? ''} bekor qilinadi`}: TMZ qoldig'i va asosiy vositalar holati qaytariladi${confirm.some((d) => d.kind === 'RECEIPT') ? ', kirim xarajatlari savatga tushadi, kirimdagi vositalar o\'chadi' : ''}. Ro'yxatda «Bekor qilingan» bo'lib qoladi. Bir nechta bo'lsa — eng yangisidan boshlab.`
            : ''
        }
        confirmLabel="O'chirish"
        danger
        loading={removing}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />

      {w.element}
    </>
  );
}