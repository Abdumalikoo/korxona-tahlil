'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { vehiclesApi } from '@/features/vehicles/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Mashinalar demosi (faqat administrator, umumiy hudud dashbordida): bitta tugma bilan qo'shiladi, bitta tugma bilan o'chadi.
// Demo turganda — sariq banner; bo'lmasa — kichik «Demo qo'shish» qatori.
// ═══════════════════════════════════════════════════════════

export function VehicleDemoPanel({ onChanged }: { onChanged: () => void }) {
  const { isAdmin } = useAuth();
  const status = useAsync(() => (isAdmin ? vehiclesApi.demoStatus() : Promise.resolve(null)), [isAdmin]);
  const [ask, setAsk] = useState<'create' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!isAdmin || !status.data) return null;
  const info = status.data.data;
  const has = info.vehicles > 0;

  const run = async () => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      if (ask === 'create') {
        const r = await vehiclesApi.createDemo();
        setToast(`Demo qo'shildi: ${r.data.vehicles} ta mashina, ${r.data.records} ta xarajat. To'liq oyni ko'rish uchun «Davr»dan oldingi oyni tanlang`);
      } else {
        await vehiclesApi.removeDemo();
        setToast("Mashinalar demosi o'chirildi");
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
              Demo ma&apos;lumot: {info.vehicles} ta mashina («DEMO 01» … «DEMO 13»), {info.records} ta xarajat —{' '}
              <span className="money">{formatTiyin(info.totalTiyin)}</span> so&apos;m
            </p>
            <p className="text-xs text-amber-800">
              Oxirgi 3 oy. Xarajatlarga ham tushgan (izohida «demo»). Sinab bo&apos;lgach o&apos;chiring — haqiqiy ma&apos;lumotga tegmaydi.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setAsk('remove')}>
            Demoni o&apos;chirish
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-dashed border-(--color-line) bg-white px-5 py-3">
          <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
            Dashbord qanday ko&apos;rinishini ko&apos;rmoqchimisiz? Demo 4 guruhga 13 ta mashina va 3 oylik xarajat (yoqilg&apos;i, moyka, ta&apos;mir, texnik xizmat) qo&apos;shadi.
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
        title={ask === 'remove' ? "Mashinalar demosini o'chirish" : "Mashinalar demosini qo'shish"}
        message={
          ask === 'remove'
            ? `${info.vehicles} ta demo mashina va ularning ${info.records} ta xarajati (Xarajatlar bo'limidagi yozuvlari ham) butunlay o'chiriladi. Haqiqiy mashinalarga tegmaydi.`
            : "4 guruhga 13 ta namunaviy mashina («DEMO 01» … «DEMO 13») va oxirgi 3 oyning xarajatlari qo'shiladi. Ular Xarajatlar bo'limiga ham tushadi. Keyin «Demoni o'chirish» bilan hammasi butunlay o'chadi."
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