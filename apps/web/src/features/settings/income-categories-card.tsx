'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { categoriesApi } from '@/features/shared/references';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Daromad xizmat turlari: qo'lda (tezkor oyna, hudud ish stoli) qo'shilganlarini ko'rish,
// arxivlash / qaytarish va ishlatilmaganini butunlay o'chirish.
// ═══════════════════════════════════════════════════════════

export function IncomeCategoriesCard({ onToast }: { onToast: (message: string) => void }) {
  const list = useAsync(() => categoriesApi.incomeUsage().then((r) => r.data), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');

  async function act(code: string, fn: () => Promise<unknown>, message: string) {
    setBusy(code);
    try {
      await fn();
      onToast(message);
      list.reload();
    } catch (err) {
      onToast(errorMessage(err, 'Xatolik'));
    } finally {
      setBusy(null);
    }
  }

  const rows = (list.data ?? []).filter((c) => (showArchived || c.isActive) && (!q.trim() || c.label.toLowerCase().includes(q.trim().toLowerCase())));
  const archived = (list.data ?? []).filter((c) => !c.isActive).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Daromad xizmat turlari · ${list.data?.filter((c) => c.isActive).length ?? 0} ta`}
        description="Qo'lda qo'shilgan xizmatlar ham shu yerda. Yozuvi yoki tarifi bo'lmagani butunlay o'chiriladi, aks holda — arxivlanadi (eski yozuvlar saqlanadi)."
        actions={
          <div className="flex items-center gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Qidirish…"
              className="h-8 w-44 rounded-md border border-(--color-line-strong) px-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            {archived > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-(--color-text-muted)">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-3.5" />
                Arxiv ({archived})
              </label>
            )}
          </div>
        }
      />
      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <div className="max-h-[480px] divide-y divide-(--color-line) overflow-auto">
          {rows.map((c) => {
            const used = c.incomes + c.tariffs;
            return (
              <div key={c.code} className={cn('group flex items-center gap-3 px-4 py-2.5 hover:bg-(--color-surface-muted)', !c.isActive && 'opacity-60')}>
                <span className="w-20 shrink-0 font-mono text-[11px] text-(--color-text-faint)">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                {!c.isActive && <Badge tone="neutral">Arxiv</Badge>}
                <span className="w-40 shrink-0 text-right text-xs text-(--color-text-muted)">
                  {used ? `${c.incomes} ta yozuv${c.tariffs ? ` · ${c.tariffs} tarif` : ''}` : 'ishlatilmagan'}
                </span>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === c.code}
                    onClick={() => void act(c.code, () => categoriesApi.incomeActive(c.code, !c.isActive), c.isActive ? 'Arxivlandi' : 'Qaytarildi')}
                    className="text-(--color-text-muted)"
                  >
                    {c.isActive ? 'Arxiv' : 'Qaytarish'}
                  </Button>
                  {used === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(`«${c.label}» butunlay o'chirilsinmi?`)) void act(c.code, () => categoriesApi.removeIncome(c.code), "O'chirildi");
                      }}
                      className="text-(--color-expense) hover:bg-red-50"
                    >
                      O&apos;chirish
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="px-4 py-6 text-center text-sm text-(--color-text-muted)">Topilmadi</p>}
        </div>
      )}
    </Card>
  );
}
