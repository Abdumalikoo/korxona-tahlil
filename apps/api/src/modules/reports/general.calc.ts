import { COMPARE_LABEL, GENERAL_THRESHOLDS, NO_DUE, NO_OWNER, type CompareKind, type DataStatus, type GeneralThresholds } from './general.config';
import { fmtPct, fmtSom } from './reports.format';

// ═══════════════════════════════════════════════════════════
// «Umumiy hisobot» — sof hisoblash qatlami (bazaga murojaat yo'q, testlanadi).
// Pul — tiyinda, BigInt: yig'indi va ayirma aniq; so'mga va foizga faqat ko'rsatishda o'tiladi.
// Nol maxrajda foiz hisoblanmaydi (null) — «—» yoki «Hisoblanmaydi» chiqadi.
// ═══════════════════════════════════════════════════════════

export interface MoneyRow {
  tiyin: bigint;
  categoryCode: string;
  unit: string;
  month: string;
  date: Date;
  source: string;
}

// ───────────────────────── Asosiy amallar ─────────────────────────

export function sumTiyin(rows: { tiyin: bigint }[]): bigint {
  let s = 0n;
  for (const r of rows) s += r.tiyin;
  return s;
}

/** a / b, eng yaqin butunga (yarmi — noldan uzoqqa) */
export function roundDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('roundDiv: nolga bo‘lish');
  const neg = a < 0n !== b < 0n;
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (x * 2n + y) / (2n * y);
  return neg ? -q : q;
}

/** num / den × 100 (%, 4 kasr aniqlikda); den = 0 bo'lsa — null */
export function pctOf(num: bigint, den: bigint): number | null {
  if (den === 0n) return null;
  return Number(roundDiv(num * 1_000_000n, den)) / 10_000;
}

/**
 * O'zgarish foizi: (joriy − baza) / baza × 100.
 * Baza 0 yoki manfiy bo'lsa — hisoblanmaydi (null): manfiy bazadan foiz chalg'itadi.
 */
export function changePct(current: bigint, base: bigint | null): number | null {
  if (base === null || base <= 0n) return null;
  return pctOf(current - base, base);
}

/** Tiyin → so'm (ko'rsatish uchun son; kasr qismi tiyindan) */
export function toSom(t: bigint): number {
  const whole = t / 100n;
  const frac = t % 100n;
  return Number(whole) + Number(frac) / 100;
}

export const som = (t: bigint): string => fmtSom(toSom(t));

export function signedSomText(t: bigint): string {
  return `${t > 0n ? '+' : t < 0n ? '−' : ''}${fmtSom(Math.abs(toSom(t)))}`;
}

export function signedPctText(v: number | null): string {
  if (v === null) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPct(Math.abs(v))}`;
}

// ───────────────────────── Jamlar ─────────────────────────

export interface Totals {
  income: bigint;
  expense: bigint;
  result: bigint;
  /** Rentabellik, %: natija / daromad × 100 (daromad 0 — null) */
  margin: number | null;
  incomeRows: number;
  expenseRows: number;
}

export function totals(incomes: MoneyRow[], expenses: MoneyRow[]): Totals {
  const income = sumTiyin(incomes);
  const expense = sumTiyin(expenses);
  const result = income - expense;
  return { income, expense, result, margin: income > 0n ? pctOf(result, income) : null, incomeRows: incomes.length, expenseRows: expenses.length };
}

/** Taqqoslash: joriy va baza (baza davrida ma'lumot bo'lmasa — null) */
export interface Comparison {
  kind: CompareKind;
  label: string;
  base: Totals | null;
  incomeChange: number | null;
  expenseChange: number | null;
  resultDelta: bigint | null;
  marginDelta: number | null;
}

export function compare(kind: CompareKind, current: Totals, base: Totals): Comparison {
  const empty = base.incomeRows === 0 && base.expenseRows === 0;
  if (empty) return { kind, label: COMPARE_LABEL[kind], base: null, incomeChange: null, expenseChange: null, resultDelta: null, marginDelta: null };
  return {
    kind,
    label: COMPARE_LABEL[kind],
    base,
    incomeChange: changePct(current.income, base.income),
    expenseChange: changePct(current.expense, base.expense),
    resultDelta: current.result - base.result,
    marginDelta: current.margin !== null && base.margin !== null ? Math.round((current.margin - base.margin) * 100) / 100 : null,
  };
}

// ───────────────────────── Natija o'zgarishi sabablari ─────────────────────────

export interface Driver {
  key: string;
  name: string;
  kind: 'income' | 'expense';
  current: bigint;
  base: bigint;
  /** joriy − baza */
  delta: bigint;
  /** Natijaga ta'siri: daromad — delta; xarajat — −delta */
  effect: bigint;
}

export interface DriversResult {
  all: Driver[];
  top: Driver[];
  rest: { count: number; current: bigint; base: bigint; effect: bigint } | null;
  /** Barcha moddalar ta'siri yig'indisi — natija o'zgarishiga teng */
  totalEffect: bigint;
}

/**
 * Daromad — xizmat turi (categoryCode), xarajat — xarajat moddasi (categoryCode) darajasida.
 * Σ ta'sir = ΔDaromad − ΔXarajat = ΔNatija (aniq, BigInt).
 */
export function drivers(
  cur: { incomes: MoneyRow[]; expenses: MoneyRow[] },
  base: { incomes: MoneyRow[]; expenses: MoneyRow[] },
  names: { income: (code: string) => string; expense: (code: string) => string },
  top = GENERAL_THRESHOLDS.topDrivers,
): DriversResult {
  const agg = (rows: MoneyRow[]) => {
    const m = new Map<string, bigint>();
    for (const r of rows) m.set(r.categoryCode, (m.get(r.categoryCode) ?? 0n) + r.tiyin);
    return m;
  };
  const list: Driver[] = [];
  const build = (kind: 'income' | 'expense', a: Map<string, bigint>, b: Map<string, bigint>) => {
    for (const code of new Set([...a.keys(), ...b.keys()])) {
      const current = a.get(code) ?? 0n;
      const prev = b.get(code) ?? 0n;
      const delta = current - prev;
      list.push({ key: `${kind}:${code}`, name: kind === 'income' ? names.income(code) : names.expense(code), kind, current, base: prev, delta, effect: kind === 'income' ? delta : -delta });
    }
  };
  build('income', agg(cur.incomes), agg(base.incomes));
  build('expense', agg(cur.expenses), agg(base.expenses));
  const abs = (v: bigint) => (v < 0n ? -v : v);
  list.sort((x, y) => (abs(y.effect) > abs(x.effect) ? 1 : abs(y.effect) < abs(x.effect) ? -1 : x.name.localeCompare(y.name)));
  const nonZero = list.filter((d) => d.effect !== 0n);
  const head = nonZero.slice(0, top);
  const tail = list.filter((d) => !head.includes(d));
  const totalEffect = list.reduce((s, d) => s + d.effect, 0n);
  return {
    all: list,
    top: head,
    rest: tail.length ? { count: tail.length, current: tail.reduce((s, d) => s + (d.kind === 'income' ? d.current : -d.current), 0n), base: tail.reduce((s, d) => s + (d.kind === 'income' ? d.base : -d.base), 0n), effect: tail.reduce((s, d) => s + d.effect, 0n) } : null,
    totalEffect,
  };
}

// ───────────────────────── Hududlar va Markaz ─────────────────────────

export interface UnitStat {
  key: string;
  name: string;
  kind: 'region' | 'center' | 'none';
  income: bigint;
  expense: bigint;
  result: bigint;
  margin: number | null;
  /** O'rtacha faol xodimlar soni (null — ma'lumot yo'q) */
  headcount: number | null;
  /** Bir xodimga natija, tiyin (xodim 0 yoki yo'q — null) */
  perEmployee: bigint | null;
  /** Davr oylaridan nechtasida daromad yozuvi bor (hudud hisobot bergan) */
  monthsWithData: number;
  months: number;
}

export function unitStats(incomes: MoneyRow[], expenses: MoneyRow[], names: Map<string, string>, headcount: Map<string, number>, months: string[], regionKeys: string[]): UnitStat[] {
  const keys = new Set<string>([...regionKeys, ...incomes.map((r) => r.unit), ...expenses.map((r) => r.unit)]);
  const out: UnitStat[] = [];
  for (const key of keys) {
    const inc = incomes.filter((r) => r.unit === key);
    const exp = expenses.filter((r) => r.unit === key);
    const income = sumTiyin(inc);
    const expense = sumTiyin(exp);
    const result = income - expense;
    const hc = headcount.has(key) ? headcount.get(key)! : null;
    // Bir xodimga: natija / o'rtacha xodimlar (xodimlar 0 — hisoblanmaydi). Kasr xodim — 0,01 aniqlikda
    const perEmployee = hc !== null && hc > 0 ? roundDiv(result * 100n, BigInt(Math.round(hc * 100))) : null;
    const reported = new Set(inc.map((r) => r.month));
    out.push({
      key,
      name: names.get(key) ?? key,
      kind: key.startsWith('r:') ? 'region' : key === 'center' ? 'center' : 'none',
      income,
      expense,
      result,
      margin: income > 0n ? pctOf(result, income) : null,
      headcount: hc,
      perEmployee,
      monthsWithData: months.filter((m) => reported.has(m)).length,
      months: months.length,
    });
  }
  return out;
}

/** Raqobat tartibidagi o'rin (teng qiymat — teng o'rin: 1, 2, 2, 4). null qiymatli — o'rinsiz */
export function ranks<T>(items: T[], key: (t: T) => string, value: (t: T) => number | bigint | null): Map<string, { rank: number; of: number }> {
  const valued = items.filter((t) => value(t) !== null);
  const sorted = [...valued].sort((a, b) => {
    const x = value(a)!;
    const y = value(b)!;
    return x > y ? -1 : x < y ? 1 : 0;
  });
  const out = new Map<string, { rank: number; of: number }>();
  sorted.forEach((t, i) => {
    const prev = sorted[i - 1];
    const rank = prev !== undefined && value(prev) === value(t) ? out.get(key(prev))!.rank : i + 1;
    out.set(key(t), { rank, of: sorted.length });
  });
  return out;
}

export interface CenterCoverage {
  regionsResult: bigint;
  centerExpense: bigint;
  centerIncome: bigint;
  /** Markaz sof xarajati = xarajat − o'z daromadi */
  centerNet: bigint;
  /** Asosiy (Solishtirma bilan bir xil): hududlar natijasi / Markaz sof xarajati × 100 */
  coverageNet: number | null;
  /** Qo'shimcha: hududlar natijasi / Markaz yalpi xarajati × 100 */
  coverageGross: number | null;
}

export function centerCoverage(units: UnitStat[]): CenterCoverage {
  const regionsResult = units.filter((u) => u.kind === 'region').reduce((s, u) => s + u.result, 0n);
  const center = units.find((u) => u.kind === 'center');
  const centerExpense = center?.expense ?? 0n;
  const centerIncome = center?.income ?? 0n;
  const centerNet = centerExpense - centerIncome;
  return {
    regionsResult,
    centerExpense,
    centerIncome,
    centerNet,
    coverageNet: centerNet > 0n ? pctOf(regionsResult, centerNet) : null,
    coverageGross: centerExpense > 0n ? pctOf(regionsResult, centerExpense) : null,
  };
}

// ───────────────────────── Reja–fakt ─────────────────────────

export interface PlanFact {
  plan: bigint | null;
  fact: bigint;
  /** fakt / reja × 100 (reja 0 yoki yo'q — null) */
  execution: number | null;
  /** fakt − reja */
  gap: bigint | null;
  status: DataStatus;
  note: string;
}

export function planFact(fact: bigint, plan: bigint | null, why = 'Reja mavjud emas'): PlanFact {
  if (plan === null) return { plan: null, fact, execution: null, gap: null, status: 'nosource', note: why };
  if (plan === 0n) return { plan, fact, execution: null, gap: fact, status: 'na', note: 'Reja nol — bajarilish foizi hisoblanmaydi' };
  return { plan, fact, execution: pctOf(fact, plan), gap: fact - plan, status: 'full', note: '' };
}

// ───────────────────────── Ma'lumot to'liqligi ─────────────────────────

export interface Completeness {
  status: DataStatus;
  months: string[];
  closedMonths: string[];
  openMonths: string[];
  /** Hisobot bermagan hududlar: nomi va qaysi oylarda */
  waiting: { key: string; name: string; months: string[] }[];
  /** Joriy oy tugamaganmi (davr bugungi kunni o'z ichiga oladi) */
  partialCurrent: { month: string; days: number; ofDays: number } | null;
}

export function completeness(months: string[], closed: Set<string>, regions: { key: string; name: string }[], incomes: MoneyRow[], today: string, rangeTo: string): Completeness {
  const has = new Set(incomes.map((r) => `${r.unit}|${r.month}`));
  const waiting = regions
    .map((r) => ({ key: r.key, name: r.name, months: months.filter((m) => !has.has(`${r.key}|${m}`)) }))
    .filter((r) => r.months.length > 0);
  const closedMonths = months.filter((m) => closed.has(m));
  const openMonths = months.filter((m) => !closed.has(m));
  const curMonth = today.slice(0, 7);
  const partialCurrent =
    rangeTo >= today && months.includes(curMonth)
      ? { month: curMonth, days: Number(today.slice(8, 10)), ofDays: new Date(Date.UTC(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)), 0)).getUTCDate() }
      : null;
  const status: DataStatus = waiting.length === 0 && openMonths.length === 0 && !partialCurrent ? 'full' : 'partial';
  return { status, months, closedMonths, openMonths, waiting, partialCurrent };
}

/** Ehtimoliy takroriy yozuvlar: bir kun, bir summa, bir modda, bir birlik, bir manba */
export function duplicateGroups(rows: MoneyRow[]): { count: number; amount: bigint } {
  const m = new Map<string, { n: number; t: bigint }>();
  for (const r of rows) {
    const k = `${r.date.toISOString().slice(0, 10)}|${r.tiyin}|${r.categoryCode}|${r.unit}|${r.source}`;
    const x = m.get(k) ?? { n: 0, t: r.tiyin };
    x.n += 1;
    m.set(k, x);
  }
  let count = 0;
  let amount = 0n;
  for (const x of m.values()) {
    if (x.n > 1) {
      count += x.n - 1;
      amount += x.t * BigInt(x.n - 1);
    }
  }
  return { count, amount };
}

// ───────────────────────── Xavflar va tavsiyalar ─────────────────────────

export type Priority = 1 | 2 | 3;
export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Yuqori', 2: "O'rta", 3: 'Past' };

export interface Risk {
  /** Qoida kaliti — bir xil sababdagilar birlashadi */
  key: string;
  priority: Priority;
  title: string;
  /** Shart (formula va chegara) */
  condition: string;
  /** Raqamli dalil */
  evidence: string;
  /** Ta'sir qilayotgan hudud yoki modda */
  target: string;
  recommendation: string;
  owner: string;
  due: string;
  /** Tekshirish ko'rsatkichi */
  check: string;
  /** Saralash uchun og'irlik (summa, tiyin) */
  weight: bigint;
}

export interface Responsible {
  owner: string;
  due: string;
}

export interface RiskInputs {
  t?: GeneralThresholds;
  current: Totals;
  comparison: Comparison;
  plan: { revenue: PlanFact; source: string } | null;
  regionPlans: { name: string; pf: PlanFact }[];
  lossRegions: { key: string; name: string; result: bigint }[];
  lossProbability: number | null;
  forecastWape: number | null;
  breachedControls: { label: string; owner: string | null }[];
  overdueReactions: { title: string; owner: string | null; due: string }[];
  growingExpense: Driver | null;
  completeness: Completeness;
  alerts: { title: string; detail: string; severity: 'high' | 'medium'; rule: string }[];
  duplicates: { count: number; amount: bigint };
  /** Hudud yoki modda bo'yicha mavjud Munosabatdagi mas'ul va muddat */
  responsible: (target: { unit?: string; category?: string }) => Responsible | null;
}

/** Xavflar ro'yxati (bir xil sababdagilar birlashtirilgan), ustuvorlik bo'yicha saralangan */
export function risks(input: RiskInputs): Risk[] {
  const t = input.t ?? GENERAL_THRESHOLDS;
  const out: Risk[] = [];
  const who = (target: { unit?: string; category?: string }) => input.responsible(target) ?? { owner: NO_OWNER, due: NO_DUE };
  const abs = (v: bigint) => (v < 0n ? -v : v);

  if (input.lossRegions.length) {
    const sum = input.lossRegions.reduce((s, r) => s + r.result, 0n);
    const first = input.lossRegions[0]!;
    const r = who({ unit: first.key });
    out.push({
      key: 'loss-regions',
      priority: 1,
      title: 'Zarar bilan ishlagan hududlar',
      condition: 'Hudud natijasi (daromad − xarajat) < 0',
      evidence: input.lossRegions.map((x) => `${x.name}: ${som(x.result)}`).join('; '),
      target: input.lossRegions.map((x) => x.name).join(', '),
      recommendation: `Har bir hudud bo'yicha zarar sababini (daromad pasayishi yoki xarajat o'sishi) aniqlash va tiklash rejasini tasdiqlash`,
      owner: r.owner,
      due: r.due,
      check: 'Hudud natijasi keyingi oyda ≥ 0',
      weight: abs(sum),
    });
  }
  if (input.lossProbability !== null && input.lossProbability * 100 >= t.lossProbabilityHighPct) {
    out.push({
      key: 'loss-probability',
      priority: 1,
      title: 'Prognozda zarar xavfi yuqori',
      condition: `Modeldagi 3 oylik zarar ehtimoli ≥ ${t.lossProbabilityHighPct}%`,
      evidence: `Zarar ehtimoli ${fmtPct(input.lossProbability * 100, 0)} (model natijasi, haqiqiy natija emas)`,
      target: 'Butun korxona',
      recommendation: "Xarajatlarni qisqartirish stsenariysini ko'rib chiqish (Katta modellar → Stsenariy)",
      ...who({}),
      check: 'Keyingi oylar natijasi va yangilangan zarar ehtimoli',
      weight: input.current.income,
    });
  }
  if (input.breachedControls.length) {
    const owner = input.breachedControls.find((c) => c.owner)?.owner ?? NO_OWNER;
    out.push({
      key: 'controls',
      priority: 1,
      title: 'Nazorat chegarasi buzilgan',
      condition: 'Nazoratdagi modda oylik qiymati chegaradan oshgan (xarajat) yoki rejadan kam (daromad)',
      evidence: `${input.breachedControls.length} ta modda: ${input.breachedControls.slice(0, 4).map((c) => `«${c.label}»`).join(', ')}${input.breachedControls.length > 4 ? ' …' : ''}`,
      target: input.breachedControls.map((c) => c.label).slice(0, 6).join(', '),
      recommendation: "Mas'ullardan tushuntirish olish va chegarani qayta ko'rib chiqish yoki tuzatuvchi chora belgilash",
      owner,
      due: NO_DUE,
      check: 'Keyingi oyda buzilgan nazoratlar soni',
      weight: BigInt(input.breachedControls.length),
    });
  }
  for (const a of input.alerts.filter((x) => x.severity === 'high')) {
    out.push({ key: `alert:${a.rule}`, priority: 1, title: a.title, condition: 'Avtomatik ogohlantirish (yuqori daraja)', evidence: a.detail, target: a.title, recommendation: "Ogohlantirishni muhokamaga qo'yish (Munosabat ochish)", owner: NO_OWNER, due: NO_DUE, check: "Ogohlantirish keyingi tekshiruvda yo'qolishi", weight: 0n });
  }
  const rev = input.plan?.revenue;
  if (rev && rev.execution !== null && rev.execution < t.planExecutionWarnPct) {
    out.push({
      key: 'plan-company',
      priority: 2,
      title: 'Daromad rejasi bajarilmayapti',
      condition: `Reja bajarilishi < ${t.planExecutionWarnPct}%`,
      evidence: `Bajarilish ${fmtPct(rev.execution)}; rejadan farq ${signedSomText(rev.gap ?? 0n)} (${input.plan!.source})`,
      target: 'Butun korxona',
      recommendation: 'Rejadan ortda qolgan xizmat va hududlarni aniqlab, qolgan davr uchun tuzatuvchi reja tuzish',
      ...who({}),
      check: 'Reja bajarilishi, %',
      weight: abs(rev.gap ?? 0n),
    });
  }
  const behind = input.regionPlans.filter((r) => r.pf.execution !== null && r.pf.execution < t.planExecutionWarnPct);
  if (behind.length) {
    const gap = behind.reduce((s, r) => s + (r.pf.gap ?? 0n), 0n);
    out.push({
      key: 'plan-regions',
      priority: 2,
      title: 'Hududlar rejasi bajarilmagan',
      condition: `Hudud oylik rejasi bajarilishi < ${t.planExecutionWarnPct}%`,
      evidence: behind.map((r) => `${r.name}: ${fmtPct(r.pf.execution)}`).join('; '),
      target: behind.map((r) => r.name).join(', '),
      recommendation: "Hududlar bilan reja bajarilmasligi sabablarini ko'rib chiqish",
      owner: NO_OWNER,
      due: NO_DUE,
      check: 'Hudud rejasi bajarilishi, %',
      weight: abs(gap),
    });
  }
  const cmp = input.comparison;
  if (cmp.expenseChange !== null && cmp.expenseChange > t.expenseGrowthPct) {
    const g = input.growingExpense;
    const r = who(g ? { category: g.key.split(':')[1] } : {});
    out.push({
      key: 'expense-growth',
      priority: 2,
      title: "Xarajat o'sishi",
      condition: `Xarajat o'sishi > ${t.expenseGrowthPct}% (${cmp.label}ga nisbatan)`,
      evidence: `Xarajat ${signedPctText(cmp.expenseChange)}${g ? `; eng ko'p o'sgan modda — ${g.name} (${signedSomText(g.delta)})` : ''}`,
      target: g?.name ?? 'Xarajatlar',
      recommendation: `O'sish sababini aniqlash${g ? ` («${g.name}»)` : ''} va oylik chegara bilan Nazoratga qo'yish`,
      owner: r.owner,
      due: r.due,
      check: "Xarajat o'zgarishi, %",
      weight: abs(g?.delta ?? 0n),
    });
  }
  if (cmp.incomeChange !== null && cmp.incomeChange < -t.incomeDropPct) {
    out.push({
      key: 'income-drop',
      priority: 2,
      title: 'Daromad pasayishi',
      condition: `Daromad pasayishi > ${t.incomeDropPct}% (${cmp.label}ga nisbatan)`,
      evidence: `Daromad ${signedPctText(cmp.incomeChange)}`,
      target: 'Daromadlar',
      recommendation: "Pasaygan xizmat turlari va hududlarni aniqlab, sababini o'rganish",
      ...who({}),
      check: "Daromad o'zgarishi, %",
      weight: cmp.base ? abs(input.current.income - cmp.base.income) : 0n,
    });
  }
  if (input.overdueReactions.length) {
    const first = input.overdueReactions[0]!;
    out.push({
      key: 'overdue-reactions',
      priority: 2,
      title: "Muddati o'tgan munosabatlar",
      condition: "Munosabat ochiq va muddati davr oxirida o'tgan",
      evidence: input.overdueReactions.slice(0, 4).map((r) => `«${r.title}» (muddat ${r.due})`).join('; '),
      target: input.overdueReactions.map((r) => r.title).slice(0, 5).join(', '),
      recommendation: 'Natijani muhokama qilib, yopish yoki Nazoratga o‘tkazish',
      owner: first.owner ?? NO_OWNER,
      due: NO_DUE,
      check: "Muddati o'tgan munosabatlar soni",
      weight: BigInt(input.overdueReactions.length),
    });
  }
  const c = input.completeness;
  if (c.waiting.length || c.openMonths.length || input.duplicates.count) {
    const parts = [
      c.waiting.length ? `${c.waiting.length} ta hudud ma'lumoti to'liq emas` : '',
      c.openMonths.length ? `yopilmagan oylar: ${c.openMonths.join(', ')}` : '',
      input.duplicates.count ? `${input.duplicates.count} ta ehtimoliy takroriy yozuv (${som(input.duplicates.amount)})` : '',
    ].filter(Boolean);
    out.push({
      key: 'data-quality',
      priority: 2,
      title: "Ma'lumot to'liq emas",
      condition: "Hududlar hisobot bermagan, oy yopilmagan yoki takroriy yozuvlar bor",
      evidence: parts.join('; '),
      target: c.waiting.map((w) => w.name).slice(0, 6).join(', ') || 'Ma’lumotlar',
      recommendation: "Kutilayotgan hududlar ma'lumotini olish, oylarni tekshirib yopish, takroriy yozuvlarni ko'rib chiqish",
      owner: NO_OWNER,
      due: NO_DUE,
      check: "Ma'lumot holati «To'liq»",
      weight: BigInt(c.waiting.length + c.openMonths.length),
    });
  }
  if (input.forecastWape !== null && input.forecastWape > t.forecastErrorPct) {
    out.push({
      key: 'forecast-error',
      priority: 3,
      title: 'Prognoz ishonchliligi past',
      condition: `Model o'rtacha xatosi (WAPE) > ${t.forecastErrorPct}%`,
      evidence: `O'rtacha xato ${fmtPct(input.forecastWape)}`,
      target: 'Yil yakuni prognozi',
      recommendation: "Prognozni qaror uchun yagona asos qilmaslik; ma'lumot to'planishi bilan qayta baholash",
      owner: NO_OWNER,
      due: NO_DUE,
      check: 'Model xatosi, %',
      weight: 0n,
    });
  }
  // Bir xil kalit — bitta xavf (masalan, bir nechta bir xil ogohlantirish)
  const merged = new Map<string, Risk>();
  for (const r of out) {
    const prev = merged.get(r.key);
    if (!prev) merged.set(r.key, r);
    else merged.set(r.key, { ...prev, evidence: `${prev.evidence}; ${r.evidence}`, target: `${prev.target}, ${r.target}`, weight: prev.weight + r.weight });
  }
  return [...merged.values()].sort((a, b) => a.priority - b.priority || (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0));
}

// ───────────────────────── Avtomatik xulosalar ─────────────────────────

export interface SummaryInputs {
  current: Totals;
  comparison: Comparison;
  plan: PlanFact | null;
  planSource: string | null;
  best: UnitStat | null;
  worst: UnitStat | null;
  yearEnd: { total: bigint; wape: number | null } | null;
  highRisks: number;
  incompleteRegions: number;
}

/** 4–6 ta xulosa; faqat mavjud va hisoblangan qiymatlardan */
export function summaries(s: SummaryInputs): string[] {
  const out: string[] = [];
  const c = s.current;
  if (c.incomeRows === 0 && c.expenseRows === 0) {
    out.push("Hisobot davrida daromad va xarajat yozuvlari yo'q — moliyaviy xulosa chiqarilmaydi.");
  } else {
    out.push(`Hisobot davrida daromad ${som(c.income)}, xarajat ${som(c.expense)}, moliyaviy natija ${som(c.result)}${c.margin !== null ? ` (rentabellik ${fmtPct(c.margin)})` : ''}.`);
  }
  const k = s.comparison;
  if (k.base && k.resultDelta !== null) {
    const parts: string[] = [];
    if (k.incomeChange !== null) parts.push(`daromad ${signedPctText(k.incomeChange)}`);
    if (k.expenseChange !== null) parts.push(`xarajat ${signedPctText(k.expenseChange)}`);
    out.push(`${capital(k.label)}ga nisbatan ${parts.length ? `${parts.join(', ')} o'zgardi; ` : ''}natija ${signedSomText(k.resultDelta)}ga o'zgardi.`);
  }
  if (s.plan && s.plan.execution !== null && s.plan.gap !== null) {
    out.push(`Daromad rejasi ${fmtPct(s.plan.execution)} bajarildi; rejadan farq ${signedSomText(s.plan.gap)}${s.planSource ? ` (${s.planSource})` : ''}.`);
  }
  if (s.best && s.worst && s.best.key !== s.worst.key) {
    out.push(`Eng yuqori natija — ${s.best.name} (${som(s.best.result)}), eng past natija — ${s.worst.name} (${som(s.worst.result)}).`);
  }
  if (s.yearEnd) {
    out.push(`Yil yakuni prognozi ${som(s.yearEnd.total)}${s.yearEnd.wape !== null ? `; model o'rtacha xatosi ${fmtPct(s.yearEnd.wape)}` : ''}. Bu prognoz, haqiqiy natija emas.`);
  }
  if (s.highRisks || s.incompleteRegions) {
    const p = [s.highRisks ? `${s.highRisks} ta yuqori ustuvor xavf aniqlandi` : '', s.incompleteRegions ? `${s.incompleteRegions} ta hudud ma'lumoti to'liq emas` : ''].filter(Boolean);
    out.push(`${capital(p.join('; '))}.`);
  }
  return out.slice(0, 6);
}

function capital(t: string): string {
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}