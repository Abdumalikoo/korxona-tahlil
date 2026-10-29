'use client';

import { sum } from '@/components/report/report';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { qomitaApi, type QomitaIncomeRow } from './api';

// ═══════════════════════════════════════════════════════════
// Qo'mita mablag'lari › «O'chirish»: davrdagi hamma ajratmalar bitta ro'yxatda — belgilab, birdan o'chiriladi
// (yumshoq — Savatdan tiklanadi; bankdan yo'naltirilgani — bank yo'naltirishi ham bekor qilinadi).
// Kunlik ma'lumotnomadan (kassa farqi) qatori o'chirilmaydi — u kassa bo'yicha hisoblanadi.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;

const ORIGIN: Record<QomitaIncomeRow['origin'], string> = {
  MANUAL: "qo'lda",
  FILE: "ko'chirma faylidan",
  BANK: 'bank tahlilidan',
  KASSA: "kunlik ma'lumotnomadan (kassa farqi)",
  OTHER: 'boshqa manba',
};

export function QomitaRemoveDrawer({ from, to, onClose, onDone, setToast }: { from: string; to: string; onClose: () => void; onDone: () => void; setToast: ToastFn }) {
  const res = useAsync(() => qomitaApi.incomes(from, to).then((r) => r.data), [from, to]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = res.data ?? [];
  const deletable = rows.filter((r) => r.canDelete);
  const chosen = rows.filter((r) => picked.has(r.id));
  const chosenSum = chosen.reduce((s, r) => s + Number(r.amountTiyin), 0);
  const bankCount = chosen.filter((r) => r.origin === 'BANK').length;
  const allOn = deletable.length > 0 && deletable.every((r) => picked.has(r.id));

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function remove() {
    setBusy(true);
    try {
      const r = (await qomitaApi.removeIncomes([...picked])).data;
      setToast({ message: r.failed.length ? `${r.removed} ta o'chirildi, ${r.failed.length} tasi o'chmadi: ${r.failed[0]!.message}` : `${r.removed} ta ajratma o'chirildi (Savatdan tiklash mumkin)`, tone: r.failed.length ? 'error' : 'success' });
      setAsk(false);
      onDone();
    } catch (e) {
      setToast({ message: errorMessage(e, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Qo'mita ajratmalarini o'chirish"
      description={`${formatPeriod(from)} — ${formatPeriod(to)}: belgilang va o'chiring (Savatdan tiklash mumkin)`}
      width="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm text-(--color-text-muted)">
            {chosen.length ? (
              <>
                Tanlandi: <b className="money text-heading">{chosen.length}</b> ta · <b className="money text-heading">{sum(chosenSum)}</b> so&apos;m
              </>
            ) : (
              "Hech narsa tanlanmagan"
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Yopish
            </Button>
            <Button variant="danger" size="sm" disabled={!chosen.length} onClick={() => setAsk(true)}>
              O&apos;chirish{chosen.length ? ` (${chosen.length})` : ''}
            </Button>
          </div>
        </div>
      }
    >
      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <LoadingState label="Ajratmalar yuklanmoqda" />
      ) : !rows.length ? (
        <p className="py-10 text-center text-sm text-(--color-text-muted)">Bu davrda Qo&apos;mita ajratmasi yo&apos;q</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-(--color-line) text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                <th className="w-10 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={!deletable.length}
                    onChange={() => setPicked(allOn ? new Set() : new Set(deletable.map((r) => r.id)))}
                    aria-label="Hammasini belgilash"
                  />
                </th>
                <th className="px-2 py-2">Oy · sana</th>
                <th className="px-2 py-2">Bo&apos;lim</th>
                <th className="px-2 py-2">Manba</th>
                <th className="px-2 py-2 text-right">Summa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.canDelete && 'text-(--color-text-faint)', picked.has(r.id) && 'bg-red-50/60')}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={picked.has(r.id)} disabled={!r.canDelete} onChange={() => toggle(r.id)} aria-label="Belgilash" title={r.canDelete ? undefined : "Bu yozuv shu yerda o'chirilmaydi"} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {formatPeriod(r.period)} <span className="text-xs text-(--color-text-muted)">· {r.date.split('-').reverse().join('.')}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-medium text-heading">{r.department}</span>
                    {r.description && <span className="block max-w-72 truncate text-xs text-(--color-text-muted)" title={r.description}>{r.description}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{ORIGIN[r.origin]}</td>
                  <td className="money whitespace-nowrap px-2 py-1.5 text-right font-semibold">{sum(Number(r.amountTiyin))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-(--color-text-muted)">
            Kunlik ma&apos;lumotnomadan qo&apos;shilgan farq qatori bu yerda o&apos;chirilmaydi — u kassa va Qo&apos;mita yozuvlari farqidan avtomatik hisoblanadi.
          </p>
        </div>
      )}
      <ConfirmDialog
        open={ask}
        danger
        title="Ajratmalarni o'chirish"
        message={`${chosen.length} ta ajratma (${sum(chosenSum)} so'm) o'chiriladi — Savatdan tiklash mumkin.${bankCount ? ` Shundan ${bankCount} tasi bank tahlilidan: bank yo'naltirishi ham bekor qilinadi.` : ''} Davom etasizmi?`}
        confirmLabel="O'chirish"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setAsk(false)}
      />
    </Drawer>
  );
}
