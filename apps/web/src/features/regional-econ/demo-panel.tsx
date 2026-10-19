'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { demoApi } from './api';

// ═══════════════════════════════════════════════════════════
// Hududlar modellari › Katta demo (faqat administrator): 30 oylik to'liq namunaviy ma'lumot bitta tugma bilan
// qo'shiladi va bitta tugma bilan butunlay o'chadi. Demo turganda — sariq banner.
// ═══════════════════════════════════════════════════════════

const WHAT =
  "14 hudud × 10 xizmat × 30 oy daromad, tumanlar kesimida (mavsumiylik, o'sish va pasayish, tarif o'zgarishi, qayta tuzilish, keskin sakrash), " +
  "~180 hudud xodimi tumanlar bo'yicha va shtat kartalari (kelgusi maosh oshishi, bo'shash, yangi xodim), har oylik vedomostlar va choraklik mukofotlar, " +
  'Natijalar fayli (har xodimga reja, fakt, bonus), ' +
  "xarajatlar (takroriy va bir martalik), xarajat rejasi, Markazning 6 bo'limi va taqsimlash qoidalari (qoida tarixi, qo'lda drayver), " +
  'voqealar jurnali, tariflar, KPI (taklif → tasdiq → fakt) va 2 ta saqlangan prognoz versiyasi.';

export function RegionalDemoPanel() {
  const { isAdmin } = useAuth();
  const status = useAsync(() => (isAdmin ? demoApi.status().then((r) => r.data) : Promise.resolve(null)), [isAdmin]);
  const [ask, setAsk] = useState<'create' | 'force' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isAdmin || !status.data) return null;
  const info = status.data;

  const run = async () => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      if (ask === 'remove') await demoApi.remove();
      else await demoApi.create(ask === 'force');
      // Barcha bo'limlar yangi ma'lumot bilan qayta yuklansin
      window.location.reload();
    } catch (err) {
      const msg = errorMessage(err, ask === 'remove' ? "Demoni o'chirib bo'lmadi" : "Demoni qo'shib bo'lmadi");
      if (ask === 'create' && /haqiqiy daromad/.test(msg)) {
        setAsk('force');
        setError(msg);
      } else {
        setError(msg);
        setAsk(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {info.exists ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border-2 border-dashed border-amber-300 bg-amber-50 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              Katta demo yoqilgan: {info.months} oy ({info.from} – {info.to}), {info.incomes.toLocaleString('ru-RU')} daromad, {info.expenses.toLocaleString('ru-RU')} xarajat, {info.employees} xodim
            </p>
            <p className="text-xs text-amber-800">
              Hamma bo&apos;limlar (Hududchi, Daromadlar, Xarajatlar, Xodimlar, modellar) shu ma&apos;lumot bilan ishlaydi. Belgisi — «[DEMO]». Sinab bo&apos;lgach o&apos;chiring: haqiqiy yozuvlarga tegilmaydi.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setAsk('remove')}>
            Demoni o&apos;chirish
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-dashed border-(--color-line) bg-white px-5 py-3">
          <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
            Modellarning to&apos;liq quvvatini ko&apos;rish uchun katta demo: {WHAT}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAsk('create')}>
            Katta demo qo&apos;shish
          </Button>
        </div>
      )}
      {error && ask !== 'force' && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      <ConfirmDialog
        open={ask !== null}
        danger={ask === 'remove' || ask === 'force'}
        loading={busy}
        title={ask === 'remove' ? "Katta demoni o'chirish" : ask === 'force' ? "Haqiqiy ma'lumot bor — baribir qo'shilsinmi?" : "Katta demo qo'shish"}
        message={
          ask === 'remove'
            ? "Barcha demo yozuvlari (daromad, xarajat, xodimlar, vedomostlar, reja, qoidalar, KPI, prognoz versiyalari, yopilgan demo oylar) butunlay o'chiriladi. Haqiqiy yozuvlarga tegilmaydi."
            : ask === 'force'
              ? `${error ?? ''} Demo oylari yopilmaydi (haqiqiy oylar bloklanmasligi uchun).`
              : `${WHAT} Bir necha soniya davom etadi. Keyin «Demoni o'chirish» bilan hammasi butunlay o'chadi.`
        }
        confirmLabel={ask === 'remove' ? "O'chirish" : "Qo'shish"}
        cancelLabel="Yo'q"
        onConfirm={() => void run()}
        onCancel={() => {
          setAsk(null);
          setError(null);
        }}
      />
    </>
  );
}