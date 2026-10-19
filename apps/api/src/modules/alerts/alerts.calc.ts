// ═══════════════════════════════════════════════════════════
// Ogohlantirish «Qanday hisoblandi?» — sayt (lib/calc.ts Calc) bilan bir xil shakl.
// Har bir holat uchun: formula, sonlar, ishlanishi qadamma-qadam, javob va chegara tekshiruvi.
// ═══════════════════════════════════════════════════════════

export interface AlertQuantity {
  label: string;
  /** money — tiyinda */
  value: number;
  kind?: 'money' | 'count' | 'pct' | 'ratio';
  source?: string;
}

export interface AlertCalc {
  title: string;
  formula: string;
  inputs: AlertQuantity[];
  steps: string[];
  result: string;
  note?: string;
}

const NBSP = ' ';
const MINUS = '−';

function group(v: number): string {
  return Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Tiyin → to'liq so'm: "1 234 567 so'm" */
export function full(tiyin: bigint | number, unit = true): string {
  const v = Math.round(Number(tiyin) / 100);
  return `${v < 0 ? MINUS : ''}${group(v)}${unit ? `${NBSP}so'm` : ''}`;
}

export function pctFull(v: number): string {
  return `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1).replace('.', ',')}%`;
}

const money = (label: string, tiyin: bigint | number, source?: string): AlertQuantity => ({ label, value: Number(tiyin), kind: 'money', source });

/**
 * O'sish yoki kamayish: joriy oy ↔ asos (bir oy yoki bir necha oy o'rtachasi).
 * dir = 'up' — xarajat o'sishi, 'down' — daromad kamayishi.
 */
export function changeAlertCalc(opts: {
  dir: 'up' | 'down';
  label: string;
  currentLabel: string;
  current: bigint;
  base: { label: string; value: bigint }[];
  baseLabel: string;
  thresholdPct: number;
  thresholdSom: number;
  source?: string;
}): AlertCalc {
  const { dir, current, base } = opts;
  const n = base.length;
  const baseSum = base.reduce((s, b) => s + b.value, 0n);
  const baseAvg = n > 0 ? baseSum / BigInt(n) : 0n;
  const diff = dir === 'up' ? current - baseAvg : baseAvg - current;
  const ratio = baseAvg !== 0n ? (Number(diff) / Number(baseAvg)) * 100 : null;
  const steps: string[] = [];
  if (n > 1) steps.push(`Asos = (${base.map((b) => full(b.value, false)).join(' + ')}) ÷ ${n} = ${full(baseAvg)}`);
  else steps.push(`Asos = ${full(baseAvg)}`);
  steps.push(
    dir === 'up'
      ? `O'sish = ${full(current, false)} − ${full(baseAvg, false)} = ${full(diff)}`
      : `Kamayish = ${full(baseAvg, false)} − ${full(current, false)} = ${full(diff)}`,
  );
  if (ratio !== null) steps.push(`Foiz = ${full(diff, false)} ÷ ${full(baseAvg, false)} × 100 = ${pctFull(ratio)}`);
  else steps.push(`Asos 0 — foiz hisoblanmaydi (yangi ${dir === 'up' ? 'xarajat' : 'daromad'})`);
  steps.push(
    `Tekshiruv: ${ratio !== null ? `${pctFull(ratio)} ≥ ${pctFull(opts.thresholdPct)} va ` : ''}${full(diff)} ≥ ${full(opts.thresholdSom * 100)} → ogohlantirish`,
  );
  return {
    title: `${opts.label}: ${dir === 'up' ? "xarajat o'sishi" : 'daromad kamayishi'}`,
    formula:
      dir === 'up'
        ? "O'sish = Joriy oy − Asos; O'sish % = O'sish ÷ Asos × 100 (Asos — oldingi oylar o'rtachasi)"
        : 'Kamayish = Asos − Joriy oy; Kamayish % = Kamayish ÷ Asos × 100 (Asos — oldingi oylar o\'rtachasi)',
    inputs: [money(opts.currentLabel, current, opts.source), ...base.map((b) => money(b.label, b.value, opts.source))],
    steps,
    result: ratio !== null ? `${dir === 'up' ? '+' : MINUS}${pctFull(ratio)} (${dir === 'up' ? '+' : MINUS}${full(diff)})` : `${full(diff)} (yangi)`,
    note: `Chegaralar Sozlamalar › Ogohlantirishlar'da: kamida ${pctFull(opts.thresholdPct)} VA kamida ${full(opts.thresholdSom * 100)}. Asos: ${opts.baseLabel}.`,
  };
}

/** Zarar: Natija = Daromad − Xarajat */
export function lossAlertCalc(label: string, income: bigint, expense: bigint, thresholdSom: number): AlertCalc {
  const result = income - expense;
  return {
    title: `${label}: natija`,
    formula: 'Natija = Daromad − Xarajat; zarar, agar Natija ≤ −chegara',
    inputs: [money('Daromad', income), money('Xarajat', expense)],
    steps: [`= ${full(income, false)} − ${full(expense, false)}`, `= ${full(result)}`, `Tekshiruv: ${full(result)} ≤ ${MINUS}${full(thresholdSom * 100)} → zarar`],
    result: `${full(result)} — zarar`,
    note: `Chegara Sozlamalar › Ogohlantirishlar'da: zarar kamida ${full(thresholdSom * 100)}.`,
  };
}

/** Reja bajarilishi */
export function planAlertCalc(label: string, plan: bigint, fact: bigint, minPct: number): AlertCalc {
  const done = (Number(fact) / Number(plan)) * 100;
  return {
    title: `${label}: reja bajarilishi`,
    formula: 'Bajarilish = Fakt ÷ Reja × 100; Yetmadi = Reja − Fakt',
    inputs: [money('Reja', plan, 'Natijalar fayli'), money('Fakt', fact, 'Natijalar fayli')],
    steps: [
      `Bajarilish = ${full(fact, false)} ÷ ${full(plan, false)} × 100 = ${pctFull(done)}`,
      `Yetmadi = ${full(plan, false)} − ${full(fact, false)} = ${full(plan - fact)}`,
      `Tekshiruv: ${pctFull(done)} < ${pctFull(minPct)} → ogohlantirish`,
    ],
    result: `${pctFull(done)} bajarildi`,
    note: `Chegara Sozlamalar › Ogohlantirishlar'da: bajarilish ${pctFull(minPct)} dan past.`,
  };
}

/** Odatdan tashqari katta yozuv: summa ÷ median */
export function outlierAlertCalc(label: string, amount: bigint, history: number[], typical: number, factor: number, minSom: number): AlertCalc {
  const times = Number(amount) / typical;
  return {
    title: `${label}: odatdagidan katta yozuv`,
    formula: "Barobar = Yozuv summasi ÷ Odatiy yozuv (shu moddaning so'nggi 12 oydagi yozuvlari medianasi)",
    inputs: [money('Yozuv summasi', amount), money('Odatiy yozuv (median)', typical, `${history.length} ta yozuvdan`)],
    steps: [
      `Median: ${history.length} ta yozuv kattaligi bo'yicha tartiblanadi, o'rtadagisi olinadi = ${full(typical)}`,
      `Barobar = ${full(amount, false)} ÷ ${full(typical, false)} = ${times.toFixed(2).replace('.', ',')}`,
      `Tekshiruv: ${times.toFixed(2).replace('.', ',')} ≥ ${String(factor).replace('.', ',')} va ${full(amount)} ≥ ${full(minSom * 100)} → ogohlantirish`,
    ],
    result: `${times.toFixed(1).replace('.', ',')} barobar katta`,
    note: "Median — o'rtacha emas: bitta juda katta yozuv uni buzmaydi.",
  };
}

/** Qarz: yozuvlar yig'indisi */
export function debtAlertCalc(label: string, items: { label: string; value: bigint }[], minSom: number, extra: string): AlertCalc {
  const total = items.reduce((s, i) => s + i.value, 0n);
  const shown = items.slice(0, 12);
  return {
    title: `${label}: qarz`,
    formula: "Qarz = to'lanmagan yozuvlar summalari yig'indisi (qisman to'langanda — summa − to'langan)",
    inputs: [...shown.map((i) => money(i.label, i.value)), ...(items.length > 12 ? [money(`Yana ${items.length - 12} ta yozuv`, items.slice(12).reduce((s, i) => s + i.value, 0n))] : [])],
    steps: [`${items.length} ta yozuv qo'shiladi`, `= ${full(total)}`, `Tekshiruv: ${full(total)} ≥ ${full(minSom * 100)}; ${extra}`],
    result: full(total),
  };
}

/** Nazorat holati */
export function controlAlertCalc(label: string, statusText: string, value: bigint | null, limit: bigint, usage: number | null): AlertCalc {
  return {
    title: `${label}: nazorat`,
    formula: 'Foydalanish = Oy summasi (joriy oyda — oy oxirigacha taxmin) ÷ Chegara × 100',
    inputs: [...(value !== null ? [money('Oy summasi / taxmin', value)] : []), money('Chegara', limit)],
    steps: [
      ...(value !== null && usage !== null ? [`= ${full(value, false)} ÷ ${full(limit, false)} × 100 = ${pctFull(usage)}`] : []),
      statusText,
    ],
    result: usage !== null ? pctFull(usage) : statusText,
    note: "Batafsil — Nazorat sahifasida, oylar bo'yicha.",
  };
}