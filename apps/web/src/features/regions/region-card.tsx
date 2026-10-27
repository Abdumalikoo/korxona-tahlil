'use client';

import { Button } from '@/components/ui/button';
import { CalcValue } from '@/components/ui/calc';
import { calcChange, calcDivide, calcMargin, calcResult, calcShare, calcSum, decimalText, pctText, Q } from '@/lib/calc';
import { Drawer } from '@/components/ui/drawer';
import { PctBadge, sum } from '@/components/report/report';
import { pct, som } from '@/features/structure/api';
import { Stat } from '@/features/structure/parts';
import { changePct } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Mark, useMarkMode } from '@/features/reactions/mark';
import type { MarkItem } from '@/features/reactions/api';
import { unitMark, unitPartMark, type RegionsResult, type RegionUnit, type UnitPart, type UnitStats } from './api';

/** To'liq summa (so'msiz) */
const compact = (v: number) => sum(v);

const SEC = 'mb-2 flex items-center gap-2 text-sm font-bold text-heading';
const BAR = <span className="h-4 w-1 rounded-full bg-brand-600" aria-hidden />;
const TH = 'border-b border-(--color-line) bg-[#f3f6fd] px-2 py-2 text-center text-[11px] font-bold text-heading';
const TD = 'border-b border-(--color-line) px-2 py-1.5 text-center text-[13px] tabular-nums';

function signed(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

function pp(value: number | null): string {
  if (value === null) return '';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')} p.p.`;
}

function PartsTable({ title, parts, growthGood, markOf }: { title: string; parts: UnitPart[]; growthGood: boolean; markOf?: (part: UnitPart) => MarkItem | null }) {
  const total = parts.reduce((s, p) => s + Number(p.amountTiyin), 0) || 1;
  return (
    <section>
      <h4 className={SEC}>
        {BAR}
        {title}
      </h4>
      {parts.length === 0 ? (
        <p className="text-sm text-(--color-text-faint)">Yozuv yo&apos;q</p>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-(--color-line) text-sm">
          <thead>
            <tr>
              <th className={cn(TH, 'text-left')}>Modda</th>
              <th className={TH}>Summa</th>
              <th className={TH}>Ulushi</th>
              <th className={TH}>O&apos;zgarish</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const amount = Number(p.amountTiyin);
              const d = changePct(amount, Number(p.previousTiyin));
              return (
                <tr key={p.key} className="odd:bg-white even:bg-[#fafbfe]">
                  <td className={cn(TD, 'max-w-[12rem] text-left')} title={p.label}>
                    <span className="flex items-center gap-1.5">
                      <Mark item={markOf?.(p) ?? null} />
                      <span className="truncate">{p.label}</span>
                    </span>
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap')}>{compact(amount)}</td>
                  <td className={TD}>
                    <CalcValue calc={calcShare(`${p.label}: ulush`, Q.money(p.label, amount), Q.money('Jami', total))} className="no-underline">
                      <PctBadge value={(amount / total) * 100} plain />
                    </CalcValue>
                  </td>
                  <td className={TD}>
                    <CalcValue calc={calcChange(`${p.label}: o'zgarish`, Q.money('Joriy davr', amount), Q.money('Oldingi davr', Number(p.previousTiyin)), { growthGood })} className="no-underline">
                      <PctBadge value={d} growthGood={growthGood} />
                    </CalcValue>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Belgilash rejimida: hududning daromadi, xarajati yoki natijasini bitta bosish bilan savatga */
function QuickMarks({ unit, section }: { unit: RegionUnit; section: RegionsResult['section'] }) {
  const active = useMarkMode();
  if (!active) return null;
  return (
    <section className="rounded-(--radius-control) border border-amber-300 bg-amber-50 p-3">
      <p className="mb-2 text-xs font-semibold text-amber-900">Munosabatga belgilash</p>
      <div className="flex flex-wrap gap-2">
        <Mark item={unitMark(unit, 'INCOME', section)} label="Daromadi" />
        <Mark item={unitMark(unit, 'EXPENSE', section)} label="Xarajati" />
        <Mark item={unitMark(unit, 'RESULT', section)} label="Natijasi" />
      </div>
      <p className="mt-2 text-[11px] text-amber-800">Yoki pastdagi tarkib jadvallaridan alohida moddani belgilang (masalan, faqat mashina xarajatlari).</p>
    </section>
  );
}

/**
 * Hudud kartasi — bitta hudud (yoki Markaz) haqida:
 * natija va solishtirma, boshqa hududlar orasidagi o'rni, 12 oy, xarajat va daromad tarkibi, xulosa.
 */
export function RegionCard({
  data,
  stats,
  regions,
  onClose,
}: {
  data: RegionsResult;
  stats: UnitStats | null;
  /** Faqat hududlar (o'rin va o'rtachani hisoblash uchun) */
  regions: UnitStats[];
  onClose: () => void;
}) {
  if (!stats) return null;
  const u = stats.unit;
  const label = data.compareLabel[0]!.toUpperCase() + data.compareLabel.slice(1);
  const months12 = data.months.slice(-12);
  const inc12 = u.incomeTrend.slice(-12).map(Number);
  const exp12 = u.expenseTrend.slice(-12).map(Number);

  const isRegion = u.kind === 'region';
  const byProfit = [...regions].sort((a, b) => b.profit - a.profit);
  const byMargin = [...regions].filter((r) => r.margin !== null).sort((a, b) => b.margin! - a.margin!);
  const rankProfit = byProfit.findIndex((r) => r.unit.key === u.key) + 1;
  const rankMargin = byMargin.findIndex((r) => r.unit.key === u.key) + 1;
  const heads = regions.reduce((s, r) => s + r.unit.headcount, 0);
  const avgIncomePerHead = heads > 0 ? regions.reduce((s, r) => s + r.income, 0) / heads : null;
  const avgExpensePerHead = heads > 0 ? regions.reduce((s, r) => s + r.expense, 0) / heads : null;
  const avgMargin = (() => {
    const inc = regions.reduce((s, r) => s + r.income, 0);
    return inc > 0 ? ((inc - regions.reduce((s, r) => s + r.expense, 0)) / inc) * 100 : null;
  })();
  const payrollShare = stats.expense > 0 ? (stats.payroll / stats.expense) * 100 : null;
  const marginDelta = stats.margin !== null && stats.previousMargin !== null ? stats.margin - stats.previousMargin : null;

  // Oddiy tildagi xulosa
  const notes: string[] = [];
  if (stats.income > 0 || stats.expense > 0) {
    notes.push(
      stats.profit >= 0
        ? `${u.name} ${compact(stats.income)} so'm daromad keltirib, ${compact(stats.expense)} so'm sarfladi — ${compact(stats.profit)} so'm foyda bilan ishlamoqda.`
        : `${u.name} ${compact(stats.income)} so'm daromad keltirdi, lekin ${compact(stats.expense)} so'm sarfladi — ${compact(-stats.profit)} so'm zarar.`,
    );
  }
  if (isRegion && rankProfit > 0) {
    notes.push(`Foyda bo'yicha ${regions.length} ta hudud ichida ${rankProfit}-o'rinda${rankMargin > 0 ? `, rentabellik bo'yicha — ${rankMargin}-o'rinda` : ''}.`);
  }
  if (stats.previousIncome !== 0 || stats.previousExpense !== 0) {
    notes.push(
      `${label}ga nisbatan natija ${stats.profitDelta >= 0 ? 'yaxshilangan' : 'yomonlashgan'}: ${signed(stats.profitDelta)} so'm` +
        ` (daromad ${pct(changePct(stats.income, stats.previousIncome), true)}, xarajat ${pct(changePct(stats.expense, stats.previousExpense), true)}).`,
    );
  }
  if (isRegion && stats.incomePerHead !== null && avgIncomePerHead !== null && avgIncomePerHead > 0) {
    const ratio = stats.incomePerHead / avgIncomePerHead;
    notes.push(
      `Bir xodimga ${compact(stats.incomePerHead)} so'm daromad — hududlar o'rtachasidan ${ratio >= 1 ? `${Math.round((ratio - 1) * 100)}% yuqori` : `${Math.round((1 - ratio) * 100)}% past`}.`,
    );
  }
  if (payrollShare !== null) notes.push(`Xarajatning ${pct(payrollShare)} i — xodimlar ish haqi.`);
  if (stats.lossMonths > 0) notes.push(`So'nggi 12 oyning ${stats.lossMonths} tasida zarar bilan yopilgan.`);

  return (
    <Drawer
      open
      onClose={onClose}
      title={u.name}
      description={`${u.kind === 'center' ? 'Markaz' : u.kind === 'region' ? 'Hudud' : u.kind === 'segment' ? "Yo'nalish" : 'Biriktirilmagan yozuvlar'} kartasi${u.kind === 'segment' ? '' : ` · ${u.headcount} xodim (Xodimlar bo'limidan)`}`}
      footer={
        <div className="flex w-full justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Yopish
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <QuickMarks unit={u} section={data.section} />
        <section>
          <h4 className={SEC}>
            {BAR}
            Natija va {data.compareLabel}
          </h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-(--color-line) bg-[#f8f9fc] p-4">
            <Stat
              label="Daromad"
              value={som(stats.income)}
              calc={calcSum(`${u.name} daromadi`, u.incomeParts.map((p) => Q.money(p.label, p.amountTiyin)))}
              sub={
                <CalcValue calc={calcChange("Daromad: o'zgarish", Q.money('Joriy davr', stats.income), Q.money(label, stats.previousIncome), { growthGood: true })}>
                  avval {compact(stats.previousIncome)} · {pct(changePct(stats.income, stats.previousIncome), true)}
                </CalcValue>
              }
            />
            <Stat
              label="Xarajat"
              value={som(stats.expense)}
              calc={calcSum(`${u.name} xarajati`, u.expenseParts.map((p) => Q.money(p.label, p.amountTiyin)))}
              sub={
                <CalcValue calc={calcChange("Xarajat: o'zgarish", Q.money('Joriy davr', stats.expense), Q.money(label, stats.previousExpense), { growthGood: false })}>
                  avval {compact(stats.previousExpense)} · {pct(changePct(stats.expense, stats.previousExpense), true)}
                </CalcValue>
              }
            />
            <Stat
              label={stats.profit >= 0 ? 'Foyda' : 'Zarar'}
              value={som(stats.profit)}
              valueClass={stats.profit < 0 ? 'text-(--color-expense)' : 'text-(--color-income)'}
              calc={calcResult(stats.income, stats.expense, { title: `Natija: ${u.name}` })}
              sub={`avval ${compact(stats.previousProfit)} · ${signed(stats.profitDelta)}`}
            />
            <Stat
              label="Rentabellik"
              value={pct(stats.margin)}
              calc={calcMargin(stats.income, stats.expense)}
              sub={
                marginDelta === null ? (
                  `avval ${pct(stats.previousMargin)}`
                ) : (
                  <CalcValue
                    calc={{
                      title: 'Rentabellik farqi',
                      formula: 'Farq (p.p.) = Joriy rentabellik − Oldingi rentabellik',
                      inputs: [
                        { label: 'Joriy rentabellik', value: stats.margin ?? 0, kind: 'pct' },
                        { label: 'Oldingi rentabellik', value: stats.previousMargin ?? 0, kind: 'pct' },
                      ],
                      steps: [`= ${pctText(stats.margin ?? 0)} − ${pctText(stats.previousMargin ?? 0)}`, `= ${decimalText(marginDelta, 1)} p.p.`],
                      result: `${decimalText(marginDelta, 1)} foiz punkti`,
                      formulaId: 'diffPp',
                    }}
                  >
                    avval {pct(stats.previousMargin)} · {pp(marginDelta)}
                  </CalcValue>
                )
              }
            />
          </dl>
        </section>

        {isRegion && (
          <section>
            <h4 className={SEC}>
              {BAR}
              Boshqa hududlar bilan solishtirma
            </h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-(--color-line) bg-[#f8f9fc] p-4">
              <Stat label="Foyda bo'yicha o'rni" value={rankProfit > 0 ? `${rankProfit} / ${regions.length}` : ''} />
              <Stat label="Rentabellik bo'yicha o'rni" value={rankMargin > 0 ? `${rankMargin} / ${byMargin.length}` : ''} sub={`hududlar o'rtachasi ${pct(avgMargin)}`} />
              <Stat
                label="Bir xodimga daromad"
                value={stats.incomePerHead === null ? '' : compact(stats.incomePerHead)}
                calc={u.headcount > 0 ? calcDivide('Bir xodimga daromad', Q.money('Daromad', stats.income), { label: 'Xodimlar', value: u.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' }) : null}
                sub={avgIncomePerHead === null ? undefined : `o'rtacha ${compact(avgIncomePerHead)}`}
              />
              <Stat
                label="Bir xodimga xarajat"
                value={stats.expensePerHead === null ? '' : compact(stats.expensePerHead)}
                calc={u.headcount > 0 ? calcDivide('Bir xodimga xarajat', Q.money('Xarajat', stats.expense), { label: 'Xodimlar', value: u.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' }) : null}
                sub={avgExpensePerHead === null ? undefined : `o'rtacha ${compact(avgExpensePerHead)}`}
              />
            </dl>
          </section>
        )}

        <section>
          <h4 className={SEC}>
            {BAR}
            So&apos;nggi 12 oy
          </h4>
          <table className="w-full overflow-hidden rounded-lg border border-(--color-line) text-sm">
            <thead>
              <tr>
                <th className={cn(TH, 'text-left')}>Oy</th>
                <th className={TH}>Daromad</th>
                <th className={TH}>Xarajat</th>
                <th className={TH}>Natija</th>
              </tr>
            </thead>
            <tbody>
              {months12
                .map((m, i) => ({ m, inc: inc12[i] ?? 0, exp: exp12[i] ?? 0 }))
                .filter((r) => r.inc !== 0 || r.exp !== 0)
                .reverse()
                .map((r) => (
                  <tr key={r.m} className="odd:bg-white even:bg-[#fafbfe]">
                    <td className={cn(TD, 'text-left')}>{formatPeriod(r.m)}</td>
                    <td className={cn(TD, 'whitespace-nowrap text-(--color-income)')}>{compact(r.inc)}</td>
                    <td className={cn(TD, 'whitespace-nowrap text-(--color-expense)')}>{compact(r.exp)}</td>
                    <td className={cn(TD, 'whitespace-nowrap font-semibold', r.inc - r.exp < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{compact(r.inc - r.exp)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        <PartsTable title="Xarajat tarkibi" parts={u.expenseParts} growthGood={false} markOf={(p) => unitPartMark(u, 'EXPENSE', p, data.section)} />
        <PartsTable title="Daromad keltirgan xizmatlar" parts={u.incomeParts} growthGood markOf={(p) => unitPartMark(u, 'INCOME', p, data.section)} />

        <section>
          <h4 className={SEC}>
            {BAR}
            Xulosa
          </h4>
          <ol className="space-y-1.5 text-sm leading-relaxed">
            {notes.map((note, i) => (
              <li key={note} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-(--color-text-faint)">{i + 1}.</span>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  );
}