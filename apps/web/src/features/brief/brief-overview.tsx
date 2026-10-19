'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { CalcValue } from '@/components/ui/calc';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Change, Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { incomesApi } from '@/features/incomes/api';
import { structureApi, type FlowResult, type StructureTree } from '@/features/structure/api';
import { calcChange, calcDiff, calcDivide, calcMargin, calcPp, calcResult, calcShare, decimalText, moneyText, Q, type Calc } from '@/lib/calc';
import { formatDate, formatPercent, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════
// Tahlil — qisqa (rahbar) ko'rinishi.
//   1. To'rtta kartochka: daromad, xarajat, foyda, rentabellik (+ kichik «1 so'mga» qatori)
//   2. Foyda nima uchun o'zgardi — o'tgan teng davr foydasidan joriy foydagacha, modda-modda
//   3. Diqqat talab qiladi — zarar, xarajatning tez o'sishi, tushmagan daromad, odatdan keskin farqlar
//   4. Oylik grafik — oxirgi 12 oy: daromad, xarajat va foyda
// Ma'lumot: /structure/flow, /structure/:kind/tree?flat=1, /incomes (tushgan summa) —
// faqat Daromadlar va Xarajatlar yozuvlaridan.
// ═══════════════════════════════════════════════════════════

const INCOME_SRC = "Daromadlar ro'yxati";
const EXPENSE_SRC = "Xarajatlar ro'yxati";

function rangeText(r: DateRange): string {
  return `${formatDate(r.from)} — ${formatDate(r.to)}`;
}

function signed(tiyin: number): string {
  return `${tiyin > 0 ? '+' : tiyin < 0 ? '−' : ''}${formatTiyin(Math.abs(tiyin))}`;
}

function tone(value: number): string {
  return value > 0 ? 'text-(--color-income)' : value < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)';
}

function pctChange(now: number, before: number): number | null {
  return before === 0 ? null : ((now - before) / Math.abs(before)) * 100;
}

interface Data {
  flow: FlowResult;
  income: StructureTree;
  expense: StructureTree;
  paid: number;
  incomeCount: number;
  expenseCount: number;
}

export function BriefOverview({ range }: { range: DateRange }) {
  const data = useAsync<Data>(
    () =>
      Promise.all([
        structureApi.flow(range, 'ALL', 'prev'),
        structureApi.tree('income', range, 'ALL', [], 'prev', true),
        structureApi.tree('expense', range, 'ALL', [], 'prev', true),
        incomesApi.list({ dateFrom: range.from, dateTo: range.to, limit: 1 }),
      ]).then(([flow, income, expense, list]) => ({
        flow: flow.data,
        income: income.data,
        expense: expense.data,
        paid: Number(list.meta.paidTiyin ?? 0),
        incomeCount: income.data.count,
        expenseCount: expense.data.count,
      })),
    [range.from, range.to],
  );

  if (data.loading && !data.data) {
    return (
      <Card>
        <LoadingState />
      </Card>
    );
  }
  if (data.error) {
    return (
      <Card>
        <ErrorState message={data.error} onRetry={data.reload} />
      </Card>
    );
  }
  if (!data.data) return null;
  const d = data.data;

  return (
    <div className={cn('space-y-4 transition-opacity', data.loading && 'opacity-60')}>
      <Kpis d={d} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ProfitBridge d={d} />
        </div>
        <div className="lg:col-span-2">
          <Attention d={d} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Kartochkalar
// ═══════════════════════════════════════════════════════════

function Kpi({ label, children, calc, change, good, changeCalc, sub }: { label: string; children: React.ReactNode; calc?: Calc | null; change?: number | null; good?: boolean; changeCalc?: Calc | null; sub?: React.ReactNode }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <div className="mt-2 text-xl font-semibold">{calc ? <CalcValue calc={calc}>{children}</CalcValue> : children}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-(--color-text-muted)">
        {change !== undefined && <Change percent={change} positiveIsGood={good} calc={changeCalc} className="text-xs" />}
        {sub}
      </div>
    </div>
  );
}

function Kpis({ d }: { d: Data }) {
  const f = d.flow;
  const income = Number(f.income.totalTiyin);
  const expense = Number(f.expense.totalTiyin);
  const profit = Number(f.profitTiyin);
  const incomeBefore = Number(f.income.previousTiyin);
  const expenseBefore = Number(f.expense.previousTiyin);
  const profitBefore = Number(f.previousProfitTiyin);
  const nowText = rangeText(f.range);
  const prevText = rangeText(f.previousRange);
  const prevLabel = `O'tgan teng davr (${prevText})`;
  const ch = (title: string, a: number, b: number, good: boolean) => calcChange(`${title}: o'zgarish`, Q.money(`Joriy davr (${nowText})`, a), Q.money(prevLabel, b), { growthGood: good });

  const marginDiff = f.marginPercent !== null && f.previousMarginPercent !== null ? f.marginPercent - f.previousMarginPercent : null;
  const marginDiffCalc =
    marginDiff !== null
      ? calcPp('Rentabellik farqi', { label: 'Joriy rentabellik', value: f.marginPercent! }, { label: "O'tgan davr rentabelligi", value: f.previousMarginPercent! })
      : null;

  // Kichik «1 so'mga» qatori
  const perSom = income > 0 ? expense / income : null;
  const perSomCalc: Calc | null = (() => {
    if (income <= 0) return null;
    const c = calcDivide("Har 1 so'm daromadga xarajat", Q.money('Xarajat', expense, EXPENSE_SRC), Q.money('Daromad', income, INCOME_SRC), 'ratio', {
      note: "1 dan kichik — har so'm daromaddan foyda qoladi; 1 dan katta — zarar.",
    });
    const value = `${decimalText(expense / income, 2)} so'm`;
    return { ...c, steps: [...c.steps.slice(0, -1), `= ${value}`], result: value };
  })();

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Daromad" calc={calcDiffLike('Daromad', income, d.incomeCount, nowText, INCOME_SRC)} change={pctChange(income, incomeBefore)} good changeCalc={ch('Daromad', income, incomeBefore, true)} sub={`avval ${formatTiyin(incomeBefore)}`}>
          <Money tiyin={String(income)} tone="income" />
        </Kpi>
        <Kpi label="Xarajat" calc={calcDiffLike('Xarajat', expense, d.expenseCount, nowText, EXPENSE_SRC)} change={pctChange(expense, expenseBefore)} good={false} changeCalc={ch('Xarajat', expense, expenseBefore, false)} sub={`avval ${formatTiyin(expenseBefore)}`}>
          <Money tiyin={String(expense)} tone="expense" />
        </Kpi>
        <Kpi label={profit >= 0 ? 'Foyda' : 'Zarar'} calc={calcResult(income, expense, { title: 'Foyda', note: nowText })} change={pctChange(profit, profitBefore)} good changeCalc={ch('Foyda', profit, profitBefore, true)} sub={`avval ${formatTiyin(profitBefore)}`}>
          <Money tiyin={String(profit)} tone="auto" />
        </Kpi>
        <Kpi
          label="Rentabellik"
          calc={calcMargin(income, expense, { note: nowText })}
          sub={
            marginDiff === null ? (
              'Foyda ÷ daromad'
            ) : (
              <CalcValue calc={marginDiffCalc}>
                <span className={cn('money font-semibold', tone(marginDiff))}>{`${marginDiff >= 0 ? '+' : '−'}${Math.abs(marginDiff).toFixed(1).replace('.', ',')} punkt`}</span>
              </CalcValue>
            )
          }
        >
          <span className={cn('money', (f.marginPercent ?? 0) >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>{formatPercent(f.marginPercent)}</span>
        </Kpi>
      </div>

      {perSom !== null && (
        <p className="px-1 text-sm text-(--color-text-muted)">
          Har 1 so&apos;m daromadga{' '}
          <CalcValue calc={perSomCalc}>
            <span className={cn('money font-semibold', perSom < 1 ? 'text-(--color-income)' : 'text-(--color-expense)')}>{perSom.toFixed(2).replace('.', ',')} so&apos;m</span>
          </CalcValue>{' '}
          xarajat to&apos;g&apos;ri keladi — {perSom < 1 ? `${(1 - perSom).toFixed(2).replace('.', ',')} so'm foyda qoladi` : `${(perSom - 1).toFixed(2).replace('.', ',')} so'm zarar`}.
        </p>
      )}
    </div>
  );
}

/** Jami summa — yozuvlar yig'indisi */
function calcDiffLike(title: string, tiyin: number, count: number, period: string, source: string): Calc {
  return {
    title,
    formula: `${title} = davrdagi barcha yozuvlar summalari yig'indisi`,
    inputs: [
      { label: 'Yozuvlar soni', value: count, kind: 'count', source },
      { label: title, value: tiyin, kind: 'money', source },
    ],
    steps: [`Davr: ${period}`, `${count} ta yozuv qo'shildi`, `= ${moneyText(tiyin)}`],
    result: moneyText(tiyin),
    formulaId: 'sum',
  };
}

// ═══════════════════════════════════════════════════════════
// 2. Foyda nima uchun o'zgardi
// ═══════════════════════════════════════════════════════════

interface Effect {
  key: string;
  kind: 'income' | 'expense';
  label: string;
  now: number;
  before: number;
  /** Foydaga ta'siri: daromadda +farq, xarajatda −farq */
  effect: number;
}

/** Ikki tomonning o'zgarishini foydaga ta'sir sifatida yig'adi (Σ ta'sir = foyda farqi) */
function effects(d: Data): Effect[] {
  const out: Effect[] = [];
  for (const kind of ['income', 'expense'] as const) {
    const tree = d[kind];
    const byKey = new Map(tree.nodes.map((n) => [n.key, n]));
    for (const drv of tree.insights?.drivers ?? []) {
      const delta = Number(drv.deltaTiyin);
      if (delta === 0) continue;
      const n = byKey.get(drv.key);
      out.push({
        key: `${kind}:${drv.key}`,
        kind,
        label: drv.key === 'rest' ? (kind === 'income' ? 'Boshqa daromadlar' : 'Boshqa xarajatlar') : drv.label,
        now: n ? Number(n.amountTiyin) : NaN,
        before: n ? Number(n.previousTiyin) : NaN,
        effect: kind === 'income' ? delta : -delta,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

/** Qisqa rejim: eng katta ta'sirli moddalar (qolgani — To'liq rejimda, Tahlil › Dinamika) */
const BRIDGE_LIMIT = 5;

function effectCalc(e: Effect, prevText: string): Calc {
  const word = e.kind === 'income' ? 'daromad' : 'xarajat';
  const known = Number.isFinite(e.now) && Number.isFinite(e.before);
  const delta = e.kind === 'income' ? e.effect : -e.effect;
  return {
    title: `«${e.label}»: foydaga ta'siri`,
    formula: e.kind === 'income' ? "Foydaga ta'siri = Joriy daromad − O'tgan davr daromadi" : "Foydaga ta'siri = −(Joriy xarajat − O'tgan davr xarajati)",
    inputs: known
      ? [
          { label: `Joriy ${word}`, value: e.now, kind: 'money' },
          { label: `O'tgan davr ${word}i (${prevText})`, value: e.before, kind: 'money' },
        ]
      : [{ label: `${word} farqi`, value: delta, kind: 'money' }],
    steps: known
      ? e.kind === 'income'
        ? [`= ${moneyText(e.now, false)} − ${moneyText(e.before, false)}`, `= ${moneyText(e.effect)}`]
        : [`= −(${moneyText(e.now, false)} − ${moneyText(e.before, false)})`, `= −(${moneyText(delta, false)})`, `= ${moneyText(e.effect)}`]
      : [`Qolgan moddalar farqlari yig'indisi`, `= ${moneyText(e.effect)}`],
    result: moneyText(e.effect),
    note: e.kind === 'income' ? "Daromad oshsa — foyda oshadi." : "Xarajat oshsa — foyda kamayadi, kamaysa — oshadi.",
  };
}

function ProfitBridge({ d }: { d: Data }) {
  const f = d.flow;
  const profit = Number(f.profitTiyin);
  const before = Number(f.previousProfitTiyin);
  const delta = profit - before;
  const prevText = rangeText(f.previousRange);
  const list = effects(d);
  const shown = list.slice(0, BRIDGE_LIMIT);
  const restSum = list.slice(BRIDGE_LIMIT).reduce((s, e) => s + e.effect, 0);

  const totalCalc: Calc = {
    title: 'Joriy foyda',
    formula: "Joriy foyda = O'tgan davr foydasi + Σ moddalar ta'siri",
    inputs: [
      { label: `O'tgan davr foydasi (${prevText})`, value: before, kind: 'money' },
      { label: "Σ ta'sirlar", value: delta, kind: 'money' },
    ],
    steps: [`= ${moneyText(before, false)} + (${moneyText(delta, false)})`, `= ${moneyText(profit)}`],
    result: moneyText(profit),
    note: "Ta'sirlar yig'indisi = Daromad farqi − Xarajat farqi = Foyda farqi.",
  };
  const deltaCalc = calcDiff('Foyda farqi', Q.money('Joriy foyda', profit), Q.money(`O'tgan davr foydasi (${prevText})`, before));


  return (
    <Card className="h-full overflow-hidden">
      <CardHeader title="Foyda nima uchun o'zgardi" description={`O'tgan teng davrga (${prevText}) nisbatan: qaysi modda foydani oshirdi (+), qaysi biri kamaytirdi (−)`} />
      <div className="divide-y divide-(--color-line)">
        <div className="flex items-center justify-between bg-(--color-surface-muted) px-4 py-2.5 text-sm">
          <span className="font-medium">O&apos;tgan davr foydasi</span>
          <Money tiyin={String(before)} tone="auto" className="font-semibold" />
        </div>

        {shown.length === 0 && <p className="px-4 py-3 text-sm text-(--color-text-muted)">Moddalar bo&apos;yicha o&apos;zgarish yo&apos;q.</p>}

        {shown.map((e) => (
          <div key={e.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate" title={e.label}>
                {e.label}
              </span>
              <span className="text-[11px] text-(--color-text-muted)">
                {e.kind === 'income' ? 'Daromad' : 'Xarajat'}{' '}
                {e.kind === 'income' ? (e.effect > 0 ? 'oshdi' : 'kamaydi') : e.effect > 0 ? 'kamaydi' : 'oshdi'}
              </span>
            </span>
            <span className={cn('money text-right font-semibold', tone(e.effect))}>
              <CalcValue calc={effectCalc(e, prevText)}>{signed(e.effect)}</CalcValue>
            </span>
          </div>
        ))}

        {list.length > BRIDGE_LIMIT && (
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-4 py-2 text-sm text-(--color-text-muted)">
            <span>Qolgan {list.length - BRIDGE_LIMIT} ta modda (batafsil — To&apos;liq rejimda)</span>
            <span className={cn('money text-right font-semibold', tone(restSum))}>{signed(restSum)}</span>
          </div>
        )}

        <div className="flex items-center justify-between bg-(--color-surface-muted) px-4 py-2.5 text-sm">
          <span className="font-semibold">
            Joriy foyda{' '}
            <CalcValue calc={deltaCalc}>
              <span className={cn('money ml-1 text-xs', tone(delta))}>({signed(delta)})</span>
            </CalcValue>
          </span>
          <CalcValue calc={totalCalc}>
            <Money tiyin={String(profit)} tone="auto" className="text-base font-bold" />
          </CalcValue>
        </div>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Diqqat talab qiladi
// ═══════════════════════════════════════════════════════════

interface Notice {
  key: string;
  level: 'high' | 'medium';
  title: string;
  detail: string;
  calc?: Calc | null;
}

function notices(d: Data): Notice[] {
  const f = d.flow;
  const out: Notice[] = [];
  const income = Number(f.income.totalTiyin);
  const expense = Number(f.expense.totalTiyin);
  const profit = Number(f.profitTiyin);
  const nowText = rangeText(f.range);

  if (profit < 0) {
    out.push({ key: 'loss', level: 'high', title: `Zarar: ${formatTiyin(-profit)} so'm`, detail: 'Xarajat daromaddan ko‘p', calc: calcResult(income, expense, { title: 'Foyda', note: nowText }) });
  }

  const ic = pctChange(income, Number(f.income.previousTiyin));
  const ec = pctChange(expense, Number(f.expense.previousTiyin));
  if (ic !== null && ec !== null && ec - ic >= 5) {
    out.push({
      key: 'gap',
      level: ec - ic >= 15 ? 'high' : 'medium',
      title: "Xarajat daromaddan tezroq o'smoqda",
      detail: `Xarajat ${formatPercent(ec, { sign: true })}, daromad ${formatPercent(ic, { sign: true })}`,
      calc: calcPp("O'sish sur'ati farqi", { label: "Xarajat o'sishi", value: ec }, { label: "Daromad o'sishi", value: ic }, { note: 'Musbat — xarajat daromaddan tezroq o‘smoqda.' }),
    });
  }

  const unpaid = income - d.paid;
  if (income > 0 && unpaid > 0) {
    const share = (unpaid / income) * 100;
    out.push({
      key: 'unpaid',
      level: share >= 30 ? 'high' : 'medium',
      title: `Hali tushmagan daromad: ${formatTiyin(unpaid)} so'm`,
      detail: `Hisoblangan daromadning ${share.toFixed(1).replace('.', ',')}% qismi`,
      calc: calcShare('Tushmagan ulushi', Q.money('Tushmagan (hisoblangan − tushgan)', unpaid, INCOME_SRC), Q.money('Hisoblangan daromad', income, INCOME_SRC)),
    });
  }

  // Odatdan keskin farq: xarajatda — oshish, daromadda — tushish
  for (const kind of ['expense', 'income'] as const) {
    for (const a of d[kind].insights?.anomalies ?? []) {
      const bad = kind === 'expense' ? a.z > 0 : a.z < 0;
      if (!bad) continue;
      const last = Number(a.lastTiyin);
      const avg = Number(a.averageTiyin);
      out.push({
        key: `${kind}:${a.key}:${a.period}`,
        level: Math.abs(a.z) >= 3 ? 'high' : 'medium',
        title: `«${a.label}» ${kind === 'expense' ? 'xarajati odatdan keskin yuqori' : 'daromadi odatdan keskin past'}`,
        detail: `${formatPeriod(a.period)}: ${formatTiyin(last)} (o'rtacha ${formatTiyin(avg)})`,
        calc: calcChange(`«${a.label}»: odatdagidan farq`, Q.money(formatPeriod(a.period), last), Q.money("Oldingi oylar o'rtachasi (12 oygacha)", avg), {
          growthGood: kind === 'income',
          note: `Keskin farq: oldingi oylardan ${Math.abs(a.z).toFixed(1).replace('.', ',')} standart og'ish uzoqda va 15% dan ortiq.`,
        }),
      });
    }
  }

  // Qisqa rejim: eng jiddiy 3 tasi
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1)).slice(0, 3);
}

function Attention({ d }: { d: Data }) {
  const list = notices(d);
  return (
    <Card className="h-full">
      <CardHeader title="Diqqat talab qiladi" description="Zarar, xarajatning tez o'sishi, tushmagan daromad va odatdan keskin farqlar" />
      <CardBody className="space-y-2">
        {list.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-(--color-income-soft) px-3 py-3 text-sm">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--color-income) text-white">✓</span>
            <span>Jiddiy muammo topilmadi.</span>
          </div>
        ) : (
          list.map((n) => (
            <div key={n.key} className={cn('flex gap-3 rounded-lg border px-3 py-2.5', n.level === 'high' ? 'border-(--color-expense)/30 bg-(--color-expense-soft)' : 'border-amber-200 bg-amber-50')}>
              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', n.level === 'high' ? 'bg-(--color-expense)' : 'bg-amber-500')}>!</span>
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-heading">{n.calc ? <CalcValue calc={n.calc} className="text-left">{n.title}</CalcValue> : n.title}</span>
                <span className="block text-xs text-(--color-text-muted)">
                  {n.level === 'high' ? 'Jiddiy' : "E'tibor bering"} · {n.detail}
                </span>
              </span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}