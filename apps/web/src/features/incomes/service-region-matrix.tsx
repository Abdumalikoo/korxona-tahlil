'use client';

import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatCompact, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { regionalIncomeApi } from './regional-api';

/** Viloyat nomi ustunda qisqa: «Toshkent viloyati» → «Toshkent v.», «… Respublikasi» → «Qoraqalpog'iston» */
const short = (name: string) => name.replace(/\s+viloyati$/i, ' v.').replace(/\s+shahri$/i, ' sh.').replace(/\s+Respublikasi$/i, '');

/**
 * Hududlar tushumi: xizmat turi × viloyat — har xizmat qaysi viloyatda qancha (ustun jami — viloyat, qator jami — xizmat).
 * stamp — yuklash / qayta hisobdan keyin yangilash uchun (sahifadagi boshqa jadvallar bilan birga).
 */
export function ServiceRegionMatrix({ period, stamp }: { period: string; stamp: unknown }) {
  const res = useAsync(() => regionalIncomeApi.summaryMatrix(period).then((r) => r.data), [period, stamp]);
  const m = res.data;
  const cell = (v: string | undefined, strong = false) =>
    v && v !== '0' ? (
      <span className={cn('money', strong && 'font-semibold text-heading')} title={`${formatTiyin(v)} so'm`}>
        {formatCompact(v)}
      </span>
    ) : (
      <span className="text-(--color-text-faint)">—</span>
    );

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Xizmat turlari × viloyatlar" description="Har xizmat qaysi viloyatda qancha tushum bergan · summa ustiga olib boring — to'liq" />
      {res.loading && !m ? (
        <LoadingState />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !m || !m.rows.length ? (
        <EmptyState title="Ma'lumot yo'q" hint="period" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-(--color-surface-muted) text-(--color-text-muted)">
              <tr>
                <th className="sticky left-0 z-[1] min-w-56 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Xizmat turi</th>
                {m.regions.map((r) => (
                  <th key={r.regionCode} className="px-2 py-2 text-right font-medium whitespace-nowrap" title={r.name}>
                    {short(r.name)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap text-heading">Jami</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {m.rows.map((row) => (
                <tr key={row.categoryCode} className="hover:bg-(--color-surface-muted)/60">
                  <td className="sticky left-0 z-[1] max-w-72 truncate bg-white px-3 py-1.5" title={row.label}>
                    {row.label}
                  </td>
                  {m.regions.map((r) => (
                    <td key={r.regionCode} className="px-2 py-1.5 text-right whitespace-nowrap">
                      {cell(row.cells[r.regionCode])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{cell(row.totalTiyin, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold">
              <tr>
                <td className="sticky left-0 z-[1] bg-(--color-surface-muted) px-3 py-2">Jami</td>
                {m.regions.map((r) => (
                  <td key={r.regionCode} className="px-2 py-2 text-right whitespace-nowrap">
                    {cell(m.regionTotals[r.regionCode], true)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right whitespace-nowrap">{cell(m.totalTiyin, true)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
