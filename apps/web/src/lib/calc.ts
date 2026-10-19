// ═══════════════════════════════════════════════════════════
// «Qanday hisoblandi?» — har bir hisoblangan raqamning bosqichma-bosqich izohi.
// Bitta joyda: formulalar ro'yxati (FORMULAS) va ularni aniq sonlar bilan
// ishlaydigan quruvchilar. Sayt, Excel, slayd va PDF bir xil matnni ishlatadi.
// Pul qiymatlari kirishda TIYINDA (backend kabi), chiqishda to'liq so'mda.
// ═══════════════════════════════════════════════════════════

/** Hisobdagi bitta son */
export interface Quantity {
  label: string;
  /** money — tiyinda; count — dona; pct — foiz; ratio — oddiy son */
  value: number;
  kind?: 'money' | 'count' | 'pct' | 'ratio';
  /** Son qayerdan olingani: "Hududlar tushumi", "Ish haqi qaydnomasi"... */
  source?: string;
}

export interface Calc {
  /** Ko'rsatkich nomi: "Natija" */
  title: string;
  /** Formula so'z bilan: "Natija = Daromad − Xarajat" */
  formula: string;
  /** Formulaga kirgan sonlar */
  inputs: Quantity[];
  /** Ishlanishi: har qadam alohida qator ("= 184 500 000 − 96 300 000") */
  steps: string[];
  /** Yakuniy javob (formatlangan) */
  result: string;
  /** Qo'shimcha izoh: davr, chegara, nima uchun hisoblanmadi */
  note?: string;
  /** Formulalar ro'yxatidagi kalit (Formulalar sahifasi uchun) */
  formulaId?: FormulaId;
}

// ─────────── Formatlash ───────────

const NBSP = ' ';
const MINUS = '−';

function group(value: number): string {
  return Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Tiyin → "1 234 567 so'm" (to'liq, yaxlitlangan) */
export function moneyText(tiyin: number, withUnit = true): string {
  const som = Math.round(tiyin / 100);
  return `${som < 0 ? MINUS : ''}${group(som)}${withUnit ? `${NBSP}so'm` : ''}`;
}

/** Oddiy son: "12,35" (vergul bilan) */
export function decimalText(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const fixed = Math.abs(value).toFixed(digits);
  const [int, frac] = fixed.split('.');
  return `${value < 0 ? MINUS : ''}${group(Number(int))}${frac && Number(frac) !== 0 ? `,${frac.replace(/0+$/, '')}` : ''}`;
}

export function pctText(value: number, digits = 1, sign = false): string {
  if (!Number.isFinite(value)) return '—';
  const s = sign && value > 0 ? '+' : value < 0 ? MINUS : '';
  return `${s}${Math.abs(value).toFixed(digits).replace('.', ',')}%`;
}

/** Hisob ichidagi son: manfiy bo'lsa qavsda */
export function qText(q: Quantity, withUnit = false): string {
  const kind = q.kind ?? 'money';
  let text: string;
  if (kind === 'money') text = moneyText(q.value, withUnit);
  else if (kind === 'count') text = `${q.value < 0 ? MINUS : ''}${group(Math.round(q.value))}${withUnit ? `${NBSP}ta` : ''}`;
  else if (kind === 'pct') text = pctText(q.value);
  else text = decimalText(q.value);
  return q.value < 0 && !withUnit ? `(${text})` : text;
}

/** Natija birligi bilan */
export function qFull(q: Quantity): string {
  return qText(q, true);
}

// ═══════════════════════════════════════════════════════════
// Formulalar ro'yxati — dasturdagi hamma formula bir joyda
// ═══════════════════════════════════════════════════════════

export const FORMULAS = {
  result: { name: 'Natija (foyda yoki zarar)', formula: 'Natija = Daromad − Xarajat', meaning: "Musbat — foyda, manfiy — zarar." },
  sum: { name: "Yig'indi", formula: "Jami = 1-qism + 2-qism + … + n-qism", meaning: "Qismlar qo'shiladi; jami har doim qismlar yig'indisiga teng." },
  change: { name: "O'zgarish, %", formula: "O'zgarish = (Joriy − Oldingi) ÷ |Oldingi| × 100", meaning: "Oldingi davr 0 bo'lsa foiz hisoblanmaydi («yangi»)." },
  delta: { name: "Farq (so'mda)", formula: 'Farq = Joriy − Oldingi', meaning: "Musbat — oshgan, manfiy — kamaygan." },
  share: { name: 'Ulush, %', formula: 'Ulush = Qism ÷ Jami × 100', meaning: 'Qism jamining necha foizini tashkil qiladi.' },
  margin: { name: 'Rentabellik, %', formula: 'Rentabellik = Natija ÷ Daromad × 100', meaning: "Har 100 so'm daromaddan qancha foyda qolgani." },
  perHead: { name: 'Bir xodimga', formula: 'Bir xodimga = Summa ÷ Xodimlar soni', meaning: 'Hudud kattaligidan qat\'i nazar solishtirish uchun.' },
  average: { name: "O'rtacha narx", formula: "O'rtacha = Summa ÷ Soni", meaning: "Bitta xizmat o'rtacha necha so'mdan ko'rsatilgani." },
  completion: { name: 'Reja bajarilishi, %', formula: 'Bajarilish = Fakt ÷ Reja × 100', meaning: "100% va undan yuqori — reja bajarilgan." },
  ratio: { name: 'Nisbat', formula: 'Nisbat = A ÷ B', meaning: "Masalan, daromad xarajatdan necha barobar katta." },
  mean: { name: "O'rtacha qiymat", formula: "O'rtacha = (1-qiymat + … + n-qiymat) ÷ n", meaning: 'Bir necha davr qiymatlarining o\'rtachasi.' },
  diffPp: { name: "Foiz punkti farqi", formula: 'Farq (p.p.) = Joriy % − Oldingi %', meaning: "Ikki foiz orasidagi oddiy ayirma." },
} as const;

export type FormulaId = keyof typeof FORMULAS;

// ═══════════════════════════════════════════════════════════
// Quruvchilar
// ═══════════════════════════════════════════════════════════

const money = (label: string, tiyin: number | string, source?: string): Quantity => ({ label, value: Number(tiyin), kind: 'money', source });
const count = (label: string, value: number, source?: string): Quantity => ({ label, value, kind: 'count', source });
export const Q = { money, count };

/** A − B (natija, farq) */
export function calcDiff(title: string, a: Quantity, b: Quantity, opts: { formulaId?: FormulaId; note?: string } = {}): Calc {
  const value = a.value - b.value;
  const out: Quantity = { label: title, value, kind: a.kind };
  return {
    title,
    formula: `${title} = ${a.label} − ${b.label}`,
    inputs: [a, b],
    steps: [`= ${qText(a)} − ${qText(b)}`, `= ${qFull(out)}`],
    result: qFull(out),
    note: opts.note,
    formulaId: opts.formulaId ?? 'delta',
  };
}

/** Natija = Daromad − Xarajat */
export function calcResult(income: number | string, expense: number | string, opts: { title?: string; note?: string; incomeSource?: string; expenseSource?: string } = {}): Calc {
  const c = calcDiff(opts.title ?? 'Natija', money('Daromad', income, opts.incomeSource), money('Xarajat', expense, opts.expenseSource), { formulaId: 'result', note: opts.note });
  const v = Number(income) - Number(expense);
  return { ...c, result: `${c.result} — ${v >= 0 ? 'foyda' : 'zarar'}` };
}

/** Qismlar yig'indisi */
export function calcSum(title: string, parts: Quantity[], opts: { note?: string; kind?: Quantity['kind'] } = {}): Calc {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const out: Quantity = { label: title, value: total, kind: opts.kind ?? parts[0]?.kind ?? 'money' };
  const shown = parts.length > 12 ? [...parts.slice(0, 10)] : parts;
  const rest = parts.length > 12 ? parts.slice(10).reduce((s, p) => s + p.value, 0) : 0;
  const terms = shown.map((p) => qText(p));
  if (parts.length > 12) terms.push(`${qText({ ...out, value: rest })} (yana ${parts.length - 10} ta)`);
  return {
    title,
    formula: `${title} = ${parts.length <= 4 ? parts.map((p) => p.label).join(' + ') : `${parts.length} ta qism yig'indisi`}`,
    inputs: parts.length > 12 ? [...shown, { label: `Qolgan ${parts.length - 10} ta`, value: rest, kind: out.kind }] : parts,
    steps: parts.length ? [`= ${terms.join(' + ')}`, `= ${qFull(out)}`] : ['Qism yo\'q', `= ${qFull(out)}`],
    result: qFull(out),
    note: opts.note,
    formulaId: 'sum',
  };
}

/** O'zgarish foizi: (Joriy − Oldingi) ÷ |Oldingi| × 100 */
export function calcChange(title: string, current: Quantity, previous: Quantity, opts: { note?: string; growthGood?: boolean } = {}): Calc {
  const diff = current.value - previous.value;
  const diffQ: Quantity = { label: 'Farq', value: diff, kind: current.kind };
  const formula = `${title} = (${current.label} − ${previous.label}) ÷ |${previous.label}| × 100`;
  if (previous.value === 0) {
    return {
      title,
      formula,
      inputs: [current, previous],
      steps: [`Farq = ${qText(current)} − ${qText(previous)} = ${qFull(diffQ)}`, `${previous.label} = 0 — nolga bo'lib bo'lmaydi`],
      result: current.value === 0 ? "O'zgarish yo'q" : 'Yangi (oldingi davrda yo\'q edi)',
      note: opts.note,
      formulaId: 'change',
    };
  }
  const value = (diff / Math.abs(previous.value)) * 100;
  const verdict =
    opts.growthGood === undefined || Math.abs(value) < 0.05 ? '' : (value > 0) === opts.growthGood ? ' — yaxshi tomonga' : ' — yomon tomonga';
  return {
    title,
    formula,
    inputs: [current, previous],
    steps: [
      `Farq = ${qText(current)} − ${qText(previous)} = ${qFull(diffQ)}`,
      `= ${qText(diffQ)} ÷ ${qText({ ...previous, value: Math.abs(previous.value) })} × 100`,
      `= ${decimalText(diff / Math.abs(previous.value), 4)} × 100`,
      `= ${pctText(value, 1, true)}`,
    ],
    result: `${pctText(value, 1, true)}${verdict}`,
    note: opts.note,
    formulaId: 'change',
  };
}

/** Ulush: Qism ÷ Jami × 100 */
export function calcShare(title: string, part: Quantity, total: Quantity, opts: { note?: string } = {}): Calc {
  const formula = `${title} = ${part.label} ÷ ${total.label} × 100`;
  if (total.value === 0) {
    return { title, formula, inputs: [part, total], steps: [`${total.label} = 0 — ulush hisoblanmaydi`], result: '—', note: opts.note, formulaId: 'share' };
  }
  const value = (part.value / total.value) * 100;
  return {
    title,
    formula,
    inputs: [part, total],
    steps: [`= ${qText(part)} ÷ ${qText(total)} × 100`, `= ${decimalText(part.value / total.value, 4)} × 100`, `= ${pctText(value)}`],
    result: pctText(value),
    note: opts.note,
    formulaId: 'share',
  };
}

/**
 * Bo'lish: A ÷ B. unit — natija birligi:
 *  'money' (so'm, masalan bir xodimga), 'pct' (×100, masalan rentabellik), 'ratio' (barobar)
 */
export function calcDivide(
  title: string,
  a: Quantity,
  b: Quantity,
  unit: 'money' | 'pct' | 'ratio',
  opts: { note?: string; formulaId?: FormulaId } = {},
): Calc {
  const times100 = unit === 'pct';
  const formula = `${title} = ${a.label} ÷ ${b.label}${times100 ? ' × 100' : ''}`;
  if (b.value === 0) {
    return { title, formula, inputs: [a, b], steps: [`${b.label} = 0 — bo'lib bo'lmaydi`], result: '—', note: opts.note, formulaId: opts.formulaId ?? 'ratio' };
  }
  const raw = a.value / b.value;
  const steps = [`= ${qText(a)} ÷ ${qText(b)}${times100 ? ' × 100' : ''}`];
  let result: string;
  if (unit === 'pct') {
    steps.push(`= ${decimalText(raw, 4)} × 100`);
    result = pctText(raw * 100);
  } else if (unit === 'money') {
    // a — tiyinda, b — son: natija ham tiyinda
    result = moneyText(raw);
  } else {
    result = `${decimalText(raw, 2)} barobar`;
  }
  steps.push(`= ${result}`);
  return { title, formula, inputs: [a, b], steps, result, note: opts.note, formulaId: opts.formulaId ?? (unit === 'pct' ? 'share' : 'ratio') };
}

/** Rentabellik = (Daromad − Xarajat) ÷ Daromad × 100 */
export function calcMargin(income: number | string, expense: number | string, opts: { note?: string } = {}): Calc {
  const inc = Number(income);
  const exp = Number(expense);
  const profit = inc - exp;
  const formula = 'Rentabellik = (Daromad − Xarajat) ÷ Daromad × 100';
  const inputs = [money('Daromad', inc), money('Xarajat', exp)];
  if (inc <= 0) {
    return { title: 'Rentabellik', formula, inputs, steps: ["Daromad 0 — rentabellik hisoblanmaydi"], result: '—', note: opts.note, formulaId: 'margin' };
  }
  const value = (profit / inc) * 100;
  return {
    title: 'Rentabellik',
    formula,
    inputs,
    steps: [
      `Natija = ${moneyText(inc, false)} − ${moneyText(exp, false)} = ${moneyText(profit)}`,
      `= ${moneyText(profit, false)} ÷ ${moneyText(inc, false)} × 100`,
      `= ${decimalText(profit / inc, 4)} × 100`,
      `= ${pctText(value)}`,
    ],
    result: pctText(value),
    note: opts.note,
    formulaId: 'margin',
  };
}

/** Reja bajarilishi = Fakt ÷ Reja × 100 */
export function calcCompletion(plan: number | string, fact: number | string, opts: { note?: string } = {}): Calc {
  const c = calcDivide('Bajarilish', money('Fakt', fact, 'Natijalar fayli'), money('Reja', plan, 'Natijalar fayli'), 'pct', { formulaId: 'completion', note: opts.note });
  const p = Number(plan);
  if (p <= 0) return c;
  const v = (Number(fact) / p) * 100;
  return { ...c, result: `${c.result} — ${v >= 100 ? 'reja bajarilgan' : `rejadan ${pctText(100 - v)} kam`}` };
}

/** Bir nechta qiymat o'rtachasi */
export function calcMean(title: string, values: Quantity[], opts: { note?: string } = {}): Calc {
  const total = values.reduce((s, v) => s + v.value, 0);
  const n = values.length;
  const kind = values[0]?.kind ?? 'money';
  const avg = n ? total / n : 0;
  return {
    title,
    formula: `${title} = (${n} ta qiymat yig'indisi) ÷ ${n}`,
    inputs: values,
    steps: n
      ? [`Yig'indi = ${values.map((v) => qText(v)).join(' + ')} = ${qFull({ label: '', value: total, kind })}`, `= ${qText({ label: '', value: total, kind })} ÷ ${n}`, `= ${qFull({ label: '', value: avg, kind })}`]
      : ["Qiymat yo'q"],
    result: qFull({ label: '', value: avg, kind }),
    note: opts.note,
    formulaId: 'mean',
  };
}

/** Foiz punkti farqi: A% − B% */
export function calcPp(title: string, a: Quantity, b: Quantity, opts: { note?: string } = {}): Calc {
  const v = a.value - b.value;
  return {
    title,
    formula: `${title} = ${a.label} − ${b.label}`,
    inputs: [{ ...a, kind: 'pct' }, { ...b, kind: 'pct' }],
    steps: [`= ${pctText(a.value)} − ${pctText(b.value)}`, `= ${v >= 0 ? '+' : MINUS}${decimalText(Math.abs(v), 1)} p.p.`],
    result: `${v >= 0 ? '+' : MINUS}${decimalText(Math.abs(v), 1)} foiz punkti`,
    note: opts.note,
    formulaId: 'diffPp',
  };
}

/** Davrdagi yozuvlar jami: bazadagi yozuvlar summasi (ro'yxat bilan bir xil filtr) */
export function calcRecords(title: string, tiyin: number | string, count: number | undefined, period: string, source: string, opts: { note?: string } = {}): Calc {
  const total: Quantity = { label: title, value: Number(tiyin), kind: 'money', source };
  return {
    title,
    formula: `${title} = davrdagi barcha yozuvlar summalari yig'indisi`,
    inputs: [
      ...(count !== undefined ? [{ label: 'Yozuvlar soni', value: count, kind: 'count' as const, source }] : []),
      total,
    ],
    steps: [`Davr: ${period}`, `${count !== undefined ? `${group(count)} ta yozuv` : 'Yozuvlar'} qo'shiladi`, `= ${qFull(total)}`],
    result: qFull(total),
    note: opts.note ?? "Har bir yozuvni ro'yxat sahifasida (shu davr filtri bilan) ko'rish mumkin; ro'yxat pastidagi jami shu songa teng.",
    formulaId: 'sum',
  };
}

/** Matn ko'rinishi (CSV, nusxa olish uchun) */
export function calcToLines(calc: Calc): string[] {
  return [
    `${calc.title}`,
    `Formula: ${calc.formula}`,
    ...calc.inputs.map((q) => `  ${q.label}: ${qFull(q)}${q.source ? ` (${q.source})` : ''}`),
    ...calc.steps.map((s, i) => `  ${i + 1}) ${s}`),
    `Javob: ${calc.result}`,
    ...(calc.note ? [`Izoh: ${calc.note}`] : []),
  ];
}