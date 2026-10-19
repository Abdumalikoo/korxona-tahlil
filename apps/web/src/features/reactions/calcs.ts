import { decimalText, moneyText, pctText, Q, type Calc } from '@/lib/calc';
import type { ItemEvaluation } from './api';

// ═══════════════════════════════════════════════════════════
// Munosabat baholashi — backend (reactions.service.evaluateItem) bilan aynan bir xil formulalar:
//   Kunlik sur'at   = Davr summasi ÷ Kunlar soni
//   Kutilgan        = Avvalgi kunlik sur'at × Kuzatuv kunlari
//   Ta'sir          = Haqiqiy − Kutilgan
//   O'zgarish, %    = (Hozirgi sur'at − Avvalgi sur'at) ÷ |Avvalgi sur'at| × 100
//   Holat           = |o'zgarish| < 3% → o'zgarishsiz; aks holda yo'nalishiga qarab
// ═══════════════════════════════════════════════════════════

/** «Yaxshi/yomon» chegarasi — backend SAME_THRESHOLD bilan bir xil */
export const SAME_THRESHOLD = 3;

const KIND_WORD: Record<ItemEvaluation['kind'], string> = { INCOME: 'daromad', EXPENSE: 'xarajat', RESULT: 'natija' };

function uz(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Kunlik sur'at: Davr summasi ÷ Kunlar soni */
export function perDayCalc(item: ItemEvaluation, which: 'base' | 'track'): Calc {
  const w = item[which];
  const title = which === 'base' ? "Avvalgi kunlik sur'at" : "Hozirgi kunlik sur'at";
  const period = `${uz(w.from)} — ${uz(w.to)}`;
  const sum = Number(w.sumTiyin);
  const formula = `${title} = ${which === 'base' ? 'Baza' : 'Kuzatuv'} davri summasi ÷ Kunlar soni`;
  const inputs = [
    Q.money(`${which === 'base' ? 'Baza' : 'Kuzatuv'} davri summasi (${period})`, sum, `«${item.label}» bo'yicha yozuvlar`),
    Q.count('Kunlar soni', w.days),
  ];
  if (w.days === 0) {
    return { title, formula, inputs, steps: ["Kuzatuv hali boshlanmagan — kunlar soni 0"], result: '—', formulaId: 'average' };
  }
  return {
    title,
    formula,
    inputs,
    steps: [`= ${moneyText(sum, false)} ÷ ${w.days}`, `= ${moneyText(sum / w.days)}`],
    result: `${moneyText(Number(w.perDayTiyin))} kuniga`,
    note: which === 'base' ? "Baza — belgilashdan oldingi, kuzatuv muddatiga teng davr." : undefined,
    formulaId: 'average',
  };
}

/** Kutilgan = Avvalgi kunlik sur'at × Kuzatuv kunlari */
export function expectedCalc(item: ItemEvaluation): Calc {
  const basePerDay = Number(item.base.sumTiyin) / Math.max(item.base.days, 1);
  const days = item.track.days;
  return {
    title: 'Kutilgan summa',
    formula: "Kutilgan = Avvalgi kunlik sur'at × Kuzatuv kunlari",
    inputs: [
      Q.money("Avvalgi kunlik sur'at", basePerDay, `${moneyText(Number(item.base.sumTiyin))} ÷ ${item.base.days} kun`),
      Q.count('Kuzatuv kunlari', days),
    ],
    steps: [`= ${moneyText(basePerDay, false)} × ${days}`, `= ${moneyText(Number(item.expectedTiyin))}`],
    result: moneyText(Number(item.expectedTiyin)),
    note: "Hech narsa o'zgarmaganda shuncha bo'lar edi.",
    formulaId: 'ratio',
  };
}

/** Haqiqiy summa — kuzatuv davridagi yozuvlar */
export function actualCalc(item: ItemEvaluation): Calc {
  return {
    title: 'Haqiqiy summa',
    formula: "Haqiqiy = kuzatuv davridagi yozuvlar yig'indisi",
    inputs: [Q.money(`Kuzatuv davri (${uz(item.track.from)} — ${uz(item.track.to)})`, Number(item.track.sumTiyin), `«${item.label}» bo'yicha yozuvlar`)],
    steps: [`Kuzatuv kunlari: ${item.track.days}`, `= ${moneyText(Number(item.track.sumTiyin))}`],
    result: moneyText(Number(item.track.sumTiyin)),
    note: "Eng katta yozuvlarni qatorni ochib ko'rish mumkin.",
    formulaId: 'sum',
  };
}

/** Ta'sir = Haqiqiy − Kutilgan */
export function effectCalc(item: ItemEvaluation): Calc {
  const actual = Number(item.track.sumTiyin);
  const expected = Number(item.expectedTiyin);
  const effect = Number(item.effectTiyin);
  const good = item.kind === 'EXPENSE' ? effect < 0 : effect > 0;
  const meaning =
    effect === 0
      ? "ta'sir yo'q"
      : item.kind === 'EXPENSE'
        ? good
          ? `${moneyText(-effect)} tejaldi`
          : `${moneyText(effect)} ortiq sarflandi`
        : good
          ? `${moneyText(effect)} ko'p ${KIND_WORD[item.kind]}`
          : `${moneyText(-effect)} kam ${KIND_WORD[item.kind]}`;
  return {
    title: "Ta'sir",
    formula: "Ta'sir = Haqiqiy − Kutilgan",
    inputs: [Q.money('Haqiqiy', actual), Q.money('Kutilgan', expected)],
    steps: [`= ${moneyText(actual, false)} − ${moneyText(expected, false)}`, `= ${moneyText(effect)}`],
    result: `${moneyText(effect)} — ${meaning}`,
    note: item.kind === 'EXPENSE' ? "Xarajatda manfiy ta'sir — yaxshi (tejalgan)." : "Daromad va natijada musbat ta'sir — yaxshi.",
    formulaId: 'delta',
  };
}

/** O'zgarish, % — kunlik sur'atlar bo'yicha */
export function changeCalc(item: ItemEvaluation): Calc {
  const base = Number(item.base.sumTiyin) / Math.max(item.base.days, 1);
  const track = item.track.days > 0 ? Number(item.track.sumTiyin) / item.track.days : 0;
  const formula = "O'zgarish = (Hozirgi sur'at − Avvalgi sur'at) ÷ |Avvalgi sur'at| × 100";
  const inputs = [Q.money("Hozirgi kunlik sur'at", track), Q.money("Avvalgi kunlik sur'at", base)];
  if (item.track.days === 0) {
    return { title: "O'zgarish", formula, inputs, steps: ['Kuzatuv hali boshlanmagan'], result: '—', formulaId: 'change' };
  }
  if (base === 0) {
    return { title: "O'zgarish", formula, inputs, steps: ["Avvalgi sur'at 0 — foiz hisoblanmaydi"], result: track === 0 ? "O'zgarish yo'q" : 'Yangi', formulaId: 'change' };
  }
  const value = ((track - base) / Math.abs(base)) * 100;
  return {
    title: "O'zgarish",
    formula,
    inputs,
    steps: [
      `Farq = ${moneyText(track, false)} − ${moneyText(base, false)} = ${moneyText(track - base)}`,
      `= ${moneyText(track - base, false)} ÷ ${moneyText(Math.abs(base), false)} × 100`,
      `= ${decimalText((track - base) / Math.abs(base), 4)} × 100`,
      `= ${pctText(value, 1, true)}`,
    ],
    result: pctText(item.changePercent ?? value, 1, true),
    note: "Kunlik sur'at solishtiriladi — davrlar uzunligi har xil bo'lsa ham to'g'ri chiqadi.",
    formulaId: 'change',
  };
}

/** Holat (yaxshilandi / yomonlashdi / o'zgarishsiz) qanday aniqlangani */
export function verdictCalc(item: ItemEvaluation): Calc {
  const ch = item.changePercent;
  const word = KIND_WORD[item.kind];
  const rule =
    item.kind === 'EXPENSE'
      ? `Xarajatda: kamaysa — yaxshilandi, oshsa — yomonlashdi`
      : `${word[0]!.toUpperCase() + word.slice(1)}da: oshsa — yaxshilandi, kamaysa — yomonlashdi`;
  const steps: string[] = [];
  if (item.verdict === 'nodata') steps.push('Kuzatuv hali boshlanmagan');
  else if (ch === null) steps.push("Avvalgi sur'at 0 — yo'nalish bo'yicha baholandi");
  else {
    steps.push(`O'zgarish = ${pctText(ch, 1, true)}`);
    steps.push(Math.abs(ch) < SAME_THRESHOLD ? `|${pctText(ch)}| < ${SAME_THRESHOLD}% → o'zgarishsiz` : `|${pctText(ch)}| ≥ ${SAME_THRESHOLD}% → ${ch > 0 ? 'oshgan' : 'kamaygan'}`);
    steps.push(rule);
  }
  return {
    title: 'Holat',
    formula: `|O'zgarish| < ${SAME_THRESHOLD}% bo'lsa — o'zgarishsiz; aks holda yo'nalishiga qarab yaxshilandi yoki yomonlashdi`,
    inputs: ch === null ? [] : [{ label: "O'zgarish", value: ch, kind: 'pct' }],
    steps,
    result: item.verdictText,
  };
}

/** Umumiy ta'sir = Σ (xarajatda −ta'sir, daromad/natijada +ta'sir) */
export function gainCalc(items: ItemEvaluation[], gainTiyin: number): Calc {
  const parts = items.map((i) => {
    const e = Number(i.effectTiyin);
    const v = i.kind === 'EXPENSE' ? -e : e;
    return { label: `${i.label}${i.kind === 'EXPENSE' ? ' (xarajat: −ta\'sir)' : ''}`, value: v, kind: 'money' as const };
  });
  return {
    title: "Umumiy ta'sir",
    formula: "Umumiy ta'sir = Σ tejalgan xarajat + Σ qo'shimcha daromad/natija",
    inputs: parts,
    steps: [
      "Xarajat moddalarida ta'sir teskari ishora bilan olinadi (tejalgan — musbat)",
      `= ${parts.map((p) => (p.value < 0 ? `(${moneyText(p.value, false)})` : moneyText(p.value, false))).join(' + ') || '0'}`,
      `= ${moneyText(gainTiyin)}`,
    ],
    result: moneyText(gainTiyin),
    formulaId: 'sum',
  };
}

/** Yaxshilangan / yomonlashgan / o'zgarishsiz moddalar soni */
export function countCalc(items: ItemEvaluation[], verdict: 'better' | 'worse'): Calc {
  const list = items.filter((i) => i.verdict === verdict);
  return {
    title: verdict === 'better' ? 'Yaxshilangan moddalar' : 'Yomonlashgan moddalar',
    formula: `Har modda holati: |o'zgarish| ≥ ${SAME_THRESHOLD}% va ${verdict === 'better' ? 'yaxshi' : 'yomon'} tomonga`,
    inputs: items.filter((i) => i.changePercent !== null).map((i) => ({ label: i.label, value: i.changePercent!, kind: 'pct' as const })),
    steps: [list.length ? list.map((i) => `${i.label}: ${pctText(i.changePercent ?? 0, 1, true)}`).join('; ') : "Bunday modda yo'q", `= ${list.length} ta`],
    result: `${list.length} ta`,
  };
}

// ═══════════════════════════════════════════════════════════
// Nazorat — backend (controls.service) bilan bir xil:
//   Oy oxirigacha taxmin = Shu kungacha summa ÷ O'tgan kunlar × Oydagi kunlar
//   Foydalanish, %       = Oy summasi (yoki taxmin) ÷ Chegara × 100
//   Farq                 = Oy summasi − Chegara
// ═══════════════════════════════════════════════════════════

type ControlLike = {
  kind: ItemEvaluation['kind'];
  label: string;
  limitTiyin: string;
  startPeriod: string;
  isActive: boolean;
  status: 'ok' | 'risk' | 'breach' | 'nodata';
  statusText: string;
  breaches: number;
  checkedMonths: number;
  usagePercent: number | null;
  current: { period: string; valueTiyin: string; projectedTiyin: string | null; partial: boolean } | null;
  months: { period: string; valueTiyin: string; projectedTiyin: string | null; breached: boolean; partial: boolean }[];
};

function monthName(period: string): string {
  const [y, m] = period.split('-');
  return `${m}.${y}`;
}

/** Joriy oy taxmini: summa ÷ o'tgan kunlar × oydagi kunlar */
export function projectionCalc(month: { period: string; valueTiyin: string; projectedTiyin: string | null }): Calc | null {
  if (!month.projectedTiyin) return null;
  const [y, m] = month.period.split('-').map(Number);
  const monthDays = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  // Toshkent vaqti bo'yicha bugungi kun
  const day = Number(new Date(Date.now() + 5 * 3600_000).toISOString().slice(8, 10));
  const value = Number(month.valueTiyin);
  return {
    title: 'Oy oxirigacha taxmin',
    formula: "Taxmin = Shu kungacha summa ÷ O'tgan kunlar × Oydagi kunlar",
    inputs: [Q.money(`Shu kungacha summa (${monthName(month.period)})`, value), Q.count("O'tgan kunlar", day), Q.count('Oydagi kunlar', monthDays)],
    steps: [`= ${moneyText(value, false)} ÷ ${day} × ${monthDays}`, `= ${moneyText(value / Math.max(day, 1), false)} × ${monthDays}`, `= ${moneyText(Number(month.projectedTiyin))}`],
    result: moneyText(Number(month.projectedTiyin)),
    note: "Oy hali tugamagan — joriy sur'at saqlansa oy oxirida shuncha bo'ladi.",
    formulaId: 'ratio',
  };
}

/** Chegaradan foydalanish, % */
export function usageCalc(c: ControlLike): Calc | null {
  if (!c.current || c.usagePercent === null) return null;
  const value = Number(c.current.projectedTiyin ?? c.current.valueTiyin);
  const limit = Number(c.limitTiyin);
  const isMax = c.kind === 'EXPENSE';
  return {
    title: 'Chegaradan foydalanish',
    formula: `Foydalanish = ${c.current.projectedTiyin ? 'Oy oxirigacha taxmin' : 'Oy summasi'} ÷ Chegara × 100`,
    inputs: [Q.money(c.current.projectedTiyin ? 'Oy oxirigacha taxmin' : 'Oy summasi', value), Q.money(isMax ? 'Chegara (eng ko\'pi)' : 'Reja (kamida)', limit)],
    steps: [`= ${moneyText(value, false)} ÷ ${moneyText(limit, false)} × 100`, `= ${decimalText(value / limit, 4)} × 100`, `= ${pctText(c.usagePercent)}`],
    result: `${pctText(c.usagePercent)} — ${isMax ? (c.usagePercent > 100 ? 'chegaradan oshadi' : 'chegara ichida') : c.usagePercent < 100 ? 'rejadan kam' : 'reja bajariladi'}`,
    note: isMax ? '100% dan oshsa — chegara buzilgan (xarajat).' : "100% dan kam bo'lsa — reja bajarilmagan (daromad/natija).",
    formulaId: 'share',
  };
}

/** Oy farqi: summa − chegara */
export function limitDiffCalc(c: ControlLike, month: { period: string; valueTiyin: string; projectedTiyin: string | null; partial: boolean }): Calc {
  const v = Number(month.projectedTiyin ?? month.valueTiyin);
  const limit = Number(c.limitTiyin);
  const diff = v - limit;
  const isMax = c.kind === 'EXPENSE';
  const bad = isMax ? diff > 0 : diff < 0;
  return {
    title: `${monthName(month.period)}: chegaradan farq`,
    formula: 'Farq = Oy summasi − Chegara',
    inputs: [Q.money(month.partial ? 'Oy oxirigacha taxmin' : 'Oy summasi', v), Q.money('Chegara', limit)],
    steps: [`= ${moneyText(v, false)} − ${moneyText(limit, false)}`, `= ${moneyText(diff)}`],
    result: `${moneyText(diff)} — ${bad ? (month.partial ? 'xavf' : 'buzildi') : "me'yorda"}`,
    note: isMax ? "Xarajatda musbat farq — chegara buzilgani." : "Daromad/natijada manfiy farq — reja bajarilmagani.",
    formulaId: 'delta',
  };
}

/** Buzilgan oylar soni */
export function breachesCalc(c: ControlLike): Calc {
  const checked = c.months.filter((m) => m.period >= c.startPeriod && !m.partial);
  const isMax = c.kind === 'EXPENSE';
  return {
    title: 'Buzilgan oylar',
    formula: `Tekshirilgan oy (nazorat boshlangandan, tugagan oylar) buzilgan, agar summa ${isMax ? '> chegara' : '< reja'}`,
    inputs: checked.map((m) => Q.money(monthName(m.period), m.valueTiyin)),
    steps: [
      `Chegara: ${moneyText(Number(c.limitTiyin))}`,
      `Buzilgan: ${checked.filter((m) => m.breached).map((m) => monthName(m.period)).join(', ') || "yo'q"}`,
      `= ${c.breaches} / ${c.checkedMonths}`,
    ],
    result: `${c.breaches} / ${c.checkedMonths} oy`,
  };
}

/** Holat qanday aniqlangani */
export function controlStatusCalc(c: ControlLike): Calc {
  const isMax = c.kind === 'EXPENSE';
  return {
    title: 'Nazorat holati',
    formula: "1) Nazorat to'xtatilgan → to'xtatilgan; 2) oxirgi tugagan oy buzilgan → «Chegara buzildi»; 3) joriy oy taxmini chegarani buzadi yoki prognozda keyingi oy buzilish ehtimoli ≥ 65% → «Xavf ostida»; 4) aks holda «Me'yorda»",
    inputs: [
      Q.money(isMax ? 'Chegara' : 'Reja', c.limitTiyin),
      ...(c.current ? [Q.money(c.current.projectedTiyin ? 'Joriy oy taxmini' : 'Joriy oy', c.current.projectedTiyin ?? c.current.valueTiyin)] : []),
    ],
    steps: [c.statusText],
    result: { ok: "Me'yorda", risk: 'Xavf ostida', breach: 'Chegara buzildi', nodata: "To'xtatilgan" }[c.status],
  };
}