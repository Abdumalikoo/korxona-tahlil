import type { ItemEvaluation } from './reactions.types';

// ═══════════════════════════════════════════════════════════
// Munosabat baholashining ishlanishi — Excel va slaydlar uchun.
// Saytdagi «Qanday hisoblandi?» (web: features/reactions/calcs.ts) bilan aynan bir xil formulalar va qadamlar.
// Hisoblash: reactions.service.ts → evaluateItem.
// ═══════════════════════════════════════════════════════════

/** Holat chegarasi — reactions.service.ts SAME_THRESHOLD bilan bir xil */
const SAME_THRESHOLD = 3;

export interface Working {
  title: string;
  formula: string;
  steps: string[];
  result: string;
}

const NBSP = ' ';
const MINUS = '−';

function group(v: number): string {
  return Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Tiyin → to'liq so'm: "1 234 567 so'm" */
export function full(tiyin: number, unit = true): string {
  const v = Math.round(tiyin / 100);
  return `${v < 0 ? MINUS : ''}${group(v)}${unit ? `${NBSP}so'm` : ''}`;
}

function pct(v: number, sign = false): string {
  const s = sign && v > 0 ? '+' : v < 0 ? MINUS : '';
  return `${s}${Math.abs(v).toFixed(1).replace('.', ',')}%`;
}

function dec(v: number, d = 4): string {
  return `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(d).replace('.', ',')}`;
}

function uz(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const KIND_WORD = { INCOME: 'daromad', EXPENSE: 'xarajat', RESULT: 'natija' } as const;

/** Jadval ostidagi asosiy formulalar */
export const KEY_FORMULAS: string[] = [
  "Kunlik sur'at = Davr summasi ÷ Kunlar soni (baza — belgilashdan oldingi teng davr, kuzatuv — belgilangandan bugungacha)",
  "Kutilgan = Avvalgi kunlik sur'at × Kuzatuv kunlari (hech narsa o'zgarmaganda shuncha bo'lar edi)",
  "Ta'sir = Haqiqiy − Kutilgan (xarajatda manfiy — tejalgan, daromad/natijada musbat — qo'shimcha)",
  "O'zgarish, % = (Hozirgi sur'at − Avvalgi sur'at) ÷ |Avvalgi sur'at| × 100",
  `Holat: |o'zgarish| < ${SAME_THRESHOLD}% — o'zgarishsiz; aks holda yo'nalishiga qarab yaxshilandi yoki yomonlashdi`,
  "Umumiy ta'sir = Σ tejalgan xarajat + Σ qo'shimcha daromad/natija",
];

/** Bitta modda bo'yicha to'liq ishlanish */
export function itemWorkings(item: ItemEvaluation): Working[] {
  const out: Working[] = [];
  const baseSum = Number(item.base.sumTiyin);
  const trackSum = Number(item.track.sumTiyin);
  const baseDays = item.base.days;
  const trackDays = item.track.days;
  const basePerDay = baseDays > 0 ? baseSum / baseDays : 0;
  const trackPerDay = trackDays > 0 ? trackSum / trackDays : 0;
  const expected = Number(item.expectedTiyin);
  const effect = Number(item.effectTiyin);

  out.push({
    title: "Avvalgi kunlik sur'at",
    formula: "Baza summasi ÷ Baza kunlari",
    steps: [`Baza: ${uz(item.base.from)} — ${uz(item.base.to)}`, `= ${full(baseSum, false)} ÷ ${baseDays}`],
    result: `${full(basePerDay)} kuniga`,
  });
  if (trackDays === 0) {
    out.push({ title: 'Kuzatuv', formula: '—', steps: ['Kuzatuv hali boshlanmagan'], result: '—' });
    return out;
  }
  out.push({
    title: "Hozirgi kunlik sur'at",
    formula: 'Kuzatuv summasi ÷ Kuzatuv kunlari',
    steps: [`Kuzatuv: ${uz(item.track.from)} — ${uz(item.track.to)}`, `= ${full(trackSum, false)} ÷ ${trackDays}`],
    result: `${full(trackPerDay)} kuniga`,
  });
  out.push({
    title: 'Kutilgan',
    formula: "Avvalgi sur'at × Kuzatuv kunlari",
    steps: [`= ${full(basePerDay, false)} × ${trackDays}`],
    result: full(expected),
  });
  const meaning =
    effect === 0
      ? "ta'sir yo'q"
      : item.kind === 'EXPENSE'
        ? effect < 0
          ? 'tejaldi'
          : 'ortiq sarflandi'
        : effect > 0
          ? `ko'p ${KIND_WORD[item.kind]}`
          : `kam ${KIND_WORD[item.kind]}`;
  out.push({
    title: "Ta'sir",
    formula: 'Haqiqiy − Kutilgan',
    steps: [`= ${full(trackSum, false)} − ${full(expected, false)}`],
    result: `${full(effect)} (${meaning})`,
  });
  if (basePerDay === 0) {
    out.push({ title: "O'zgarish", formula: "(Hozirgi − Avvalgi) ÷ |Avvalgi| × 100", steps: ["Avvalgi sur'at 0 — foiz hisoblanmaydi"], result: trackPerDay === 0 ? "O'zgarish yo'q" : 'Yangi' });
  } else {
    const ch = ((trackPerDay - basePerDay) / Math.abs(basePerDay)) * 100;
    out.push({
      title: "O'zgarish",
      formula: "(Hozirgi sur'at − Avvalgi sur'at) ÷ |Avvalgi sur'at| × 100",
      steps: [
        `Farq = ${full(trackPerDay, false)} − ${full(basePerDay, false)} = ${full(trackPerDay - basePerDay)}`,
        `= ${full(trackPerDay - basePerDay, false)} ÷ ${full(Math.abs(basePerDay), false)} × 100 = ${dec((trackPerDay - basePerDay) / Math.abs(basePerDay))} × 100`,
      ],
      result: pct(ch, true),
    });
  }
  const c = item.changePercent;
  out.push({
    title: 'Holat',
    formula: `|o'zgarish| < ${SAME_THRESHOLD}% — o'zgarishsiz`,
    steps:
      c === null
        ? ["Avvalgi sur'at 0 — yo'nalish bo'yicha baholandi"]
        : [
            Math.abs(c) < SAME_THRESHOLD ? `|${pct(c)}| < ${SAME_THRESHOLD}%` : `|${pct(c)}| ≥ ${SAME_THRESHOLD}% → ${c > 0 ? 'oshgan' : 'kamaygan'}`,
            item.kind === 'EXPENSE' ? 'Xarajatda kamayish — yaxshi' : `${KIND_WORD[item.kind]}da oshish — yaxshi`,
          ],
    result: item.verdictText,
  });
  return out;
}

/** Umumiy ta'sir */
export function gainWorking(items: ItemEvaluation[], gainTiyin: number): Working {
  const parts = items.map((i) => (i.kind === 'EXPENSE' ? -Number(i.effectTiyin) : Number(i.effectTiyin)));
  return {
    title: "Umumiy ta'sir",
    formula: "Σ tejalgan xarajat (−ta'sir) + Σ qo'shimcha daromad/natija (+ta'sir)",
    steps: [`= ${parts.map((v) => (v < 0 ? `(${full(v, false)})` : full(v, false))).join(' + ') || '0'}`],
    result: full(gainTiyin),
  };
}

/** Bir qatorli matn: "Ta'sir: Haqiqiy − Kutilgan = 1 000 − 900 = 100 so'm" */
export function workingLine(w: Working): string {
  return `${w.title}: ${w.formula} ${w.steps.map((s) => (s.startsWith('=') ? s : `· ${s}`)).join(' ')} = ${w.result}`.replace(/= =/g, '=');
}