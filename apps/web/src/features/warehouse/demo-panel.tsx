'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { warehouseApi } from '@/features/warehouse/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor demosi (faqat administrator): bitta tugma bilan qo'shiladi, bitta tugma bilan o'chadi.
// Demo turganda — sariq banner; bo'lmasa — kichik «Demo qo'shish» qatori.
// ═══════════════════════════════════════════════════════════

export function WarehouseDemoPanel({ onChanged }: { onChanged: () => void }) {
  const { isAdmin } = useAuth();
  const status = useAsync(() => (isAdmin ? warehouseApi.demoStatus() : Promise.resolve(null)), [isAdmin]);
  const [ask, setAsk] = useState<'create' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!isAdmin || !status.data) return null;
  const info = status.data.data;
  const has = info.items > 0;

  const run = async () => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      if (ask === 'create') {
        const r = await warehouseApi.createDemo();
        setToast(`Demo qo'shildi: ${r.data.items} ta buyum, ${r.data.docs} ta hujjat. To'liq ko'rish uchun «Davr»dan oxirgi 3 oyni tanlang`);
      } else {
        await warehouseApi.removeDemo();
        setToast("Ombor demosi o'chirildi");
      }
      setAsk(null);
      status.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err, ask === 'create' ? "Demoni qo'shib bo'lmadi" : "Demoni o'chirib bo'lmadi"));
      setAsk(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {has ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border-2 border-dashed border-amber-300 bg-amber-50 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              Demo ma&apos;lumot: {info.items} ta buyum, {info.docs} ta hujjat, {info.assets} ta asosiy vosita, {info.postal} ta pochta to&apos;lovi —{' '}
              <span className="money">{formatTiyin(info.expenseTiyin)}</span> so&apos;m xarajat
            </p>
            <p className="text-xs text-amber-800">
              Oxirgi 3 oy. Buyum va hujjatlar izohida «[DEMO]». Xarajatlarga ham tushgan. Sinab bo&apos;lgach o&apos;chiring — haqiqiy ma&apos;lumotga tegmaydi.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setAsk('remove')}>
            Demoni o&apos;chirish
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-dashed border-(--color-line) bg-white px-5 py-3">
          <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
            Ombor qanday ishlashini ko&apos;rmoqchimisiz? Demo 3 oylik namunaviy ish qo&apos;shadi: kirim, berish, ko&apos;chirish, qaytarish, inventarizatsiya, pochta.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAsk('create')}>
            Demo qo&apos;shish
          </Button>
        </div>
      )}
      {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}

      <ConfirmDialog
        open={ask !== null}
        danger={ask === 'remove'}
        loading={busy}
        title={ask === 'remove' ? "Ombor demosini o'chirish" : "Ombor demosini qo'shish"}
        message={
          ask === 'remove'
            ? `${info.items} ta demo buyum, ${info.docs} ta hujjat, ${info.assets} ta asosiy vosita va ${info.postal} ta pochta to'lovi (Xarajatlardagi yozuvlari ham) butunlay o'chiriladi. Haqiqiy buyum va hujjatlarga tegmaydi.`
            : "35 ta buyum (kanselyariya, xo'jalik, kompyuter texnikasi, mebel) va oxirgi 3 oyning ishi qo'shiladi: kirimlar, xodim va bo'limlarga berish, ko'chirish, qaytarish, hisobdan chiqarish, pochta to'lovlari. Kirimlar Xarajatlarga ham tushadi. Keyin «Demoni o'chirish» bilan hammasi butunlay o'chadi."
        }
        confirmLabel={ask === 'remove' ? "O'chirish" : "Qo'shish"}
        cancelLabel="Yo'q"
        onConfirm={() => void run()}
        onCancel={() => setAsk(null)}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}