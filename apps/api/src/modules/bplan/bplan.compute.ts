import {
  ADM,
  CENTER_REV,
  COST,
  factQ,
  FIN_IN,
  FIN_OUT,
  GROUPS,
  gv,
  HOM,
  OPX,
  PAY,
  per,
  REG_COLS,
  REGIONS,
  S,
  TAX,
  UO_REG,
  type ExecRow,
  type Facts,
  type Grid,
  type Mode,
} from './bplan.model';

// ═══════════════════════════════════════════════════════════
// Ekrandagi ijro hisoboti — formulali Excel'dagi «Ижро …» varaqlari bilan aynan bir xil hisob.
// ═══════════════════════════════════════════════════════════

export interface RegionRow {
  name: string;
  prior: number;
  annual: number;
  plan: number;
  fact: number;
  /** гуруҳлар бўйича бажарилиш (null — режа йўқ) */
  groups: (number | null)[];
}

export interface KpiRow {
  name: string;
  weight: string;
  unit: string;
  /** 4 йиғма давр: мақсад ва факт (null — ҳали йўқ ёки ҳисобланмайди) */
  periods: { target: number | null; fact: number | null }[];
}

export interface Execution {
  quarter: number;
  mode: Mode;
  periodLabel: string;
  f2: ExecRow[];
  detail: ExecRow[];
  services: ExecRow[];
  regions: RegionRow[];
  regionTotal: RegionRow;
  taxes: ExecRow[];
  payroll: ExecRow[];
  headcount: ExecRow[];
  profit: ExecRow[];
  sponsorship: ExecRow[];
  kpi: KpiRow[];
  summary: { revenuePlan: number; revenueFact: number; profitPlan: number; profitFact: number; costPlan: number; costFact: number };
}

export function periodLabel(year: number, quarter: number, mode: Mode): string {
  if (mode === 'quarter') return `${quarter}-чорак ${year}`;
  return `${['1-чорак', '1-ярим йил', '9 ой', 'Йил'][quarter - 1]} ${year}`;
}

export function execute(g: Grid, f: Facts, year: number, quarter: number, mode: Mode): Execution {
  const P = (sheet: string, cols: string, row: number) => per(cols.split('').map((c) => gv(g, sheet, `${c}${row}`)), quarter, mode);
  const FQ = (key: string) => per(factQ(f, key), quarter, mode);
  const row = (code: string, name: string, level: 0 | 1 | 2, sign: 1 | -1, prior: number | null, annual: number | null, plan: number | null, fact: number | null): ExecRow => ({
    code,
    name,
    level,
    sign,
    prior,
    annual,
    plan,
    fact,
  });

  // ── Расшифровка (2-илова) ──
  const rs = (r: number) => ({ prior: gv(g, S.R, `D${r}`), annual: gv(g, S.R, `E${r}`), plan: P(S.R, 'FGHI', r) });
  const sum = (keys: string[]) => keys.reduce((s, k) => s + FQ(k), 0);
  const centerRev = sum(CENTER_REV.map(([r]) => `R${r}`));
  const regRev = sum(UO_REG.map(([, r]) => `U${r}`));
  const rev = centerRev + regRev;
  const other = FQ('R20');
  const cost = sum(COST.map(([r]) => `R${r}`));
  const adm = sum(ADM.map(([r]) => `R${r}`));
  const opx = sum(OPX.map(([r]) => `R${r}`));
  const finIn = sum(FIN_IN);
  const finOut = sum(FIN_OUT);
  const npDetail = rev + other + finIn - cost - (adm + opx) - finOut;
  const detail: ExecRow[] = [];
  const d = (r: number, name: string, level: 0 | 1 | 2, sign: 1 | -1, fact: number) => {
    const x = rs(r);
    detail.push(row(String(r), name, level, sign, x.prior, x.annual, x.plan, fact));
  };
  d(8, 'Маҳсулот (иш, хизмат) сотишдан соф тушум', 0, 1, rev);
  for (const [r, n] of CENTER_REV) d(r, n, 1, 1, FQ(`R${r}`));
  d(18, 'Ҳудудий бўлинмалар хизматлари', 1, 1, regRev);
  d(19, 'Асосий фаолиятнинг бошқа даромадлари', 0, 1, other);
  d(21, 'Таннарх', 0, -1, cost);
  for (const [r, n] of COST) d(r, n, 1, -1, FQ(`R${r}`));
  d(29, 'Давр харажатлари', 0, -1, adm + opx);
  d(30, 'Маъмурий харажатлар', 1, -1, adm);
  for (const [r, n] of ADM) d(r, n, 2, -1, FQ(`R${r}`));
  d(40, 'Бошқа операцион харажатлар', 1, -1, opx);
  for (const [r, n] of OPX) d(r, n, 2, -1, FQ(`R${r}`));
  d(49, 'Молиявий фаолият даромадлари', 0, 1, finIn);
  d(51, 'Молиявий фаолият харажатлари', 0, -1, finOut);
  d(52, 'Соф фойда', 0, 1, npDetail);

  // ── Ф-2 ──
  const fq = (k: string) => FQ(k);
  const f2val: Record<number, number> = {};
  f2val[10] = rev;
  f2val[20] = cost;
  f2val[30] = rev - cost;
  f2val[50] = fq('F050');
  f2val[60] = adm;
  f2val[70] = opx;
  f2val[40] = f2val[50] + adm + opx;
  f2val[90] = other;
  f2val[100] = f2val[30] - f2val[40] + other;
  for (const k of [120, 130, 140, 150, 160, 180, 190, 200, 210, 230, 250, 260]) f2val[k] = fq(`F${k}`);
  f2val[110] = f2val[120]! + f2val[130]! + f2val[140]! + f2val[150]! + f2val[160]!;
  f2val[170] = f2val[180]! + f2val[190]! + f2val[200]! + f2val[210]!;
  f2val[220] = f2val[100] + f2val[110] - f2val[170];
  f2val[240] = f2val[220] + f2val[230]!;
  f2val[270] = f2val[240] - f2val[250]! - f2val[260]!;
  const f2: ExecRow[] = [];
  for (let r = 5; r <= 30; r += 1) {
    const code = gv(g, S.F2, `B${r}`);
    if (!code) continue;
    const out = [20, 40, 50, 60, 70, 170, 180, 190, 200, 210, 250, 260].includes(code) ? -1 : 1;
    const level = [10, 30, 40, 100, 110, 170, 220, 240, 270].includes(code) ? 0 : 1;
    f2.push(row(String(code).padStart(3, '0'), F2_NAMES[code] ?? String(code), level, out as 1 | -1, gv(g, S.F2, `C${r}`), gv(g, S.F2, `D${r}`), P(S.F2, 'EFGH', r), f2val[code] ?? 0));
  }

  // ── Хизматлар (1-илова) ──
  const UO_CENTER: Record<number, string> = { 12: 'R10', 13: 'R11', 14: 'R12', 15: 'R15', 16: 'R13', 17: 'R14', 18: 'R17', 19: 'R16' };
  const uoName: Record<number, string> = {
    12: 'Солиқ хизмати органларига техник кўмаклашиш',
    13: 'Солиқ қўмитаси оргтехникаларига техник хизмат',
    14: 'Электрон ҳужжат айланиши ва виртуал касса',
    15: 'Узум банк',
    16: 'ЯТИАМ',
    17: 'E-pos терминали',
    18: 'Маркшейдерлик',
    19: 'Солиқ маслаҳати',
  };
  const uo = (r: number) => ({ prior: gv(g, S.UO, `C${r}`), annual: gv(g, S.UO, `D${r}`), plan: r === 19 ? P(S.R, 'FGHI', 16) : P(S.UO, 'GHIJ', r) });
  const services: ExecRow[] = [];
  const u = (r: number, code: string, name: string, level: 0 | 1 | 2, fact: number) => {
    const x = uo(r);
    services.push(row(code, name, level, 1, x.prior, x.annual, x.plan, fact));
  };
  u(8, '', 'Жами соф тушум (солиқларсиз)', 0, rev);
  u(10, '1.1', 'Марказий аппарат бўйича', 0, centerRev);
  for (let r = 12; r <= 19; r += 1) u(r, String(gv(g, S.UO, `A${r}`) || ''), uoName[r]!, 1, FQ(UO_CENTER[r]!));
  u(21, '2', 'Ҳудудий бўлинмалар бўйича', 0, regRev);
  for (const [c, r, n] of UO_REG) u(r, c, n, 1, FQ(`U${r}`));

  // ── Ҳудудлар (4-илова) ──
  const qn = mode === 'quarter' ? 1 : quarter;
  const regions: RegionRow[] = REGIONS.map((reg, i) => {
    const col = REG_COLS[i]!;
    const prior = GROUPS.reduce((s, gr) => s + gv(g, S.HU, `${col}${gr.prior}`), 0);
    const annual = GROUPS.reduce((s, gr) => s + gv(g, S.HU, `${col}${gr.plan}`), 0);
    const factOf = (gi: number) => per([0, 1, 2, 3].map((qi) => f.regions[qi]?.[i]?.[gi] ?? 0), quarter, mode);
    const fact = GROUPS.reduce((s, _, gi) => s + factOf(gi), 0);
    const groups = GROUPS.map((gr, gi) => {
      const p = (gv(g, S.HU, `${col}${gr.plan}`) / 4) * qn;
      return p ? factOf(gi) / p : null;
    });
    return { name: reg.name, prior, annual, plan: (annual / 4) * qn, fact, groups };
  });
  const regionTotal: RegionRow = {
    name: 'Жами ҳудудлар',
    prior: regions.reduce((s, r) => s + r.prior, 0),
    annual: regions.reduce((s, r) => s + r.annual, 0),
    plan: regions.reduce((s, r) => s + r.plan, 0),
    fact: regions.reduce((s, r) => s + r.fact, 0),
    groups: GROUPS.map((_, gi) => {
      let p = 0;
      let fa = 0;
      REGIONS.forEach((_, i) => {
        p += (gv(g, S.HU, `${REG_COLS[i]}${GROUPS[gi]!.plan}`) / 4) * qn;
        fa += per([0, 1, 2, 3].map((qi) => f.regions[qi]?.[i]?.[gi] ?? 0), quarter, mode);
      });
      return p ? fa / p : null;
    }),
  };

  // ── Солиқлар (5-илова) ──
  const taxes: ExecRow[] = [];
  let tp = 0;
  let ta = 0;
  let tpr = 0;
  let tf = 0;
  const taxRows = TAX.map(([r, n]) => {
    const annual = ['H', 'I', 'J', 'K'].reduce((s, c) => s + gv(g, S.SOL, `${c}${r}`), 0);
    const x = row(String(r - 7), n, 1, -1, gv(g, S.SOL, `D${r}`), annual, P(S.SOL, 'HIJK', r), FQ(`T${r}`));
    tp += x.plan ?? 0;
    ta += annual;
    tpr += x.prior ?? 0;
    tf += x.fact ?? 0;
    return x;
  });
  taxes.push(row('', 'Жами', 0, -1, tpr, ta, tp, tf), ...taxRows);

  // ── Иш ҳақи ──
  const payroll: ExecRow[] = PAY.map(([r, n]) => {
    const annual = gv(g, S.IH, `P${r}`);
    return row(String(r), n, 1, -1, gv(g, S.IH, `D${r}`), annual, (annual / 4) * qn, FQ(`P${r}`));
  });
  payroll.unshift(row('', 'Жами иш ҳақи фонди', 0, -1, gv(g, S.IH, 'D8'), gv(g, S.IH, 'P8'), (gv(g, S.IH, 'P8') / 4) * qn, payroll.reduce((s, x) => s + (x.fact ?? 0), 0)));
  const headcount: ExecRow[] = PAY.map(([r, n]) => {
    const vals = f.lines[`N${r}`] ?? [];
    const upto = mode === 'quarter' ? [vals[quarter - 1]] : vals.slice(0, quarter);
    const nums = upto.filter((v): v is number => typeof v === 'number');
    const fact = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    return row(String(r), n, 1, 1, gv(g, S.IH, `C${r}`), gv(g, S.IH, `O${r}`), gv(g, S.IH, `O${r}`), fact);
  });
  headcount.unshift(
    row(
      '',
      'Жами',
      0,
      1,
      headcount.reduce((s, x) => s + (x.prior ?? 0), 0),
      headcount.reduce((s, x) => s + (x.annual ?? 0), 0),
      headcount.reduce((s, x) => s + (x.plan ?? 0), 0),
      headcount.some((x) => x.fact !== null) ? headcount.reduce((s, x) => s + (x.fact ?? 0), 0) : null,
    ),
  );

  // ── Соф фойда тақсимоти (3-илова) ──
  const np = f2val[270]!;
  const e8 = gv(g, S.SF, 'E8');
  const share = (r: number) => (e8 ? gv(g, S.SF, `E${r}`) / e8 : 0);
  const sfr = (r: number, name: string, level: 0 | 1, fact: number, planRow = r) =>
    row(String(gv(g, S.SF, `A${r}`) || ''), name, level, 1, gv(g, S.SF, `C${r}`), gv(g, S.SF, `E${planRow}`), P(S.SF, 'GHIJ', planRow), fact);
  const profit: ExecRow[] = [
    sfr(8, 'Соф фойда', 0, np),
    sfr(9, 'Дивиденд учун жами', 0, Math.max(0, np) * share(10), 10),
    sfr(10, 'давлат улушига', 1, Math.max(0, np) * share(10)),
    sfr(11, 'Инновацион ривожлантириш фондига', 1, Math.max(0, np) * share(11)),
    sfr(12, 'Захира фондига', 1, Math.max(0, np) * share(12)),
    sfr(13, 'Корхонани ривожлантириш учун', 1, Math.max(0, np) * share(13)),
    sfr(14, 'Бошқа мақсадларга', 1, Math.max(0, np) * share(14)),
  ];

  // ── Ҳомийлик ──
  const hRows = HOM.map(([r, n]) => row(String(gv(g, S.H, `A${r}`) || ''), n, 1, -1, gv(g, S.H, `C${r}`), gv(g, S.H, `E${r}`), P(S.H, 'GHIJ', r), FQ(`H${r}`)));
  const sponsorship = [
    row('', 'Жами', 0, -1, gv(g, S.H, 'C7'), gv(g, S.H, 'E7'), P(S.H, 'GHIJ', 7), hRows.reduce((s, x) => s + (x.fact ?? 0), 0)),
    ...hRows,
  ];

  // ── КПЭ (йиғма) ──
  const qFact = (keys: string[], n: number) => keys.reduce((s, k) => s + factQ(f, k).slice(0, n).reduce((a, b) => a + b, 0), 0);
  const revKeys = [...CENTER_REV.map(([r]) => `R${r}`), ...UO_REG.map(([, r]) => `U${r}`)];
  const npUpTo = (n: number) =>
    qFact([...revKeys, 'R20', ...FIN_IN, 'F230'], n) - qFact([...COST, ...ADM, ...OPX].map(([r]) => `R${r}`), n) - qFact(['F050', ...FIN_OUT, 'F250', 'F260'], n);
  const bal = (key: string, n: number) => {
    const v = f.lines[key]?.[n - 1];
    return typeof v === 'number' ? v : null;
  };
  const target = (r: number, n: number) => {
    const v = gv(g, S.KPI, `${'DEFG'[n - 1]}${r}`);
    return Number.isFinite(v) ? v : null;
  };
  const kp = (r: number, name: string, unit: string, fact: (n: number) => number | null): KpiRow => ({
    name,
    weight: String(gv(g, S.KPI, `C${r}`) || '–'),
    unit,
    periods: [1, 2, 3, 4].map((n) => ({ target: target(r, n), fact: n <= quarter ? fact(n) : null })),
  });
  const kpi: KpiRow[] = [
    kp(8, 'Соф тушум', 'минг сўм', (n) => qFact(revKeys, n) * 1000),
    kp(9, 'Соф фойда (зарар)', 'минг сўм', (n) => npUpTo(n) * 1000),
    kp(10, 'Активлар рентабеллиги', 'улуш', (n) => {
      const a = bal('B_ACT', n);
      return a ? npUpTo(n) / a : null;
    }),
    kp(13, 'Қоплай олиш коэффициенти', 'коэф.', (n) => {
      const cl = bal('B_CL', n);
      const cur = bal('B_CUR', n);
      return cl && cur !== null ? cur / cl : null;
    }),
    kp(14, 'Молиявий мустақиллик коэффициенти', 'коэф.', (n) => {
      const l = bal('B_LIAB', n);
      const e = bal('B_EQ', n);
      return l && e !== null ? e / l : null;
    }),
    kp(15, 'Дивиденд ҳисобланиши', 'минг сўм', (n) => Math.max(0, npUpTo(n) * 1000) / 2),
  ];

  const f2plan = (code: number) => f2.find((x) => Number(x.code) === code)?.plan ?? 0;
  return {
    quarter,
    mode,
    periodLabel: periodLabel(year, quarter, mode),
    f2,
    detail,
    services,
    regions,
    regionTotal,
    taxes,
    payroll,
    headcount,
    profit,
    sponsorship,
    kpi,
    summary: {
      revenuePlan: f2plan(10),
      revenueFact: rev,
      profitPlan: f2plan(270),
      profitFact: np,
      costPlan: f2plan(20) + f2plan(40),
      costFact: cost + f2val[40]!,
    },
  };
}

const F2_NAMES: Record<number, string> = {
  10: 'Соф тушум',
  20: 'Сотилган маҳсулот (хизмат) таннархи',
  30: 'Ялпи фойда (зарар)',
  40: 'Давр харажатлари, жами',
  50: 'Сотиш харажатлари',
  60: 'Маъмурий харажатлар',
  70: 'Бошқа операцион харажатлар',
  90: 'Асосий фаолиятнинг бошқа даромадлари',
  100: 'Асосий фаолиятнинг фойдаси (зарари)',
  110: 'Молиявий фаолият даромадлари, жами',
  120: 'Дивидендлар',
  130: 'Фоизлар',
  140: 'Молиявий ижарадан',
  150: 'Валюта курси фарқидан даромад',
  160: 'Бошқа молиявий даромадлар',
  170: 'Молиявий фаолият харажатлари, жами',
  180: 'Фоиз харажатлари',
  190: 'Молиявий ижара фоизлари',
  200: 'Валюта курси фарқидан зарар',
  210: 'Бошқа молиявий харажатлар',
  220: 'Умумхўжалик фаолиятининг фойдаси',
  230: 'Фавқулодда фойда ва зарарлар',
  240: 'Фойда солиғигача фойда',
  250: 'Фойда солиғи',
  260: 'Бошқа солиқлар ва мажбурий тўловлар',
  270: 'Соф фойда (зарар)',
};