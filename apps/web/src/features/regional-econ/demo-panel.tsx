'use client';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/report/report-extra-b';
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
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f5d9a8] bg-[#fff8ec] px-5 py-4 shadow-card">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2.5 text-base font-bold text-heading">
              <span className="h-5 w-1 rounded-full bg-[#d97706]" aria-hidden />
              Katta demo yoqilgan
              <StatusBadge tone="amber">[DEMO]</StatusBadge>
            </h3>
            <p className="mt-1.5 text-sm font-semibold text-[#b45309]">
              Davr: {info.months} oy ({info.from} – {info.to}), {info.incomes.toLocaleString('ru-RU')} daromad, {info.expenses.toLocaleString('ru-RU')} xarajat, {info.employees} xodim
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-(--color-text-muted)">
              Hamma bo&apos;limlar (Hududchi, Daromadlar, Xarajatlar, Xodimlar, modellar) shu ma&apos;lumot bilan ishlaydi. Belgisi — «[DEMO]». Sinab bo&apos;lgach o&apos;chiring: haqiqiy yozuvlarga tegilmaydi.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setAsk('remove')}>
            Demoni o&apos;chirish
          </Button>
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-card">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2.5 text-base font-bold text-heading">
              <span className="h-5 w-1 rounded-full bg-brand-600" aria-hidden />
              Katta demo
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-(--color-text-muted)">Modellarning to&apos;liq quvvatini ko&apos;rish uchun katta demo: {WHAT}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAsk('create')}>
            Katta demo qo&apos;shish
          </Button>
        </section>
      )}
      {error && ask !== 'force' && <p className="rounded-2xl bg-[#fdecec] px-4 py-2.5 text-sm font-medium text-[#c22f34] shadow-card">{error}</p>}
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