'use client';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert, IconChart } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { formatValue, type FormulaResult, type ResultTable } from './api';
import { ModelChart } from './model-chart';

const NUMERIC_UNITS = new Set(['som', 'percent', 'pp', 'kishi', 'count', 'index', 'number']);

function ResultTableView({ table }: { table: ResultTable }) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[--color-surface-muted]">
          <tr>
            {table.columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'whitespace-nowrap border-b border-[--color-line] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[--color-text-muted]',
                  NUMERIC_UNITS.has(column.unit) ? 'text-right' : 'text-left',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-line]">
          {table.rows.map((row, index) => (
            <tr key={index} className="hover:bg-[--color-surface-muted]">
              {table.columns.map((column) => {
                const value = row[column.key];
                const numeric = NUMERIC_UNITS.has(column.unit);
                const signed = (column.unit === 'pp' || column.key === 'growth') && typeof value === 'number';
                return (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-2',
                      numeric ? 'text-right tabular-nums' : 'text-left',
                      'text-[--color-text]',
                    )}
                  >
                    {signed && typeof value === 'number' && value > 0 && column.unit === 'percent' ? '+' : ''}
                    {formatValue(value, column.unit)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultView({
  result,
  tookMs,
  loading,
}: {
  result: FormulaResult;
  tookMs?: number;
  loading?: boolean;
}) {
  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      {/* Ogohlantirishlar */}
      {result.warnings.length > 0 && (
        <div className="space-y-1.5 rounded-[--radius-card] border border-amber-200 bg-[--color-warn-soft] px-4 py-3">
          {result.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-sm text-[--color-warn]">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      {result.insufficient ? (
        <Card>
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <IconChart className="mb-3 size-10 text-[--color-text-faint]" strokeWidth={1.5} />
            <p className="text-sm font-medium text-[--color-text]">Ma'lumot yetarli emas</p>
            <p className="mt-1 max-w-md text-sm text-[--color-text-muted]">
              Davrni kengaytiring yoki boshqa ko'rsatkichni tanlang. Noto'g'ri xulosa chiqmasligi uchun natija
              ko'rsatilmadi.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Asosiy raqam va ko'rsatkichlar */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {result.headline && (
              <div className="rounded-[--radius-card] border border-brand-200 bg-brand-50 p-4 sm:col-span-2 xl:col-span-1">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-800">
                  {result.headline.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-900">
                  {result.headline.text || formatValue(result.headline.value, result.headline.unit)}
                </p>
              </div>
            )}
            {result.stats.map((stat) => (
              <div key={stat.label} className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">{stat.label}</p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-[--color-text]">
                  {stat.text || formatValue(stat.value, stat.unit)}
                </p>
              </div>
            ))}
          </div>

          {/* Xulosa */}
          {result.interpretation.length > 0 && (
            <Card>
              <CardHeader title="Xulosa" description="Natijaning oddiy tildagi izohi" />
              <CardBody>
                <ul className="space-y-2 text-sm leading-relaxed text-[--color-text]">
                  {result.interpretation.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-600" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Grafik */}
          {result.chart && (
            <Card>
              <CardHeader
                title="Grafik"
                description={
                  tookMs !== undefined ? `${result.n} ta kuzatuv · ${tookMs} ms da hisoblandi` : `${result.n} ta kuzatuv`
                }
              />
              <CardBody>
                <ModelChart chart={result.chart} />
              </CardBody>
            </Card>
          )}

          {/* Jadval */}
          {result.table && result.table.rows.length > 0 && (
            <Card>
              <CardHeader title="Hisob-kitob jadvali" description={`${result.table.rows.length} ta qator`} />
              <ResultTableView table={result.table} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}