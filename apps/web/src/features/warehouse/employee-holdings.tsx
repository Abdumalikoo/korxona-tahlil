'use client';

import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { downloadCard, qtyText, warehouseApi, type Holdings } from './api';
import { useWarehouseDialogs } from './use-dialogs';

// ═══════════════════════════════════════════════════════════
// Xodim kartochkasida: unga dalolatnoma bilan berilgan asosiy vositalar va TMZ (omborning «Kimda nima bor»i).
// Mulk kartochkasi (Word) — imzo uchun.
// ═══════════════════════════════════════════════════════════

export function EmployeeHoldings({ pinfl }: { pinfl: string }) {
  const [data, setData] = useState<Holdings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  /** Vosita bosilsa — kartasi: kimlarda bo'lgani, harakat tarixi, dalolatnomalar */
  const w = useWarehouseDialogs(() => setTick((t) => t + 1));

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    warehouseApi
      .holdings({ holderPinfl: pinfl })
      .then((r) => alive && setData(r.data))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [pinfl, tick]);

  if (error) return null;
  const total = data ? data.assets.reduce((s, a) => s + Number(a.priceTiyin), 0) : 0;
  return (
    <div className="mt-6 border-t border-(--color-line) pt-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-heading">Unda turgan mulk</p>
        {data && (
          <span className="text-xs text-(--color-text-muted)">
            {data.assets.length} ta asosiy vosita{data.assets.length ? ` · ${formatTiyin(total)} so'm` : ''}
            {data.tmz.length ? ` · ${data.tmz.length} xil TMZ` : ''}
          </span>
        )}
        {data && (data.assets.length > 0 || data.tmz.length > 0) && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await downloadCard({ holderPinfl: pinfl });
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            className="ml-auto text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50"
          >
            Kartochka (Word)
          </button>
        )}
      </div>
      {!data ? (
        <p className="text-xs text-(--color-text-muted)">Yuklanmoqda…</p>
      ) : data.assets.length === 0 && data.tmz.length === 0 ? (
        <p className="text-xs text-(--color-text-muted)">Dalolatnoma bilan berilgan mulk yo&apos;q.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
          {data.assets.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => w.openAsset(a.id)}
              title="Bosing — kimlarda bo'lgani, tarixi va dalolatnomalari"
              className="flex w-full items-center gap-3 border-b border-(--color-line) px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-brand-50"
            >
              <span className="w-24 shrink-0 font-mono text-[11px] font-semibold text-brand-700">{a.inventoryNo}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 text-[11px] text-(--color-text-muted)">{formatDate(a.acquiredAt)}</span>
              <span className="money w-24 shrink-0 text-right text-xs">{formatTiyin(a.priceTiyin)}</span>
              <span className="shrink-0 text-xs text-(--color-text-faint)">›</span>
            </button>
          ))}
          {data.tmz.map((t) => (
            <div key={t.itemId} className="flex items-center gap-3 border-b border-(--color-line) px-3 py-1.5 text-sm last:border-b-0">
              <span className="w-24 shrink-0 font-mono text-[11px] text-(--color-text-muted)">{t.itemCode}</span>
              <span className="min-w-0 flex-1 truncate">{t.itemName}</span>
              <span className="shrink-0 text-xs text-(--color-text-muted)">
                {qtyText(t.qty)} {t.unit}
              </span>
            </div>
          ))}
        </div>
      )}
      {w.element}
      <Link href={`/ombor/kimda?holderPinfl=${pinfl}`} className="mt-2 inline-block text-xs text-brand-700 hover:underline">
        Omborda ochish → qaytarish, boshqaga o&apos;tkazish
      </Link>
    </div>
  );
}