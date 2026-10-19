import { BadRequestException, Injectable } from '@nestjs/common';
import { EconData, fmtPct, fmtSom, tiyin } from './econ.data';
import { dea } from './econ.lp';
import { isOlsFailure, mean, ols } from './econ.math';
import type { BreakevenResult, BreakevenUnit, EfficiencyMode, EfficiencyResult, EfficiencyUnit, Panel, UnitSeries } from './econ.types';

// ═══════════════════════════════════════════════════════════
// Samaradorlik chegarasi (DEA) va zararsizlik nuqtasi.
//
// DEA — hududlar bir-biri bilan solishtiriladi: kim bir xil resurs (xodimlar, xarajat) bilan
// eng ko'p daromad oladi. Eng yaxshilar "chegara"ni tashkil qiladi (100%), qolganlar ulardan
// qancha orqada ekani o'lchanadi. Hech qanday oldindan belgilangan me'yor kerak emas.
//
// Zararsizlik — har bir hudud (va korxona) uchun oylik xarajat daromadga qanday bog'liq:
// xarajat = doimiy qism + o'zgaruvchan ulush × daromad. Zararsizlik daromadi = doimiy / (1 − ulush).
// ═══════════════════════════════════════════════════════════

const WINDOWS = [3, 6, 12, 24] as const;

function parseWindow(value?: string): number {
  if (!value || value === '12') return 12;
  if (value === 'all') return 0;
  const n = Number(value);
  if (!(WINDOWS as readonly number[]).includes(n)) throw new BadRequestException("Davr noto'g'ri: 3, 6, 12, 24 yoki all");
  return n;
}

/** Oxirgi n tugagan oy indekslari (n = 0 — hammasi) */
function windowIndexes(panel: Panel, n: number): number[] {
  const full = EconData.fullCount(panel);
  const from = n > 0 ? Math.max(0, full - n) : 0;
  return Array.from({ length: full - from }, (_, i) => from + i);
}

function nonpayroll(u: UnitSeries, i: number): number {
  return u.lease[i]! + u.vehicle[i]! + u.otherExpense[i]!;
}

function pctText(v: number): string {
  return fmtPct(v * 100, 0);
}

@Injectable()
export class EfficiencyService {
  constructor(private readonly data: EconData) {}

  // ═══════════════════════════════════════════════════════════
  // Samaradorlik chegarasi
  // ═══════════════════════════════════════════════════════════

  async efficiency(query: { months?: string; mode?: string; asOf?: string }): Promise<EfficiencyResult> {
    const window = parseWindow(query.months);
    const mode: EfficiencyMode = query.mode === 'money' ? 'money' : 'resources';
    const panel = await this.data.panel(query.asOf);
    const idx = windowIndexes(panel, window);
    const notes: string[] = [];
    const warnings: string[] = [];

    const regions = panel.units.filter((u) => u.kind === 'region');
    const rows = regions.map((u) => {
      const active = idx.filter((i) => u.income[i]! !== 0 || u.expense[i]! !== 0);
      const income = active.reduce((s, i) => s + u.income[i]!, 0);
      const expense = active.reduce((s, i) => s + u.expense[i]!, 0);
      const payroll = active.reduce((s, i) => s + u.payroll[i]!, 0);
      const np = active.reduce((s, i) => s + nonpayroll(u, i), 0);
      const heads = active.length ? mean(active.map((i) => u.headcount[i]!)) : 0;
      return { u, months: active.length, income, expense, payroll, np, heads };
    });

    const inputLabels = mode === 'resources' ? ["Xodimlar (o'rtacha soni)", 'Ish haqidan tashqari xarajatlar'] : ['Ish haqi xarajati', 'Ish haqidan tashqari xarajatlar'];
    const inputsOf = (r: (typeof rows)[number]) => (mode === 'resources' ? [r.heads, r.np] : [r.payroll, r.np]);
    const usable = rows.filter((r) => r.months > 0 && r.income > 0 && inputsOf(r).every((v) => v > 0));
    const skipped = rows.filter((r) => r.months > 0 && !usable.includes(r));
    if (skipped.length) {
      warnings.push(
        `DEA ga kirmagan hududlar (daromad yoki resurs nol): ${skipped.map((r) => r.u.name).join(', ')}.`,
      );
    }

    const period = idx.length ? { from: panel.months[idx[0]!]!, to: panel.months[idx[idx.length - 1]!]! } : { from: null, to: null };
    const result: EfficiencyResult = {
      mode,
      months: idx.length,
      periodFrom: period.from,
      periodTo: period.to,
      inputs: inputLabels,
      units: [],
      frontier: [],
      notes,
      warnings,
    };
    if (usable.length < 4) {
      notes.push(`Samaradorlik chegarasi uchun kamida 4 ta hudud kerak (daromad va resurslari bilan). Hozir: ${usable.length} ta.`);
      return result;
    }
    if (usable.length < 3 * 3) warnings.push(`Hududlar soni (${usable.length}) resurslar soniga nisbatan kam — ko'p hudud 100% chiqishi mumkin.`);

    // Tebranishni kamaytirish: summalar o'rtacha oylikka keltiriladi (hududlar oylar soni har xil bo'lishi mumkin)
    const perMonth = (r: (typeof rows)[number]) => ({
      inputs: inputsOf(r).map((v, k) => (mode === 'resources' && k === 0 ? v : v / r.months)),
      outputs: [r.income / r.months],
    });
    const scores = dea(usable.map(perMonth));

    result.units = usable
      .map((r, i): EfficiencyUnit => {
        const s = scores[i]!;
        const monthlyIncome = r.income / r.months;
        const crs = Number.isFinite(s.crs) ? s.crs : 0;
        const potential = crs > 0 ? monthlyIncome / crs : monthlyIncome;
        return {
          key: r.u.key,
          name: r.u.name,
          months: r.months,
          incomeTiyin: tiyin(monthlyIncome),
          expenseTiyin: tiyin(r.expense / r.months),
          payrollTiyin: tiyin(r.payroll / r.months),
          nonpayrollTiyin: tiyin(r.np / r.months),
          headcount: Math.round(r.heads * 10) / 10,
          incomePerHeadTiyin: r.heads > 0 ? tiyin(monthlyIncome / r.heads) : null,
          roi: r.expense > 0 ? r.income / r.expense : null,
          margin: r.income > 0 ? (r.income - r.expense) / r.income : null,
          crs,
          vrs: Number.isFinite(s.vrs) ? s.vrs : crs,
          scale: Number.isFinite(s.scale) ? s.scale : 1,
          rank: 0,
          peers: s.peers
            .filter((p) => p.index !== i)
            .sort((a, b) => b.weight - a.weight)
            .map((p) => ({ key: usable[p.index]!.u.key, name: usable[p.index]!.u.name, weight: p.weight })),
          potentialIncomeTiyin: tiyin(potential),
          gapTiyin: tiyin(potential - monthlyIncome),
          status: crs >= 0.999 ? 'frontier' : crs >= 0.9 ? 'near' : crs >= 0.7 ? 'mid' : 'low',
        };
      })
      .sort((a, b) => b.crs - a.crs || Number(b.incomeTiyin) - Number(a.incomeTiyin));
    result.units.forEach((u, i) => (u.rank = i + 1));
    result.frontier = result.units.filter((u) => u.status === 'frontier').map((u) => u.name);

    // ─────────── Xulosalar ───────────
    const list = result.units;
    const avg = mean(list.map((u) => u.crs));
    notes.push(
      `${list.length} ta hudud solishtirildi (${result.months} oy). Samaradorlik chegarasida — ${result.frontier.length} ta: ${result.frontier.join(', ')}. O'rtacha samaradorlik — ${pctText(avg)}.`,
    );
    const low = list.filter((u) => u.status === 'low');
    if (low.length) {
      notes.push(
        `Eng orqada qolganlar (70% dan past): ${low
          .slice(-4)
          .reverse()
          .map((u) => `${u.name} (${pctText(u.crs)})`)
          .join(', ')}.`,
      );
    }
    const worst = list[list.length - 1]!;
    if (worst.status !== 'frontier' && worst.peers.length) {
      notes.push(
        `${worst.name} o'z resurslari bilan ${worst.peers
          .slice(0, 2)
          .map((p) => p.name)
          .join(' va ')} kabi ishlaganda oyiga ~${fmtSom(Number(worst.potentialIncomeTiyin) / 100)} daromad olardi (hozir ${fmtSom(Number(worst.incomeTiyin) / 100)}, farq +${fmtSom(Number(worst.gapTiyin) / 100)}).`,
      );
    }
    const totalGap = list.reduce((s, u) => s + Number(u.gapTiyin) / 100, 0);
    const totalIncome = list.reduce((s, u) => s + Number(u.incomeTiyin) / 100, 0);
    if (totalGap > 0) {
      notes.push(
        `Agar barcha hududlar chegaradagilar darajasida ishlasa, hozirgi resurslar bilan oyiga yana ~${fmtSom(totalGap)} (+${fmtPct((totalGap / Math.max(1, totalIncome)) * 100)}) daromad olish mumkin edi. Bu — yuqori chegara, to'liq erishib bo'lmasligi mumkin.`,
      );
    }
    const scaleIssues = list.filter((u) => u.vrs >= 0.97 && u.scale < 0.9);
    if (scaleIssues.length) {
      notes.push(
        `${scaleIssues.map((u) => u.name).join(', ')} — boshqaruv yaxshi (o'z kattaligidagilar orasida 100% ga yaqin), lekin hajmi mos emas: samaradorlik yo'qotishi asosan hudud kattaligidan.`,
      );
    }
    const perHead = list.filter((u) => u.incomePerHeadTiyin !== null);
    if (perHead.length >= 2) {
      const sorted = [...perHead].sort((a, b) => Number(b.incomePerHeadTiyin) - Number(a.incomePerHeadTiyin));
      notes.push(
        `Bir xodimga oylik daromad: eng yuqori — ${sorted[0]!.name} (${fmtSom(Number(sorted[0]!.incomePerHeadTiyin) / 100)}), eng past — ${sorted[sorted.length - 1]!.name} (${fmtSom(Number(sorted[sorted.length - 1]!.incomePerHeadTiyin) / 100)}).`,
      );
    }
    notes.push(
      mode === 'resources'
        ? "Resurslar: xodimlar soni va ish haqidan tashqari xarajatlar; natija: daromad. «Pul» rejimida xodimlar soni o'rniga ish haqi olinadi."
        : "Resurslar: ish haqi va boshqa xarajatlar (so'mda); natija: daromad.",
    );
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // Zararsizlik nuqtasi
  // ═══════════════════════════════════════════════════════════

  async breakeven(query: { months?: string; asOf?: string }): Promise<BreakevenResult> {
    const window = parseWindow(query.months ?? '12');
    const panel = await this.data.panel(query.asOf);
    const idx = windowIndexes(panel, window);
    const notes: string[] = [];

    const analyze = (u: UnitSeries): BreakevenUnit => {
      const active = idx.filter((i) => u.income[i]! !== 0 || u.expense[i]! !== 0);
      const I = active.map((i) => u.income[i]!);
      const E = active.map((i) => u.expense[i]!);
      const avgI = mean(I);
      const avgE = mean(E);
      const base: BreakevenUnit = {
        key: u.key,
        name: u.name,
        kind: u.kind,
        months: active.length,
        avgIncomeTiyin: tiyin(avgI),
        avgExpenseTiyin: tiyin(avgE),
        avgProfitTiyin: tiyin(avgI - avgE),
        method: 'none',
        fixedTiyin: null,
        variableRate: null,
        r2: null,
        slopeP: null,
        breakevenTiyin: null,
        safetyMargin: null,
        leverage: null,
        status: 'na',
        text: '',
        points: active.map((i) => ({ period: panel.months[i]!, incomeTiyin: tiyin(u.income[i]!), expenseTiyin: tiyin(u.expense[i]!) })),
      };
      if (u.kind === 'center' || avgI <= 0) {
        base.text = u.kind === 'center' ? "Markazning o'z daromadi yo'q — uning xarajatini hududlar foydasi qoplashi kerak." : "Daromad yo'q — zararsizlik hisoblanmaydi.";
        return base;
      }
      if (active.length < 6) {
        base.text = `Kamida 6 oy kerak, hozir ${active.length} oy.`;
        return base;
      }

      // Xarajat = F + v · Daromad
      const fit = ols(E, I.map((v) => [1, v]), ['const', 'income']);
      let F = avgE;
      let v = 0;
      let method: BreakevenUnit['method'] = 'fixed';
      if (!isOlsFailure(fit)) {
        const slope = fit.coefficients[1]!;
        base.r2 = fit.r2;
        base.slopeP = slope.p;
        if (slope.p < 0.1 && slope.value > 0 && slope.value < 1 && fit.coefficients[0]!.value > 0) {
          F = fit.coefficients[0]!.value;
          v = slope.value;
          method = 'regression';
        } else if (slope.p < 0.1 && slope.value >= 1) {
          base.method = 'regression';
          base.variableRate = slope.value;
          base.status = 'loss';
          base.text = `Har qo'shimcha 1 so'm daromad xarajatni ${slope.value.toFixed(2).replace('.', ',')} so'mga oshirgan — daromad o'sishi zararni kamaytirmaydi. Xarajat tuzilmasini ko'rib chiqish kerak.`;
          return base;
        }
      }
      const be = F / (1 - v);
      const margin = (avgI - be) / avgI;
      const contribution = avgI * (1 - v);
      const profit = contribution - F;
      base.method = method;
      base.fixedTiyin = tiyin(F);
      base.variableRate = v;
      base.breakevenTiyin = tiyin(be);
      base.safetyMargin = margin;
      base.leverage = profit > 0 ? contribution / profit : null;
      base.status = margin < 0 ? 'loss' : margin < 0.1 ? 'thin' : 'safe';
      const how =
        method === 'regression'
          ? `Oylik xarajat ≈ ${fmtSom(F)} doimiy + daromadning ${fmtPct(v * 100)} i.`
          : "Xarajat daromad bilan birga o'zgarmagan — deyarli hammasi doimiy deb olindi.";
      base.text =
        `${how} Zararsizlik uchun oyiga ${fmtSom(be)} daromad kerak; o'rtacha daromad ${fmtSom(avgI)} — ` +
        (margin >= 0 ? `xavfsizlik zaxirasi ${fmtPct(margin * 100)}.` : `${fmtSom(be - avgI)} yetmayapti.`) +
        (base.leverage !== null && base.leverage > 1 ? ` Daromad 10% o'zgarsa, foyda ~${fmtPct(base.leverage * 10, 0)} o'zgaradi.` : '');
      return base;
    };

    const units = [panel.total, ...panel.units.filter((u) => u.kind === 'region' || u.kind === 'center')].map(analyze).filter((u) => u.months > 0);
    const center = panel.units.find((u) => u.kind === 'center');
    const regionsProfit = panel.units
      .filter((u) => u.kind === 'region')
      .reduce((s, u) => s + mean(idx.map((i) => u.income[i]! - u.expense[i]!)), 0);
    const centerExpense = center ? mean(idx.map((i) => center.expense[i]! - center.income[i]!)) : 0;

    const period = idx.length ? { from: panel.months[idx[0]!]!, to: panel.months[idx[idx.length - 1]!]! } : { from: null, to: null };
    const result: BreakevenResult = {
      months: idx.length,
      periodFrom: period.from,
      periodTo: period.to,
      units,
      center: center
        ? {
            netExpenseTiyin: tiyin(centerExpense),
            regionsProfitTiyin: tiyin(regionsProfit),
            coverage: centerExpense > 0 ? regionsProfit / centerExpense : null,
          }
        : null,
      notes,
    };

    const regions = units.filter((u) => u.kind === 'region' && u.status !== 'na');
    const total = units.find((u) => u.kind === 'total');
    if (total && total.breakevenTiyin) {
      notes.push(`Butun korxona: ${total.text}`);
    } else if (total) notes.push(`Butun korxona: ${total.text || "zararsizlik hisoblanmadi."}`);
    if (regions.length) {
      const safe = regions.filter((u) => u.status === 'safe').length;
      const thin = regions.filter((u) => u.status === 'thin');
      const loss = regions.filter((u) => u.status === 'loss');
      notes.push(`${regions.length} ta hududdan ${safe} tasi xavfsiz, ${thin.length} tasi chegarada (zaxira 10% dan kam), ${loss.length} tasi zararsizlik nuqtasidan past.`);
      if (loss.length) {
        notes.push(
          `Zararsizlikka yetmayotganlar: ${loss
            .map((u) => (u.breakevenTiyin ? `${u.name} (oyiga yana ${fmtSom((Number(u.breakevenTiyin) - Number(u.avgIncomeTiyin)) / 100)} daromad kerak)` : u.name))
            .join(', ')}.`,
        );
      }
      if (thin.length) notes.push(`Chegarada: ${thin.map((u) => u.name).join(', ')} — daromad biroz tushsa, zararga o'tadi.`);
      const lev = regions.filter((u) => u.leverage !== null && u.leverage > 4).sort((a, b) => b.leverage! - a.leverage!);
      if (lev.length) {
        notes.push(
          `Foydasi daromad o'zgarishiga eng sezgir (daromad 10% tushsa, foyda ${fmtPct(Math.min(100, lev[0]!.leverage! * 10), 0)} gacha kamayadi): ${lev
            .slice(0, 3)
            .map((u) => `${u.name} (×${u.leverage!.toFixed(1).replace('.', ',')})`)
            .join(', ')}${lev.length > 3 ? ` va yana ${lev.length - 3} ta` : ''}.`,
        );
      }
    }
    if (result.center && result.center.coverage !== null) {
      const c = result.center.coverage;
      notes.push(
        `Markaz oyiga ~${fmtSom(centerExpense)} sarflaydi; hududlarning o'rtacha oylik foydasi ${fmtSom(regionsProfit)} — ` +
          (c >= 1 ? `Markazni ${fmtPct(c * 100, 0)} qoplaydi.` : c > 0 ? `Markaz xarajatining faqat ${fmtPct(c * 100, 0)} ini qoplaydi.` : 'Markazni qoplay olmaydi.'),
      );
    }
    notes.push("Doimiy va o'zgaruvchan qism oylik xarajat va daromad o'rtasidagi bog'liqlikdan topiladi (regressiya); bog'liqlik ishonchsiz bo'lsa, xarajat to'liq doimiy deb olinadi.");
    return result;
  }
}