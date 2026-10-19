'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { warehouseApi, type AssetMove, type DocKind, type WarehouseAsset } from './api';
import { AssetStatusBadge, DocKindBadge, Field } from './bits';

// ═══════════════════════════════════════════════════════════
// Asosiy vosita kartasi: hozir kimda / qayerda, harakat tarixi
// (masalan: Strategiya bo'limi → Kadrlar bo'limi), tez amallar —
// Berish, Ko'chirish, Qaytarish, Hisobdan chiqarish (har biri hujjat va dalolatnoma bilan).
// ═══════════════════════════════════════════════════════════

export function AssetDrawer({
  assetId,
  onClose,
  onAction,
  onOpenDoc,
  onChanged,
}: {
  assetId: string | null;
  onClose: () => void;
  /** Tez amal: shu vosita oldindan tanlangan hujjat formasi ochiladi */
  onAction: (kind: DocKind, assetId: string) => void;
  onOpenDoc: (docId: string) => void;
  onChanged: (message: string) => void;
}) {
  const { canWrite, isWorker } = useAuth();
  /** Tuzatish huquqi (seriya, izoh): administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  /** Yangi hujjat (berish, ko'chirish …) — faqat Omborchi bo'limida; umumiy hudud dashbordida yo'q */
  const canMove = isAdmin && isWorker;
  const [asset, setAsset] = useState<WarehouseAsset | null>(null);
  const [moves, setMoves] = useState<AssetMove[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [serialNo, setSerialNo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    setLoading(true);
    setError(null);
    setSaveError(null);
    warehouseApi
      .asset(assetId)
      .then((r) => {
        setAsset(r.data.asset);
        setMoves(r.data.moves);
        setSerialNo(r.data.asset.serialNo ?? '');
        setNote(r.data.asset.note ?? '');
      })
      .catch((err) => setError(errorMessage(err, "Ochib bo'lmadi")))
      .finally(() => setLoading(false));
  }, [assetId, tick]);

  const dirty = asset ? serialNo !== (asset.serialNo ?? '') || note !== (asset.note ?? '') : false;

  const save = async () => {
    if (!asset) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await warehouseApi.updateAsset(asset.id, { serialNo: serialNo.trim() || null, note: note.trim() || null });
      setAsset(r.data);
      onChanged(`${r.data.inventoryNo} saqlandi`);
    } catch (err) {
      setSaveError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  const actions: { kind: DocKind; label: string; show: boolean; primary?: boolean }[] = asset
    ? [
        { kind: 'ISSUE', label: 'Berish', show: asset.status === 'IN_STOCK', primary: true },
        { kind: 'TRANSFER', label: "Ko'chirish", show: asset.status === 'IN_USE', primary: true },
        { kind: 'RETURN', label: 'Omborga qaytarish', show: asset.status === 'IN_USE' },
        { kind: 'WRITE_OFF', label: 'Hisobdan chiqarish', show: asset.status !== 'WRITTEN_OFF' },
      ]
    : [];

  return (
    <Drawer
      open={Boolean(assetId)}
      onClose={onClose}
      width="lg"
      title={asset ? `${asset.inventoryNo} · ${asset.name}` : 'Asosiy vosita'}
      description="Hozir kimda turgani va qayerlardan o'tgani"
      footer={
        <>
          {isAdmin && dirty && (
            <Button className="mr-auto" onClick={() => void save()} loading={saving}>
              Saqlash
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Yopish
          </Button>
        </>
      }
    >
      {loading && !asset ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
      ) : asset ? (
        <div className="space-y-5">
          {/* Hozirgi joyi */}
          <div className={cn('rounded-(--radius-card) border p-4', asset.status === 'IN_USE' ? 'border-brand-200 bg-brand-50' : 'border-(--color-line) bg-(--color-surface-muted)')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Hozir</p>
              <AssetStatusBadge status={asset.status} />
            </div>
            <p className="mt-1 text-lg font-bold text-heading">{asset.status === 'WRITTEN_OFF' ? 'Hisobdan chiqarilgan' : asset.place.text}</p>
            {canMove && (
              <div className="mt-3 flex flex-wrap gap-2">
                {actions
                  .filter((a) => a.show)
                  .map((a) => (
                    <Button key={a.kind} size="sm" variant={a.primary ? 'primary' : 'secondary'} onClick={() => onAction(a.kind, asset.id)}>
                      {a.label}
                    </Button>
                  ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Inventar raqami">
              <span className="money">{asset.inventoryNo}</span>
            </Field>
            <Field label="Buyum">{asset.itemName}</Field>
            <Field label="Guruh">{asset.group}</Field>
            <Field label="Qiymati">
              <span className="money">{formatTiyin(asset.priceTiyin)} so&apos;m</span>
            </Field>
            <Field label="Kirim sanasi">{formatDate(asset.acquiredAt)}</Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Seriya raqami" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} disabled={!isAdmin} />
            <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} disabled={!isAdmin} />
          </div>
          {saveError && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{saveError}</p>}

          {/* Harakat tarixi */}
          <div>
            <p className="mb-2 text-sm font-semibold text-heading">
              Harakat tarixi <span className="font-normal text-(--color-text-muted)">· {moves.length} ta</span>
            </p>
            {moves.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">Harakat yo&apos;q.</p>
            ) : (
              <ol className="relative space-y-3 border-l-2 border-(--color-line) pl-5">
                {moves.map((m) => (
                  <li key={m.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 size-3 rounded-full border-2 border-white bg-brand-500 ring-1 ring-brand-200" />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-text-muted)">
                      <span className="font-semibold text-heading">{formatDate(m.date)}</span>
                      <DocKindBadge kind={m.kind} />
                      {m.docId && m.docNumber && (
                        <button type="button" onClick={() => onOpenDoc(m.docId!)} className="money font-semibold text-brand-700 hover:underline">
                          {m.docNumber}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-heading">
                      {m.kind === 'RECEIPT' ? (
                        <>Omborga keldi</>
                      ) : (
                        <>
                          {m.from.text} <span className="text-(--color-text-faint)">→</span> <b>{m.kind === 'WRITE_OFF' ? 'hisobdan chiqarildi' : m.to.text}</b>
                        </>
                      )}
                    </p>
                    {m.note && <p className="text-xs text-(--color-text-muted)">{m.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}