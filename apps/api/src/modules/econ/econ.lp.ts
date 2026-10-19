// ═══════════════════════════════════════════════════════════
// Kichik chiziqli dasturlash (LP) — ikki bosqichli simpleks usuli.
// DEA (ma'lumotlarni qamrab olish tahlili) uchun: o'nlab o'zgaruvchi, bir necha cheklov.
//
//   min c'x,   A_i x (≤ | ≥ | =) b_i,   x ≥ 0
// ═══════════════════════════════════════════════════════════

export type Relation = '<=' | '>=' | '=';

export interface LpConstraint {
  coefs: number[];
  rel: Relation;
  rhs: number;
}

export interface LpResult {
  status: 'optimal' | 'infeasible' | 'unbounded';
  x: number[];
  value: number;
}

const EPS = 1e-9;

export function solveLp(c: number[], constraints: LpConstraint[]): LpResult {
  const n = c.length;
  // O'ng tomon manfiy bo'lmasin
  const rows = constraints.map((k) => (k.rhs < 0 ? { coefs: k.coefs.map((v) => -v), rel: (k.rel === '<=' ? '>=' : k.rel === '>=' ? '<=' : '=') as Relation, rhs: -k.rhs } : k));
  const m = rows.length;

  // Ustunlar: x (n), qo'shimcha (slack/surplus), sun'iy (artificial)
  const slackCount = rows.filter((r) => r.rel !== '=').length;
  const artCount = rows.filter((r) => r.rel !== '<=').length;
  const width = n + slackCount + artCount;
  const T: number[][] = [];
  const basis: number[] = [];
  const artificial: number[] = [];
  let s = n;
  let a = n + slackCount;
  rows.forEach((r) => {
    const row = new Array<number>(width + 1).fill(0);
    r.coefs.forEach((v, j) => (row[j] = v));
    row[width] = r.rhs;
    if (r.rel === '<=') {
      row[s] = 1;
      basis.push(s);
      s += 1;
    } else if (r.rel === '>=') {
      row[s] = -1;
      s += 1;
      row[a] = 1;
      basis.push(a);
      artificial.push(a);
      a += 1;
    } else {
      row[a] = 1;
      basis.push(a);
      artificial.push(a);
      a += 1;
    }
    T.push(row);
  });

  const pivot = (pr: number, pc: number) => {
    const pv = T[pr]![pc]!;
    for (let j = 0; j <= width; j += 1) T[pr]![j]! /= pv;
    for (let i = 0; i < m; i += 1) {
      if (i === pr) continue;
      const f = T[i]![pc]!;
      if (Math.abs(f) < EPS) continue;
      for (let j = 0; j <= width; j += 1) T[i]![j]! -= f * T[pr]![j]!;
    }
    basis[pr] = pc;
  };

  /** Simpleks: berilgan maqsad (min) bo'yicha, ruxsat etilgan ustunlar ichida */
  const run = (cost: number[], allowed: (j: number) => boolean): 'optimal' | 'unbounded' => {
    for (let iter = 0; iter < 5000; iter += 1) {
      // Qisqartirilgan xarajatlar: c_j − c_B B⁻¹ A_j
      let enter = -1;
      for (let j = 0; j < width; j += 1) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = cost[j] ?? 0;
        for (let i = 0; i < m; i += 1) rc -= (cost[basis[i]!] ?? 0) * T[i]![j]!;
        if (rc < -EPS) {
          enter = j; // Bland qoidasi: birinchi mos ustun — aylanib qolmaydi
          break;
        }
      }
      if (enter < 0) return 'optimal';
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i += 1) {
        const v = T[i]![enter]!;
        if (v > EPS) {
          const ratio = T[i]![width]! / v;
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i]! < basis[leave]!)) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave < 0) return 'unbounded';
      pivot(leave, enter);
    }
    return 'optimal';
  };

  // 1-bosqich: sun'iy o'zgaruvchilar yig'indisini minimallashtirish
  if (artificial.length) {
    const phase1 = new Array<number>(width).fill(0);
    artificial.forEach((j) => (phase1[j] = 1));
    run(phase1, () => true);
    const infeas = basis.reduce((sum, j, i) => sum + (artificial.includes(j) ? T[i]![width]! : 0), 0);
    if (infeas > 1e-7) return { status: 'infeasible', x: new Array<number>(n).fill(0), value: NaN };
    // Bazisda qolgan (nol qiymatli) sun'iy o'zgaruvchilarni chiqarish
    basis.forEach((j, i) => {
      if (!artificial.includes(j)) return;
      const pc = T[i]!.findIndex((v, col) => col < n + slackCount && Math.abs(v) > EPS);
      if (pc >= 0) pivot(i, pc);
    });
  }

  // 2-bosqich: asl maqsad
  const cost = [...c, ...new Array<number>(width - n).fill(0)];
  const status = run(cost, (j) => !artificial.includes(j));
  if (status === 'unbounded') return { status, x: new Array<number>(n).fill(0), value: -Infinity };
  const x = new Array<number>(n).fill(0);
  basis.forEach((j, i) => {
    if (j < n) x[j] = T[i]![width]!;
  });
  return { status: 'optimal', x, value: x.reduce((sum, v, j) => sum + v * c[j]!, 0) };
}

export interface DeaUnit {
  inputs: number[];
  outputs: number[];
}

export interface DeaResult {
  /** Doimiy miqyos (CCR) samaradorligi, 0..1 */
  crs: number;
  /** O'zgaruvchan miqyos (BCC) samaradorligi, 0..1 */
  vrs: number;
  /** Miqyos samaradorligi = CRS / VRS */
  scale: number;
  /** CRS modelidagi namuna birliklar va ularning vaznlari */
  peers: { index: number; weight: number }[];
}

/**
 * DEA, kirish yo'nalishida: "shu natijani olish uchun resurslarni necha foizga kamaytirish mumkin edi".
 * θ = 1 — samaradorlik chegarasida (eng yaxshilar qatorida).
 */
export function dea(units: DeaUnit[]): DeaResult[] {
  const n = units.length;
  const ni = units[0]?.inputs.length ?? 0;
  const no = units[0]?.outputs.length ?? 0;
  const solve = (o: number, vrs: boolean) => {
    // O'zgaruvchilar: λ_1..λ_n, θ
    const c = [...new Array<number>(n).fill(0), 1];
    const cons: LpConstraint[] = [];
    for (let i = 0; i < ni; i += 1) {
      cons.push({ coefs: [...units.map((u) => u.inputs[i]!), -units[o]!.inputs[i]!], rel: '<=', rhs: 0 });
    }
    for (let r = 0; r < no; r += 1) {
      cons.push({ coefs: [...units.map((u) => u.outputs[r]!), 0], rel: '>=', rhs: units[o]!.outputs[r]! });
    }
    if (vrs) cons.push({ coefs: [...new Array<number>(n).fill(1), 0], rel: '=', rhs: 1 });
    return solveLp(c, cons);
  };
  return units.map((_, o) => {
    const crs = solve(o, false);
    const vrs = solve(o, true);
    const eCrs = crs.status === 'optimal' ? Math.min(1, crs.x[n]!) : NaN;
    const eVrs = vrs.status === 'optimal' ? Math.min(1, vrs.x[n]!) : NaN;
    return {
      crs: eCrs,
      vrs: eVrs,
      scale: eVrs > 0 ? Math.min(1, eCrs / eVrs) : NaN,
      peers: crs.status === 'optimal' ? crs.x.slice(0, n).map((w, index) => ({ index, weight: w })).filter((p) => p.weight > 1e-6) : [],
    };
  });
}