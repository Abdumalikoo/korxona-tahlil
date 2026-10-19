'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { changeTone, compact, pct, som, TONE, type StructureKind, type StructureNode, type StructureTree } from './api';
import { Legend, LineChart } from './charts';
import { Stat } from './parts';
import { BEHAVIOR_TEXT, behaviorOf, changePct, extremes, forecastYear, lastN, mean, toNums, trendPerMonth, variation } from './stats';

function signed(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${compact(Math.abs(value))}`;
}

/**
 * Modda kartasi — bitta tugun haqida hamma narsa:
 * joriy va avvalgi davr, 12 oy (o'tgan yil bilan), statistik ko'rsatkichlar, prognoz va xulosa.
 */
export function NodeCard({
  kind,
  tree,
  node,
  onClose,
  onDrill,
}: {
  kind: StructureKind;
  tree: StructureTree;
  node: StructureNode | null;
  onClose: () => void;
  onDrill: (node: StructureNode) => void;
}) {
  if (!node) return null;

  const months = tree.months;
  const values = toNums(node.trend);
  const months12 = lastN(months, 12);
  const values12 = lastN(values, 12);
  // Bir yil oldingi oylar; butun daraja bo'yicha ma'lumot yo'q oylar — null (grafikda uziladi)
  const totals = toNums(tree.totalTrend);
  const valuesPrevYear =
    values.length >= 24 && totals.slice(-24, -12).some((v) => v > 0)
      ? values.slice(values.length - 24, values.length - 12).map((v, i) => (totals[totals.length - 24 + i] === 0 ? null : v))
      : null;

  const amount = Number(node.amountTiyin);
  const previous = Number(node.previousTiyin);
  const delta = amount - previous;
  const previousTotal = Number(tree.previousTotalTiyin);
  const shareBefore = previousTotal > 0 ? (previous / previousTotal) * 100 : 0;
  const shareDelta = node.sharePercent - shareBefore;
  const doimiy = Number(node.doimiyTiyin);
  const boshqaShare = amount > 0 ? ((amount - doimiy) / amount) * 100 : 0;

  const avg12 = mean(values12.filter((v) => v > 0));
  const { max, min } = extremes(months12, values12);
  const slope = trendPerMonth(values12);
  const cv = variation(values12);
  const behavior = behaviorOf(values12);
  const lastMonth = values12[values12.length - 1] ?? 0;
  const lastMonthYearAgo = valuesPrevYear ? (valuesPrevYear[valuesPrevYear.length - 1] ?? null) : null;
  const lastMonthYoy = lastMonthYearAgo !== null ? changePct(lastMonth, lastMonthYearAgo) : null;
  const forecast = forecastYear(months, values, tree.range.to);
  const good = (d: number) => (kind === 'income' ? d > 0 : d < 0);

  // Oddiy tildagi xulosa
  const notes: string[] = [];
  notes.push(
    previous > 0
      ? `${tree.compareLabel[0]!.toUpperCase() + tree.compareLabel.slice(1)}ga nisbatan ${delta >= 0 ? "ko'paygan" : 'kamaygan'}: ${signed(delta)} so'm (${pct(changePct(amount, previous), true)}).`
      : `${tree.compareLabel[0]!.toUpperCase() + tree.compareLabel.slice(1)}da bu modda bo'lmagan — yangi paydo bo'lgan.`,
  );
  if (Math.abs(shareDelta) >= 0.1) {
    notes.push(`Umumiy ${kind === 'expense' ? 'xarajat' : 'daromad'} ichidagi ulushi ${pct(shareBefore)} dan ${pct(node.sharePercent)} ga ${shareDelta > 0 ? 'oshgan' : 'tushgan'}.`);
  }
  if (behavior !== 'unknown') {
    notes.push(
      `So'nggi 12 oy xarakteri — «${BEHAVIOR_TEXT[behavior].label.toLowerCase()}»` +
        (slope !== null ? `: o'rtacha oyiga ${slope >= 0 ? '+' : '−'}${Math.abs(slope).toFixed(1).replace('.', ',')}%` : '') +
        (cv !== null ? `, oydan oyga tebranishi ${Math.round(cv)}%.` : '.'),
    );
  }
  if (max && avg12 > 0 && max.value > avg12 * 1.5) {
    notes.push(`Eng yuqori oy — ${formatPeriod(max.period)} (${compact(max.value)} so'm), bu o'rtachadan ${(max.value / avg12).toFixed(1).replace('.', ',')} baravar ko'p.`);
  }
  if (boshqaShare >= 20) notes.push(`Summaning ${pct(boshqaShare)} i bir martalik (Boshqa) yozuvlardan iborat.`);

  return (
    <Drawer
      open
      onClose={onClose}
      title={node.label}
      description={`Modda kartasi · ${tree.levelLabel.toLowerCase()} · ${node.count.toLocaleString('ru-RU')} ta yozuv`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Yopish
          </Button>
          {node.drillable && (
            <Button size="sm" onClick={() => onDrill(node)}>
              Ichiga kirish →
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Asosiy raqamlar */}
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Davrlar solishtirmasi</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[--radius-control] border border-[--color-line] p-4">
            <Stat label="Joriy davr" value={som(amount)} />
            <Stat label={tree.compareLabel[0]!.toUpperCase() + tree.compareLabel.slice(1)} value={som(previous)} />
            <Stat
              label="Farq"
              value={`${signed(delta)} so'm`}
              valueClass={delta === 0 ? undefined : good(delta) ? 'text-[--color-income]' : 'text-[--color-expense]'}
              sub={pct(changePct(amount, previous), true)}
            />
            <Stat
              label="Ulush (shu daraja ichida)"
              value={pct(node.sharePercent)}
              sub={`avval ${pct(shareBefore)} · ${shareDelta >= 0 ? '+' : '−'}${Math.abs(shareDelta).toFixed(1).replace('.', ',')} p.p.`}
            />
          </dl>
        </section>

        {/* 12 oy: bu yil va o'tgan yil */}
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">So&apos;nggi 12 oy va bir yil oldin</h4>
          <LineChart
            width={520}
            height={220}
            labels={months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
            tooltipLabels={months12.map((m) => formatPeriod(m))}
            series={[
              ...(valuesPrevYear ? [{ label: 'Bir yil oldin', color: TONE.axis, values: valuesPrevYear, dashed: true, width: 1.5 }] : []),
              { label: "So'nggi 12 oy", color: '#23426a', values: values12 },
            ]}
          />
          <div className="mt-1.5">
            <Legend
              items={[
                { color: '#23426a', label: "So'nggi 12 oy", line: true },
                ...(valuesPrevYear ? [{ color: TONE.axis, label: 'Xuddi shu oylar bir yil oldin', line: true }] : []),
              ]}
            />
          </div>
        </section>

        {/* Statistik ko'rsatkichlar */}
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Ko&apos;rsatkichlar (12 oy)</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[--radius-control] border border-[--color-line] p-4">
            <Stat label="O'rtacha oylik" value={compact(avg12)} sub="nol bo'lmagan oylar bo'yicha" />
            <Stat label="Xarakter" value={BEHAVIOR_TEXT[behavior].label} sub={BEHAVIOR_TEXT[behavior].hint} />
            <Stat label="Eng yuqori oy" value={max ? compact(max.value) : '—'} sub={max ? formatPeriod(max.period) : undefined} />
            <Stat label="Eng past oy" value={min ? compact(min.value) : '—'} sub={min ? formatPeriod(min.period) : undefined} />
            <Stat
              label="Trend (oyiga)"
              value={slope === null ? '—' : `${slope >= 0 ? '+' : '−'}${Math.abs(slope).toFixed(1).replace('.', ',')}%`}
              valueClass={slope === null || Math.abs(slope) < 1 ? undefined : good(slope) ? 'text-[--color-income]' : 'text-[--color-expense]'}
              sub="chiziqli regressiya"
            />
            <Stat
              label="Tebranish (CV)"
              value={cv === null ? '—' : `${Math.round(cv)}%`}
              sub={cv === null ? undefined : cv < 20 ? 'past — oldindan aytish oson' : cv < 60 ? "o'rtacha" : 'yuqori — oyma-oy sakraydi'}
            />
            <Stat
              label={`So'nggi oy · ${formatPeriodShort(months12[months12.length - 1] ?? '')}`}
              value={compact(lastMonth)}
              sub={lastMonthYearAgo === null ? undefined : `bir yil oldin ${compact(lastMonthYearAgo)} (${pct(lastMonthYoy, true)})`}
            />
            <Stat label="Bir martalik qismi" value={pct(boshqaShare)} sub={`doimiy ${compact(doimiy)} · boshqa ${compact(amount - doimiy)}`} />
          </dl>
        </section>

        {/* Prognoz */}
        {forecast && (
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{forecast.year}-yil yakuni prognozi</h4>
            <div className="rounded-[--radius-control] border border-[--color-line] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xl font-semibold tabular-nums">{compact(forecast.forecastTiyin)} so&apos;m</span>
                {forecast.lastYearTiyin !== null && forecast.lastYearTiyin > 0 && (
                  <span className={cn('text-sm font-medium tabular-nums', changeTone(kind, changePct(forecast.forecastTiyin, forecast.lastYearTiyin)))}>
                    {pct(changePct(forecast.forecastTiyin, forecast.lastYearTiyin), true)} o&apos;tgan yilga
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[--color-text-muted]">
                Yil boshidan fakt {compact(forecast.factTiyin)} + so&apos;nggi 3 oy o&apos;rtachasi {compact(forecast.basisTiyin)} × {forecast.remainingMonths} oy.
                {forecast.lastYearTiyin !== null ? ` O'tgan yil jami: ${compact(forecast.lastYearTiyin)}.` : ''}
              </p>
            </div>
          </section>
        )}

        {/* Xulosa */}
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Xulosa</h4>
          <ol className="space-y-1.5 text-sm leading-relaxed">
            {notes.map((note, i) => (
              <li key={note} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-[--color-text-faint]">{i + 1}.</span>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  );
}