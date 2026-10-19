'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { IconDownload } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatTiyin } from '@/lib/format';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DOC_KIND_HINTS, downloadAct, qtyText, warehouseApi, type WarehouseDoc } from './api';
import { DocKindBadge, Field } from './bits';

// ═══════════════════════════════════════════════════════════
// Hujjat oynasi: kim, qayerga, qatorlar, jami; Word dalolatnoma va bekor qilish.
// Kirim bekor qilinsa — Xarajatlardagi yozuvlari ham bekor bo'ladi.
// ═══════════════════════════════════════════════════════════

export function DocDrawer({
  docId,
  onClose,
  onChanged,
  onOpenAsset,
}: {
  docId: string | null;
  onClose: () => void;
  /** Bekor qilingandan keyin ro'yxatni yangilash */
  onChanged: (message: string) => void;
  onOpenAsset?: (assetId: string) => void;
}) {
  const { canWrite, canView } = useAuth();
  /** Kiritish huquqi: administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  const [doc, setDoc] = useState<WarehouseDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!docId) return;
    setDoc(null);
    setLoading(true);
    setError(null);
    setActionError(null);
    warehouseApi
      .doc(docId)
      .then((r) => setDoc(r.data))
      .catch((err) => setError(errorMessage(err, "Hujjatni ochib bo'lmadi")))
      .finally(() => setLoading(false));
  }, [docId, tick]);

  const act = async () => {
    if (!doc) return;
    setDownloading(true);
    setActionError(null);
    try {
      await downloadAct(doc);
    } catch (err) {
      setActionError(errorMessage(err, "Dalolatnomani yuklab bo'lmadi"));
    } finally {
      setDownloading(false);
    }
  };

  const cancel = async () => {
    if (!doc) return;
    setCancelling(true);
    setActionError(null);
    try {
      const r = await warehouseApi.cancelDoc(doc.id);
      setDoc(r.data);
      setConfirm(false);
      onChanged(`${r.data.number} bekor qilindi`);
    } catch (err) {
      setConfirm(false);
      setActionError(errorMessage(err, "Bekor qilib bo'lmadi"));
    } finally {
      setCancelling(false);
    }
  };

  const expenses = doc ? doc.lines.filter((l) => l.expenseId).length : 0;

  return (
    <>
      <Drawer
        open={Boolean(docId)}
        onClose={onClose}
        width="lg"
        title={doc ? `${doc.kindLabel} № ${doc.number}` : 'Hujjat'}
        description={doc ? DOC_KIND_HINTS[doc.kind] : undefined}
        footer={
          doc ? (
            <>
              {isAdmin && !doc.cancelled && (
                <Button variant="ghost" className="mr-auto text-(--color-expense)" onClick={() => setConfirm(true)}>
                  Hujjatni bekor qilish
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Yopish
              </Button>
              <Button onClick={() => void act()} loading={downloading}>
                <IconDownload className="size-4" />
                Dalolatnoma (Word)
              </Button>
            </>
          ) : undefined
        }
      >
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : doc ? (
          <div className="space-y-5">
            {doc.cancelled && (
              <p className="rounded-(--radius-control) border border-(--color-expense) bg-(--color-expense-soft) px-3 py-2 text-sm font-semibold text-(--color-expense)">
                Bu hujjat bekor qilingan — qoldiq va xarajatlarda hisobga olinmaydi.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Turi">
                <DocKindBadge kind={doc.kind} />
              </Field>
              <Field label="Sana">{formatDate(doc.date)}</Field>
              <Field label="Jami summa">
                <span className="money">{formatTiyin(doc.totalTiyin)} so&apos;m</span>
              </Field>

              {doc.kind === 'RECEIPT' && (
                <>
                  <Field label="Yetkazib beruvchi">{doc.counterparty}</Field>
                  <Field label="Asos (hujjat raqami)">{doc.documentNo}</Field>
                  <Field label="Kimning hisobiga">{doc.to.text === 'Ombor' ? 'Markaz (umumiy)' : doc.to.text}</Field>
                </>
              )}
              {doc.kind !== 'RECEIPT' && doc.kind !== 'WRITE_OFF' && (
                <>
                  <Field label="Qayerdan">{doc.from?.text ?? (doc.kind === 'ISSUE' ? 'Ombor' : 'turli joylardan')}</Field>
                  <Field label="Qayerga">{doc.kind === 'RETURN' ? 'Ombor' : doc.to.text}</Field>
                </>
              )}
              {doc.kind === 'WRITE_OFF' && <Field label="Sabab">{doc.reason}</Field>}
              <Field label={doc.kind === 'RECEIPT' ? 'Qabul qildi' : 'Topshirdi'}>{doc.issuedBy}</Field>
              <Field label="Mas'ul shaxs">{doc.responsible}</Field>
              {doc.note && <Field label="Izoh">{doc.note}</Field>}
            </div>

            {doc.kind === 'RECEIPT' && expenses > 0 && (
              <div className="rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                Xarajatlarga {expenses} ta yozuv tushgan (manba: Ombor){doc.cancelled ? ' — bekor qilingan' : ''}.{' '}
                {canView('/xarajatlar') && (
                  <Link href={`/xarajatlar?period=${doc.period}`} className="font-semibold text-brand-700 hover:underline">
                    Xarajatlarda ko&apos;rish →
                  </Link>
                )}
              </div>
            )}

            {doc.lines.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-heading">Qatorlar</p>
                <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
                  <table className="w-full text-sm">
                    <thead className="bg-(--color-surface-muted) text-xs text-(--color-text-muted)">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Nomi</th>
                        <th className="px-3 py-2 text-right font-medium">Miqdor</th>
                        <th className="px-3 py-2 text-right font-medium">Narx</th>
                        <th className="px-3 py-2 text-right font-medium">Summa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l) => (
                        <tr key={l.id} className="border-t border-(--color-line)">
                          <td className="px-3 py-2">
                            <span className="font-medium text-heading">{l.itemName}</span>
                            <span className="ml-2 text-xs text-(--color-text-muted)">
                              {l.itemCode}
                              {l.kind === 'ASSET' ? ' · asosiy vosita' : ''}
                            </span>
                          </td>
                          <td className="money px-3 py-2 text-right">
                            {qtyText(l.qty)} {l.unit}
                          </td>
                          <td className="money px-3 py-2 text-right">{formatTiyin(l.priceTiyin)}</td>
                          <td className="money px-3 py-2 text-right font-semibold">{formatTiyin(l.amountTiyin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {doc.assets.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-heading">
                  Asosiy vositalar <span className="font-normal text-(--color-text-muted)">· {doc.assets.length} ta</span>
                </p>
                <div className="max-h-72 overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
                  {doc.assets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!onOpenAsset}
                      onClick={() => onOpenAsset?.(a.id)}
                      className="flex w-full items-center gap-3 border-b border-(--color-line) px-3 py-2 text-left text-sm last:border-b-0 enabled:hover:bg-brand-50"
                    >
                      <span className="money w-28 shrink-0 text-xs font-semibold text-brand-700">{a.inventoryNo}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      {a.condition && <span className="shrink-0 rounded-full bg-(--color-surface-muted) px-2 py-0.5 text-[11px] text-(--color-text-muted)">{a.condition}</span>}
                      <span className="money shrink-0 text-xs">{formatTiyin(a.priceTiyin)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-0.5 text-xs text-(--color-text-faint)">
              <p>
                Kiritdi: <span className="font-medium text-(--color-text-muted)">{doc.createdByName ?? '—'}</span> · {formatDateTime(doc.createdAt)}
              </p>
              {doc.cancelled && (
                <p>
                  Bekor qildi: <span className="font-medium text-(--color-text-muted)">{doc.cancelledByName ?? '—'}</span>
                  {doc.cancelledAt ? ` · ${formatDateTime(doc.cancelledAt)}` : ''}
                </p>
              )}
            </div>
            {actionError && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{actionError}</p>}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={confirm}
        danger
        loading={cancelling}
        title="Hujjatni bekor qilish"
        message={
          doc?.kind === 'RECEIPT'
            ? "Kirim bekor qilinadi: qoldiq kamayadi, Xarajatlardagi yozuvlari ham bekor bo'ladi, shu kirimda kelgan asosiy vositalar o'chiriladi. Davom etasizmi?"
            : "Hujjat bekor qilinadi: qoldiq va asosiy vositalar joyi hujjatdan oldingi holatga qaytadi. Davom etasizmi?"
        }
        confirmLabel="Bekor qilish"
        cancelLabel="Yo'q"
        onConfirm={() => void cancel()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}