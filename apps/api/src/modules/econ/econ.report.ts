import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { fmtPct, fmtSom, periodLabel } from './econ.data';
import { EfficiencyService } from './econ.efficiency';
import { FactorsService } from './econ.factors';
import { ScenarioService } from './econ.scenario';
import { EconService } from './econ.service';
import { breakevenWorkings, coefWorkings, efficiencyWorkings, forecastWorkings, MODEL_FORMULAS, riskWorkings, unitEffectWorkings, type Working } from './econ.workings';
import type {
  BreakevenResult,
  EconOverview,
  EfficiencyResult,
  FactorsResult,
  ForecastResult,
  RiskResult,
  UnitsForecastResult,
} from './econ.types';

// ═══════════════════════════════════════════════════════════
// Katta modellar — umumiy hisobot (Excel) va slaydlar (PowerPoint).
// Barcha modellar bir marta hisoblanadi, natijalar ikkala faylga yoziladi.
// ═══════════════════════════════════════════════════════════

interface Bundle {
  overview: EconOverview;
  income: ForecastResult;
  expense: ForecastResult;
  result: ForecastResult;
  unitsIncome: UnitsForecastResult;
  unitsResult: UnitsForecastResult;
  factors: FactorsResult;
  efficiency: EfficiencyResult;
  breakeven: BreakevenResult;
  risk: RiskResult;
  today: string;
}

const NAVY = 'FF1B3354';
const GREEN = 'FF2F7A57';
const RED = 'FFB3423B';
const LINE = 'FFD1D5DB';
const GREY_FILL = 'FFF3F4F6';
const MONEY = '#,##0';

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const RELIABILITY = { high: 'Ishonchli', medium: "O'rtacha", low: 'Taxminiy', none: "Ma'lumot kam" } as const;
const SIGNIFICANCE = { strong: 'Ishonchli', weak: 'Taxminiy', none: 'Aniqlanmadi' } as const;
const METHOD = { pooled: 'Umumiy (OLS)', fixed: "Qat'iy ta'sirlar (FE)", random: "Tasodifiy ta'sirlar (RE)" } as const;
const BE_STATUS = { safe: 'Xavfsiz', thin: 'Chegarada', loss: 'Zararda', na: '—' } as const;
const RISK_LEVEL = { high: 'Yuqori', medium: "O'rtacha", low: 'Past' } as const;

function som(tiyin: string | number): number {
  return Math.round(Number(tiyin) / 100);
}

function mln(tiyin: string | number): number {
  return Math.round(Number(tiyin) / 100 / 1e5) / 10;
}

function short(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`;
}

function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

@Injectable()
export class EconReportService {
  constructor(
    private readonly econ: EconService,
    private readonly factors: FactorsService,
    private readonly efficiencyService: EfficiencyService,
    private readonly scenarios: ScenarioService,
  ) {}

  /** asOf — umumiy «Davr» oyi (o'tgan oy bo'lsa — o'sha oy oxiridagi holat) */
  private async bundle(asOf?: string): Promise<Bundle> {
    const [overview, income, expense, result, unitsIncome, unitsResult, factors, efficiency, breakeven, risk] = await Promise.all([
      this.econ.overview(asOf),
      this.econ.forecast({ target: 'income', unit: 'all', horizon: '6', asOf }),
      this.econ.forecast({ target: 'expense', unit: 'all', horizon: '6', asOf }),
      this.econ.forecast({ target: 'result', unit: 'all', horizon: '6', asOf }),
      this.econ.unitsForecast({ target: 'income', horizon: '3', asOf }),
      this.econ.unitsForecast({ target: 'result', horizon: '3', asOf }),
      this.factors.analyze({ asOf }),
      this.efficiencyService.efficiency({ months: '12', mode: 'resources', asOf }),
      this.efficiencyService.breakeven({ months: '12', asOf }),
      this.scenarios.risk({ horizon: '3', asOf }),
    ]);
    return {
      overview,
      income,
      expense,
      result,
      unitsIncome,
      unitsResult,
      factors,
      efficiency,
      breakeven,
      risk,
      today: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Excel
  // ═══════════════════════════════════════════════════════════

  async excel(asOf?: string): Promise<{ buffer: Buffer; filename: string }> {
    const b = await this.bundle(asOf);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    wb.created = new Date();

    this.xSummary(wb, b);
    this.xForecast(wb, b);
    this.xFactors(wb, b);
    this.xEfficiency(wb, b);
    this.xBreakeven(wb, b);
    this.xRisk(wb, b);
    // Har model varag'i ostida — asosiy formulalar
    const add = (name: string, lines: string[], span: number) => {
      const ws = wb.getWorksheet(name);
      if (ws) this.formulas(ws, lines, span);
    };
    add('Prognoz', MODEL_FORMULAS.forecast, 10);
    add('Omillar', MODEL_FORMULAS.factors, 7);
    add('Samaradorlik', MODEL_FORMULAS.efficiency, 12);
    add('Zararsizlik', MODEL_FORMULAS.breakeven, 10);
    add('Risk', MODEL_FORMULAS.risk, 8);
    this.xWorkings(wb, b);
    this.xData(wb, b);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: `Katta modellar - hisobot - ${b.today}.xlsx` };
  }

  private sheet(wb: ExcelJS.Workbook, name: string, widths: number[], title: string, sub: string): ExcelJS.Worksheet {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = widths.map((width) => ({ width }));
    ws.mergeCells(1, 1, 1, widths.length);
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: NAVY } };
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, widths.length);
    ws.getCell(2, 1).value = sub;
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF6B7280' } };
    return ws;
  }

  private head(ws: ExcelJS.Worksheet, r: number, labels: string[]) {
    const row = ws.getRow(r);
    labels.forEach((l, i) => (row.getCell(i + 1).value = l));
    row.height = 30;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
  }

  private row(ws: ExcelJS.Worksheet, r: number, values: (string | number | null)[], formats: (string | null)[] = []) {
    const row = ws.getRow(r);
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (formats[i]) cell.numFmt = formats[i]!;
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
      cell.alignment = { vertical: 'middle', wrapText: typeof v === 'string' && v.length > 40 };
    });
  }

  private section(ws: ExcelJS.Worksheet, r: number, text: string, span: number) {
    ws.mergeCells(r, 1, r, span);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size: 12, color: { argb: NAVY } };
    ws.getRow(r).height = 22;
  }

  private notes(ws: ExcelJS.Worksheet, r: number, notes: string[], span: number): number {
    for (const [i, n] of notes.entries()) {
      ws.mergeCells(r, 1, r, span);
      const c = ws.getCell(r, 1);
      c.value = `${i + 1}. ${n}`;
      c.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = Math.max(18, Math.ceil(n.length / 120) * 16);
      r += 1;
    }
    return r;
  }

  private xSummary(wb: ExcelJS.Workbook, b: Bundle) {
    const ws = this.sheet(wb, 'Xulosa', [4, 40, 22, 22, 22, 22], 'Katta modellar — umumiy hisobot', `Tayyorlangan: ${uzDate(b.today)} · ma'lumot: ${periodLabel(b.overview.firstPeriod)} – ${periodLabel(b.overview.lastFullPeriod)} (${b.overview.fullMonths} oy)`);
    let r = 4;
    const kpis: [string, string][] = [
      [`${b.income.yearEnd?.year ?? ''}-yil daromadi (taxmin)`, b.income.yearEnd ? fmtSom(Number(b.income.yearEnd.totalTiyin) / 100) : '—'],
      [`${b.result.yearEnd?.year ?? ''}-yil natijasi (taxmin)`, b.result.yearEnd ? fmtSom(Number(b.result.yearEnd.totalTiyin) / 100) : '—'],
      ["Keyingi 3 oy zarar ehtimoli (korxona)", fmtPct((b.risk.units.find((u) => u.kind === 'total')?.lossProbability ?? 0) * 100, 0)],
      ["O'rtacha samaradorlik (DEA)", b.efficiency.units.length ? fmtPct((b.efficiency.units.reduce((s, u) => s + u.crs, 0) / b.efficiency.units.length) * 100, 0) : '—'],
      ['Korxona zararsizlik daromadi (oyiga)', (() => {
        const t = b.breakeven.units.find((u) => u.kind === 'total');
        return t?.breakevenTiyin ? fmtSom(Number(t.breakevenTiyin) / 100) : '—';
      })()],
    ];
    for (const [label, value] of kpis) {
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 2).font = { bold: true, color: { argb: 'FF374151' } };
      ws.getCell(r, 3).value = value;
      ws.getCell(r, 3).font = { bold: true, size: 12 };
      r += 1;
    }
    r += 1;
    const blocks: [string, string[]][] = [
      ['Prognoz', [...b.income.notes.slice(0, 3), ...b.result.notes.slice(1, 3)]],
      ['Hududlar prognozi', b.unitsIncome.notes],
      ['Omillar', b.factors.notes.slice(0, 7)],
      ['Samaradorlik', b.efficiency.notes.slice(0, 5)],
      ['Zararsizlik', b.breakeven.notes.slice(0, 5)],
      ['Risk', b.risk.notes.slice(0, 4)],
      ["Ma'lumot sifati", b.overview.warnings.map((w) => w.text)],
    ];
    for (const [title, notes] of blocks) {
      if (!notes.length) continue;
      this.section(ws, r, title, 6);
      r = this.notes(ws, r + 1, notes, 6) + 1;
    }
  }

  private xForecast(wb: ExcelJS.Workbook, b: Bundle) {
    const ws = this.sheet(wb, 'Prognoz', [16, 16, 16, 16, 16, 16, 16, 16, 16, 12], 'Prognoz — butun korxona', `Model: daromad — ${b.income.model.name}, xarajat — ${b.expense.model.name}. Ishonchlilik: ${RELIABILITY[b.income.reliability]} / ${RELIABILITY[b.expense.reliability]}`);
    this.head(ws, 4, ['Oy', 'Turi', 'Daromad', 'Daromad 80% dan', 'Daromad 80% gacha', 'Xarajat', 'Xarajat 80% dan', 'Xarajat 80% gacha', 'Natija', '']);
    let r = 5;
    const hist = b.income.history.slice(-12);
    for (const h of hist) {
      const e = b.expense.history.find((x) => x.period === h.period);
      this.row(ws, r++, [periodLabel(h.period), 'haqiqiy', som(h.valueTiyin), null, null, e ? som(e.valueTiyin) : null, null, null, e ? som(h.valueTiyin) - som(e.valueTiyin) : null], [null, null, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY]);
    }
    for (const f of b.income.forecast) {
      const e = b.expense.forecast.find((x) => x.period === f.period);
      this.row(
        ws,
        r,
        [periodLabel(f.period), 'prognoz', som(f.meanTiyin), som(f.lo80Tiyin), som(f.hi80Tiyin), e ? som(e.meanTiyin) : null, e ? som(e.lo80Tiyin) : null, e ? som(e.hi80Tiyin) : null, e ? som(f.meanTiyin) - som(e.meanTiyin) : null],
        [null, null, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY],
      );
      ws.getRow(r).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY_FILL } }));
      r += 1;
    }
    r += 1;
    this.section(ws, r, "Hududlar: keyingi 3 oy (o'rtacha oylik)", 10);
    r += 1;
    this.head(ws, r, ['Hudud', "Daromad: oxirgi 3 oy", 'Daromad: keyingi 3 oy', "O'zgarish %", 'Yil oxirigacha', 'Natija: keyingi 3 oy', 'Ishonchlilik', 'Model', '', '']);
    r += 1;
    for (const u of b.unitsIncome.units) {
      const res = b.unitsResult.units.find((x) => x.key === u.key);
      this.row(
        ws,
        r++,
        [u.name, som(u.recentAvgTiyin), som(u.nextAvgTiyin), u.changePercent === null ? null : Math.round(u.changePercent * 10) / 10, u.yearEndTiyin ? som(u.yearEndTiyin) : null, res ? som(res.nextAvgTiyin) : null, RELIABILITY[u.reliability], u.model],
        [null, MONEY, MONEY, '0.0', MONEY, MONEY],
      );
    }
  }

  private xFactors(wb: ExcelJS.Workbook, b: Bundle) {
    const f = b.factors;
    const ws = this.sheet(wb, 'Omillar', [34, 18, 18, 18, 12, 14, 70], "Omillar tahlili — daromad nimaga bog'liq", `${f.units} hudud × ${f.months} oy = ${f.observations} kuzatuv · asosiy model: ${f.preferred ? METHOD[f.preferred] : '—'}`);
    let r = 4;
    const main = f.preferred ? f[f.preferred] : null;
    if (main) {
      this.section(ws, r++, `Asosiy natija — ${main.name}`, 7);
      this.head(ws, r++, ['Omil', "Ta'sir", '95% dan', '95% gacha', 'p', 'Ishonch', "Ma'nosi"]);
      for (const c of main.coefficients) {
        const per = f.factors.find((x) => x.key === c.key)?.unit === 'kishi' ? 1 : 1e6;
        this.row(ws, r++, [`${c.label} (${per === 1 ? "so'm / 1 kishi" : "so'm / 1 mln so'm"})`, Math.round(c.value * per), Math.round(c.lo95 * per), Math.round(c.hi95 * per), Math.round(c.p * 1000) / 1000, SIGNIFICANCE[c.significance], c.meaning], [null, MONEY, MONEY, MONEY, '0.000']);
      }
      r += 1;
    }
    this.section(ws, r++, 'Uch usul solishtirmasi', 7);
    this.head(ws, r++, ['Omil', 'OLS', 'FE', 'RE', 'Elastiklik', '', '']);
    for (const fac of f.factors) {
      const per = fac.unit === 'kishi' ? 1 : 1e6;
      const v = (m: FactorsResult['pooled']) => {
        const c = m?.coefficients.find((x) => x.key === fac.key);
        return c ? Math.round(c.value * per) : null;
      };
      const el = f.elasticity?.coefficients.find((x) => x.key === fac.key);
      this.row(ws, r++, [fac.label, v(f.pooled), v(f.fixed), v(f.random), el ? Math.round(el.value * 1000) / 1000 : null], [null, MONEY, MONEY, MONEY, '0.000']);
    }
    if (f.hausman) {
      ws.mergeCells(r, 1, r, 7);
      ws.getCell(r, 1).value = f.hausman.text;
      r += 1;
    }
    r += 1;
    if (f.cobbDouglas) {
      const cd = f.cobbDouglas;
      this.section(ws, r++, 'Kobb-Duglas', 7);
      ws.mergeCells(r, 1, r, 7);
      ws.getCell(r, 1).value = cd.text;
      ws.getCell(r, 1).alignment = { wrapText: true };
      ws.getRow(r).height = 36;
      r += 1;
      this.head(ws, r++, ['Hudud', 'TFP indeksi (100 — o\'rtacha)', '', '', '', '', '']);
      for (const t of cd.tfp) this.row(ws, r++, [t.name, Math.round(t.index * 10) / 10], [null, '0.0']);
      r += 1;
    }
    if (f.unitEffects.length) {
      this.section(ws, r++, "Hudud effekti — resurslariga nisbatan kutilganidan ko'p/kam daromad (oyiga)", 7);
      this.head(ws, r++, ['Hudud', "Haqiqiy o'rtacha", 'Kutilgan', 'Farq', 'Oylar', '', '']);
      for (const u of f.unitEffects) this.row(ws, r++, [u.name, som(u.actualTiyin), som(u.expectedTiyin), som(u.effectTiyin), u.months], [null, MONEY, MONEY, MONEY]);
    }
  }

  private xEfficiency(wb: ExcelJS.Workbook, b: Bundle) {
    const e = b.efficiency;
    const ws = this.sheet(wb, 'Samaradorlik', [6, 24, 14, 14, 12, 16, 16, 12, 16, 12, 16, 30], 'Samaradorlik chegarasi (DEA)', `${e.months} oy · resurslar: ${e.inputs.join(', ')}; natija: daromad`);
    this.head(ws, 4, ['#', 'Hudud', 'Samaradorlik %', 'Hajm hisobga olingan %', 'Miqyos %', 'Daromad (oy)', 'Xarajat (oy)', 'Xodimlar', '1 xodimga', 'Daromad / xarajat', 'Imkoniyat (oy)', 'Namuna']);
    let r = 5;
    for (const u of e.units) {
      this.row(
        ws,
        r,
        [u.rank, u.name, Math.round(u.crs * 1000) / 10, Math.round(u.vrs * 1000) / 10, Math.round(u.scale * 1000) / 10, som(u.incomeTiyin), som(u.expenseTiyin), u.headcount, u.incomePerHeadTiyin ? som(u.incomePerHeadTiyin) : null, u.roi === null ? null : Math.round(u.roi * 100) / 100, som(u.gapTiyin), u.peers.map((p) => p.name).join(', ') || "o'zi namuna"],
        [null, null, '0.0', '0.0', '0.0', MONEY, MONEY, '0.0', MONEY, '0.00', MONEY],
      );
      ws.getCell(r, 3).font = { bold: true, color: { argb: u.status === 'frontier' || u.status === 'near' ? GREEN : u.status === 'low' ? RED : 'FF92400E' } };
      r += 1;
    }
    this.notes(ws, r + 1, e.notes, 12);
  }

  private xBreakeven(wb: ExcelJS.Workbook, b: Bundle) {
    const be = b.breakeven;
    const ws = this.sheet(wb, 'Zararsizlik', [24, 16, 16, 16, 14, 18, 12, 12, 14, 16], 'Zararsizlik nuqtasi (oylik)', `${be.months} oy`);
    this.head(ws, 4, ["Hudud", "O'rtacha daromad", "O'rtacha xarajat", 'Doimiy xarajat', "O'zgaruvchan ulush %", 'Zararsizlik daromadi', 'Zaxira %', 'Leverej', 'Holat', 'Usul']);
    let r = 5;
    for (const u of be.units) {
      this.row(
        ws,
        r,
        [u.name, som(u.avgIncomeTiyin), som(u.avgExpenseTiyin), u.fixedTiyin ? som(u.fixedTiyin) : null, u.variableRate === null ? null : Math.round(u.variableRate * 1000) / 10, u.breakevenTiyin ? som(u.breakevenTiyin) : null, u.safetyMargin === null ? null : Math.round(u.safetyMargin * 1000) / 10, u.leverage === null ? null : Math.round(u.leverage * 10) / 10, BE_STATUS[u.status], u.method === 'regression' ? 'regressiya' : u.method === 'fixed' ? 'hammasi doimiy' : '—'],
        [null, MONEY, MONEY, MONEY, '0.0', MONEY, '0.0', '0.0'],
      );
      if (u.status === 'loss') ws.getCell(r, 9).font = { bold: true, color: { argb: RED } };
      r += 1;
    }
    this.notes(ws, r + 1, be.notes, 10);
  }

  private xRisk(wb: ExcelJS.Workbook, b: Bundle) {
    const k = b.risk;
    const ws = this.sheet(wb, 'Risk', [24, 18, 18, 18, 16, 16, 16, 12], 'Risk — zararga tushish ehtimoli (Monte-Karlo)', `${periodLabel(k.periodFrom)} – ${periodLabel(k.periodTo)} (${k.horizon} oy)`);
    this.head(ws, 4, ['Hudud', 'Kutilgan natija', '10% yomon holat', '10% yaxshi holat', 'Zarar ehtimoli %', 'Kamida 1 oy zarar %', 'Daromad 10%+ tushishi %', 'Xavf']);
    let r = 5;
    for (const u of k.units) {
      this.row(
        ws,
        r,
        [u.name, som(u.expectedResultTiyin), som(u.p10Tiyin), som(u.p90Tiyin), Math.round(u.lossProbability * 1000) / 10, Math.round(u.anyMonthLossProbability * 1000) / 10, Math.round(u.incomeDropProbability * 1000) / 10, RISK_LEVEL[u.level]],
        [null, MONEY, MONEY, MONEY, '0.0', '0.0', '0.0'],
      );
      if (u.level === 'high') ws.getCell(r, 8).font = { bold: true, color: { argb: RED } };
      r += 1;
    }
    this.notes(ws, r + 1, k.notes, 8);
  }

  /** Varaq oxiriga asosiy formulalar */
  private formulas(ws: ExcelJS.Worksheet, lines: string[], span: number) {
    let r = ws.rowCount + 2;
    this.section(ws, r, "Hisob-kitob formulalari (har qator ishlanishi — «Hisob-kitob» varag'ida)", span);
    for (const line of lines) {
      r += 1;
      ws.mergeCells(r, 1, r, span);
      ws.getCell(r, 1).value = `• ${line}`;
      ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
      ws.getCell(r, 1).font = { size: 9.5, color: { argb: 'FF374151' } };
      ws.getRow(r).height = line.length > 140 ? 30 : 16;
    }
  }

  // Hisob-kitob: har model, har qator — sonlar bilan
  private xWorkings(wb: ExcelJS.Workbook, b: Bundle) {
    const ws = this.sheet(wb, 'Hisob-kitob', [26, 28, 44, 80, 26], 'Hisob-kitob — sonlar bilan ishlanishi', "Saytdagi «Qanday hisoblandi?» bilan bir xil formulalar");
    let r = 4;
    const block = (title: string, list: Working[]) => {
      if (!list.length) return;
      this.section(ws, r++, title, 5);
      this.head(ws, r++, ['Qator', "Ko'rsatkich", 'Formula', 'Ishlanishi', 'Javob']);
      for (const w of list) {
        const row = ws.getRow(r);
        row.values = [w.subject, w.title, w.formula, w.steps.join('\n'), w.result];
        row.eachCell((c) => {
          c.alignment = { wrapText: true, vertical: 'top' };
          c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
        });
        row.getCell(5).font = { bold: true };
        row.height = Math.max(18, 14 * Math.max(w.steps.length, Math.ceil(w.steps.join(' ').length / 80), Math.ceil(w.formula.length / 44)));
        r += 1;
      }
      r += 1;
    };
    block('Prognoz — daromad (butun korxona)', forecastWorkings(b.income, 'Daromad'));
    block('Prognoz — xarajat (butun korxona)', forecastWorkings(b.expense, 'Xarajat'));
    block('Prognoz — natija (butun korxona)', forecastWorkings(b.result, 'Natija'));
    const f = b.factors;
    const main = f.preferred ? f[f.preferred] : null;
    if (main) block(`Omillar — ${main.name}`, coefWorkings(main, f.factors));
    block("Omillar — hudud ta'siri", unitEffectWorkings(f));
    block('Samaradorlik (DEA)', b.efficiency.units.map(efficiencyWorkings));
    block('Zararsizlik', b.breakeven.units.map(breakevenWorkings).filter((w): w is Working => w !== null));
    block('Risk (Monte-Karlo)', b.risk.units.map(riskWorkings));
  }

  private xData(wb: ExcelJS.Workbook, b: Bundle) {
    const o = b.overview;
    const ws = this.sheet(wb, "Ma'lumot", [16, 18, 18, 18, 18, 12], "Manba ma'lumot — butun korxona (oylar bo'yicha)", o.sources.join(' · '));
    this.head(ws, 4, ['Oy', 'Daromad', 'Xarajat', 'Ish haqi', 'Natija', 'Xodimlar']);
    let r = 5;
    o.months.forEach((p, i) => {
      this.row(ws, r++, [periodLabel(p) + (p === o.currentPeriod ? ' (joriy)' : ''), som(o.total.incomeTiyin[i]!), som(o.total.expenseTiyin[i]!), som(o.total.payrollTiyin[i]!), som(o.total.incomeTiyin[i]!) - som(o.total.expenseTiyin[i]!), o.total.headcount[i]!], [null, MONEY, MONEY, MONEY, MONEY]);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Slaydlar
  // ═══════════════════════════════════════════════════════════

  async slides(asOf?: string): Promise<{ buffer: Buffer; filename: string }> {
    const b = await this.bundle(asOf);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Korxona tahlil';
    pptx.title = 'Katta modellar';
    const s = new Slides(pptx, b);
    s.countAppendix();
    s.cover();
    s.summary();
    s.forecast();
    s.regions();
    s.factors();
    s.efficiency();
    s.breakeven();
    s.risk();
    s.method();
    s.appendix();
    const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return { buffer: Buffer.from(out), filename: `Katta modellar - slaydlar - ${b.today}.pptx` };
  }
}

// ═══════════════════════════════════════════════════════════
// Slaydlar quruvchisi
// ═══════════════════════════════════════════════════════════

const W = 13.333;
const H = 7.5;
const FONT = 'Arial';
const C = {
  navy: '1B3354',
  ink: '111827',
  text: '374151',
  muted: '6B7280',
  faint: '9CA3AF',
  line: 'E5E7EB',
  panel: 'F6F7F9',
  green: '2F7A57',
  greenSoft: 'E3F1E9',
  red: 'B3423B',
  redSoft: 'F6E1DF',
  amber: 'B45309',
  slate: '94A3B8',
  expenseBar: 'C9837D',
};
/** Asosiy slaydlar soni (hisob-kitob ilovasi bundan keyin qo'shiladi) */
const BASE_SLIDES = 9;
/** Bitta ilova slaydida eng ko'p qator */
const PER_SLIDE = 5;

type Slide = ReturnType<PptxGenJS['addSlide']>;

class Slides {
  private page = 0;
  private total = BASE_SLIDES;

  constructor(
    private readonly pptx: PptxGenJS,
    private readonly b: Bundle,
  ) {}

  /** Ilova: [sarlavha, ishlanishlar] guruhlari */
  private appendixGroups(): [string, Working[]][] {
    const b = this.b;
    const f = b.factors;
    const main = f.preferred ? f[f.preferred] : null;
    const groups: [string, Working[]][] = [
      ['Prognoz — daromad', forecastWorkings(b.income, 'Daromad')],
      ['Prognoz — xarajat', forecastWorkings(b.expense, 'Xarajat')],
      ...(main ? ([[`Omillar — ${main.name}`, coefWorkings(main, f.factors)]] as [string, Working[]][]) : []),
      ['Samaradorlik (DEA)', b.efficiency.units.map(efficiencyWorkings)],
      ['Zararsizlik', b.breakeven.units.map(breakevenWorkings).filter((w): w is Working => w !== null)],
      ['Risk', b.risk.units.map(riskWorkings)],
    ];
    return groups.filter(([, list]) => list.length > 0);
  }

  /** Ilova slaydlari soni — sahifa raqamlari uchun oldindan */
  countAppendix(): number {
    const n = this.appendixGroups().reduce((s, [, list]) => s + Math.ceil(list.length / PER_SLIDE), 0);
    this.total = BASE_SLIDES + 1 + n;
    return n;
  }

  // 10. Formulalar va 11+. Hisob-kitob ilovasi
  appendix() {
    const formulas = this.frame('Qanday hisoblanadi', "Barcha modellar formulalari — saytdagi «Qanday hisoblandi?» bilan bir xil");
    const lines = [...MODEL_FORMULAS.forecast, ...MODEL_FORMULAS.factors.slice(0, 3), ...MODEL_FORMULAS.efficiency, ...MODEL_FORMULAS.breakeven, MODEL_FORMULAS.risk[1]!];
    this.bullets(formulas, lines, 0.6, 1.5, W - 1.2, 5.3, 13);
    for (const [title, list] of this.appendixGroups()) {
      for (let i = 0; i < list.length; i += PER_SLIDE) {
        const part = list.slice(i, i + PER_SLIDE);
        const pages = Math.ceil(list.length / PER_SLIDE);
        const slide = this.frame(`Hisob-kitob: ${title}`, pages > 1 ? `${i / PER_SLIDE + 1}/${pages} · sonlar bilan ishlanishi` : 'sonlar bilan ishlanishi');
        const head = ['Qator', "Ko'rsatkich", 'Ishlanishi', 'Javob'].map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize: 10.5 } }));
        const rows = part.map((w) => [
          { text: w.subject, options: { bold: true } },
          { text: `${w.title}\n${w.formula}`, options: { color: C.muted } },
          { text: w.steps.join('\n') },
          { text: w.result, options: { bold: true, color: C.navy } },
        ]);
        slide.addTable([head, ...rows] as never, { x: 0.6, y: 1.5, w: W - 1.2, colW: [1.9, 3.3, 5.2, 1.73], fontFace: FONT, fontSize: 11, color: C.text, valign: 'top', border: { type: 'solid', pt: 0.5, color: C.line }, autoPage: false });
      }
    }
  }

  private frame(title: string, subtitle: string | null): Slide {
    this.page += 1;
    const slide = this.pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(this.pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.navy }, line: { color: C.navy } });
    slide.addText(title, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: C.ink, margin: 0 });
    if (subtitle) slide.addText(subtitle, { x: 0.6, y: 0.95, w: W - 1.2, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted, margin: 0 });
    slide.addShape(this.pptx.ShapeType.line, { x: 0.6, y: H - 0.55, w: W - 1.2, h: 0, line: { color: C.line, width: 0.75 } });
    slide.addText('Katta modellar · avtomatik hisobot', { x: 0.6, y: H - 0.48, w: 8, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, margin: 0 });
    slide.addText(`${this.page} / ${this.total}`, { x: W - 2.6, y: H - 0.48, w: 2, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, align: 'right', margin: 0 });
    return slide;
  }

  private kpi(slide: Slide, x: number, y: number, w: number, label: string, value: string, color = C.ink, sub?: string) {
    slide.addShape(this.pptx.ShapeType.rect, { x, y, w, h: 1.35, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText(label.toUpperCase(), { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 9.5, bold: true, color: C.muted, charSpacing: 1, margin: 0, fit: 'shrink' });
    slide.addText(value, { x: x + 0.2, y: y + 0.45, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color, margin: 0, fit: 'shrink' });
    if (sub) slide.addText(sub, { x: x + 0.2, y: y + 0.95, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0, fit: 'shrink' });
  }

  private bullets(slide: Slide, notes: string[], x: number, y: number, w: number, h: number, size = 13) {
    slide.addText(
      notes.map((text, i) => ({ text: `${i + 1}.  ${text}`, options: { breakLine: true } })),
      { x, y, w, h, fontFace: FONT, fontSize: size, color: C.text, paraSpaceAfter: 6, valign: 'top', margin: 0, fit: 'shrink' },
    );
  }

  private table(slide: Slide, head: string[], rows: { text: string; options?: Record<string, unknown> }[][], x: number, y: number, w: number, colW: number[], fontSize = 11) {
    const h = head.map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize, align: 'center' as const, valign: 'middle' as const } }));
    slide.addTable([h, ...rows] as never, { x, y, w, colW, fontFace: FONT, fontSize, color: C.text, rowH: 0.32, border: { type: 'solid', pt: 0.5, color: C.line }, valign: 'middle', autoPage: false });
  }

  private chartOpts(extra: Record<string, unknown> = {}) {
    return {
      catAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT,
      catAxisLabelColor: C.muted,
      valAxisLabelFontSize: 9,
      valAxisLabelColor: C.faint,
      valGridLine: { color: C.line, style: 'solid', size: 0.5 },
      catGridLine: { style: 'none' },
      legendFontSize: 10,
      legendFontFace: FONT,
      ...extra,
    } as never;
  }

  // 1. Muqova
  cover() {
    const b = this.b;
    this.page += 1;
    const slide = this.pptx.addSlide();
    slide.addShape(this.pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: C.navy }, line: { color: C.navy } });
    slide.addText('KATTA MODELLAR', { x: 1.0, y: 1.6, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: C.muted, charSpacing: 3, margin: 0 });
    slide.addText('Prognoz, omillar, samaradorlik, zararsizlik va risk', { x: 1.0, y: 2.1, w: 11, h: 1.4, fontFace: FONT, fontSize: 36, bold: true, color: C.ink, valign: 'top', margin: 0, fit: 'shrink' });
    slide.addShape(this.pptx.ShapeType.line, { x: 1.0, y: 3.75, w: 3, h: 0, line: { color: C.navy, width: 2 } });
    slide.addText(
      [
        `Ma'lumot: ${periodLabel(b.overview.firstPeriod)} – ${periodLabel(b.overview.lastFullPeriod)} (${b.overview.fullMonths} oy)`,
        `${b.factors.units} ta hudud va Markaz · manba: Daromadlar, Xarajatlar, Xodimlar bo'limlari`,
      ].map((text) => ({ text, options: { breakLine: true } })),
      { x: 1.0, y: 4.0, w: 11, h: 1.2, fontFace: FONT, fontSize: 15, color: C.text, paraSpaceAfter: 6, valign: 'top', margin: 0 },
    );
    slide.addText(`Tayyorlangan: ${uzDate(b.today)} · avtomatik hisobot`, { x: 1.0, y: H - 0.9, w: 11, h: 0.35, fontFace: FONT, fontSize: 11, color: C.faint, margin: 0 });
  }

  // 2. Asosiy natijalar
  summary() {
    const b = this.b;
    const slide = this.frame('Asosiy natijalar', 'Bir qarashda: yil yakuni, risk, samaradorlik, zararsizlik');
    const w = (W - 1.2 - 0.3 * 3) / 4;
    const ye = b.result.yearEnd;
    const total = b.risk.units.find((u) => u.kind === 'total');
    const eff = b.efficiency.units.length ? b.efficiency.units.reduce((s, u) => s + u.crs, 0) / b.efficiency.units.length : null;
    const be = b.breakeven.units.find((u) => u.kind === 'total');
    this.kpi(slide, 0.6, 1.55, w, `${ye?.year ?? ''}-yil natijasi`, ye ? fmtSom(Number(ye.totalTiyin) / 100) : '—', ye && Number(ye.totalTiyin) >= 0 ? C.green : C.red, ye ? `80%: ${fmtSom(Number(ye.lo80Tiyin) / 100)} … ${fmtSom(Number(ye.hi80Tiyin) / 100)}` : undefined);
    this.kpi(slide, 0.6 + (w + 0.3), 1.55, w, 'Zarar ehtimoli, 3 oy', total ? fmtPct(total.lossProbability * 100, 0) : '—', total && total.lossProbability >= 0.2 ? C.red : C.ink, 'korxona bo\'yicha');
    this.kpi(slide, 0.6 + (w + 0.3) * 2, 1.55, w, "O'rtacha samaradorlik", eff === null ? '—' : fmtPct(eff * 100, 0), C.ink, `chegarada: ${b.efficiency.frontier.join(', ') || '—'}`);
    this.kpi(slide, 0.6 + (w + 0.3) * 3, 1.55, w, 'Zararsizlik (oyiga)', be?.breakevenTiyin ? fmtSom(Number(be.breakevenTiyin) / 100) : '—', C.ink, be?.safetyMargin != null ? `zaxira ${fmtPct(be.safetyMargin * 100, 0)}` : undefined);
    slide.addText('Asosiy xulosalar', { x: 0.6, y: 3.2, w: 6, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.navy, margin: 0 });
    const notes = [b.income.notes[0], b.result.notes[2], b.unitsIncome.notes[1], b.efficiency.notes[1], b.breakeven.notes[1], b.risk.notes[1]].filter((x): x is string => Boolean(x));
    this.bullets(slide, notes, 0.6, 3.7, W - 1.2, 3.1, 13);
  }

  // 3. Prognoz grafigi
  forecast() {
    const b = this.b;
    const slide = this.frame('Prognoz: daromad va xarajat', `Daromad — ${b.income.model.name} (${RELIABILITY[b.income.reliability]}), xarajat — ${b.expense.model.name} (${RELIABILITY[b.expense.reliability]}) · mln so'm`);
    const hist = b.income.history.slice(-12);
    const labels = [...hist.map((h) => short(h.period)), ...b.income.forecast.map((f) => short(f.period))];
    const pad = (n: number) => new Array<number | null>(n).fill(null);
    const expHist = b.expense.history.slice(-12);
    const data = [
      { name: 'Daromad (haqiqiy)', labels, values: [...hist.map((h) => mln(h.valueTiyin)), ...pad(b.income.forecast.length)] },
      { name: 'Daromad (prognoz)', labels, values: [...pad(hist.length - 1), mln(hist[hist.length - 1]?.valueTiyin ?? 0), ...b.income.forecast.map((f) => mln(f.meanTiyin))] },
      { name: 'Xarajat (haqiqiy)', labels, values: [...expHist.map((h) => mln(h.valueTiyin)), ...pad(b.expense.forecast.length)] },
      { name: 'Xarajat (prognoz)', labels, values: [...pad(expHist.length - 1), mln(expHist[expHist.length - 1]?.valueTiyin ?? 0), ...b.expense.forecast.map((f) => mln(f.meanTiyin))] },
    ];
    // Aralash grafik: har bir qator o'z uslubi bilan (haqiqiy — to'liq, prognoz — uzuq chiziq)
    const style = (color: string, dash: boolean) => ({ chartColors: [color], lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5, lineDash: dash ? 'dash' : 'solid' });
    const series = [
      { type: this.pptx.ChartType.line, data: [data[0]], options: style(C.green, false) },
      { type: this.pptx.ChartType.line, data: [data[1]], options: style(C.green, true) },
      { type: this.pptx.ChartType.line, data: [data[2]], options: style(C.red, false) },
      { type: this.pptx.ChartType.line, data: [data[3]], options: style(C.red, true) },
    ];
    slide.addChart(series as unknown as PptxGenJS.IChartMulti[], this.chartOpts({ x: 0.5, y: 1.5, w: 8.2, h: 4.6, showLegend: true, legendPos: 'b', valAxisLabelFormatCode: '#,##0' }));
    const notes = [...b.income.notes.slice(0, 2), b.income.notes.find((n) => n.includes('yil oxirigacha')) ?? '', ...b.result.notes.slice(2, 3)].filter(Boolean);
    slide.addShape(this.pptx.ShapeType.rect, { x: 8.9, y: 1.5, w: W - 9.5, h: 4.6, fill: { color: C.panel }, line: { color: C.panel } });
    this.bullets(slide, notes, 9.1, 1.7, W - 9.9, 4.3, 12);
  }

  // 4. Hududlar prognozi
  regions() {
    const b = this.b;
    const slide = this.frame("Hududlar: keyingi 3 oy daromadi", "O'rtacha oylik, oxirgi 3 oyga nisbatan");
    const rows = b.unitsIncome.units
      .filter((u) => u.kind !== 'total' && u.changePercent !== null)
      .sort((x, y) => (x.changePercent ?? 0) - (y.changePercent ?? 0))
      .slice(0, 14)
      .map((u) => {
        const ch = u.changePercent ?? 0;
        const res = b.unitsResult.units.find((x) => x.key === u.key);
        return [
          { text: u.name, options: { align: 'left' } },
          { text: fmtSom(Number(u.recentAvgTiyin) / 100), options: { align: 'right', color: C.muted } },
          { text: fmtSom(Number(u.nextAvgTiyin) / 100), options: { align: 'right', bold: true } },
          { text: `${ch >= 0 ? '+' : '−'}${fmtPct(Math.abs(ch))}`, options: { align: 'right', bold: true, color: ch >= 0 ? C.green : C.red } },
          { text: res ? fmtSom(Number(res.nextAvgTiyin) / 100) : '—', options: { align: 'right', color: res && Number(res.nextAvgTiyin) < 0 ? C.red : C.text } },
          { text: RELIABILITY[u.reliability], options: { align: 'center', color: C.muted } },
        ];
      });
    this.table(slide, ['Hudud', 'Oxirgi 3 oy', 'Keyingi 3 oy', "O'zgarish", 'Natija (keyingi)', 'Ishonch'], rows, 0.6, 1.5, 8.4, [2.3, 1.35, 1.35, 1.1, 1.4, 0.9], 10.5);
    slide.addShape(this.pptx.ShapeType.rect, { x: 9.3, y: 1.5, w: W - 9.9, h: 4.9, fill: { color: C.panel }, line: { color: C.panel } });
    this.bullets(slide, b.unitsIncome.notes, 9.5, 1.7, W - 10.3, 4.6, 12);
  }

  // 5. Omillar
  factors() {
    const f = this.b.factors;
    const main = f.preferred ? f[f.preferred] : null;
    const slide = this.frame("Omillar: daromad nimaga bog'liq", `${f.units} hudud × ${f.months} oy · asosiy model: ${f.preferred ? METHOD[f.preferred] : '—'}${f.hausman ? ` (Xausman p = ${f.hausman.p.toFixed(3).replace('.', ',')})` : ''}`);
    if (!main) {
      this.bullets(slide, f.notes, 0.6, 1.6, W - 1.2, 4.8);
      return;
    }
    const rows = main.coefficients.map((c) => {
      const per = f.factors.find((x) => x.key === c.key)?.unit === 'kishi';
      const el = f.elasticity?.coefficients.find((x) => x.key === c.key);
      return [
        { text: c.label, options: { align: 'left' } },
        { text: `${c.value >= 0 ? '+' : '−'}${fmtSom(Math.abs(c.value * (per ? 1 : 1e6)))}`, options: { align: 'right', bold: true, color: c.significance === 'none' ? C.muted : c.value >= 0 ? C.green : C.red } },
        { text: per ? '1 kishiga' : "1 mln so'mga", options: { align: 'center', color: C.muted } },
        { text: el ? `${el.value >= 0 ? '+' : '−'}${Math.abs(el.value).toFixed(2).replace('.', ',')}%` : '—', options: { align: 'right' } },
        { text: SIGNIFICANCE[c.significance], options: { align: 'center', bold: true, color: c.significance === 'strong' ? C.green : c.significance === 'weak' ? C.amber : C.muted } },
      ];
    });
    this.table(slide, ['Omil', "Ta'sir (oyiga)", 'Birlik', 'Elastiklik (1% ga)', 'Ishonch'], rows, 0.6, 1.5, 8.2, [2.8, 1.7, 1.2, 1.4, 1.1], 11);
    const effects = f.unitEffects;
    if (effects.length) {
      slide.addText("Hudud effekti: resurslariga nisbatan kutilganidan ko'p/kam daromad, mln so'm/oy", { x: 0.6, y: 3.2, w: 8.2, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.muted, margin: 0 });
      slide.addChart(
        this.pptx.ChartType.bar,
        [{ name: 'Hudud effekti', labels: effects.map((u) => u.name), values: effects.map((u) => mln(u.effectTiyin)) }] as never,
        this.chartOpts({ x: 0.5, y: 3.5, w: 8.3, h: 3.3, barDir: 'bar', chartColors: [C.green], invertedColors: [C.red], showLegend: false, catAxisLabelPos: 'low', catAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0', catAxisOrientation: 'maxMin' }),
      );
    }
    slide.addShape(this.pptx.ShapeType.rect, { x: 9.1, y: 1.5, w: W - 9.7, h: 5.3, fill: { color: C.panel }, line: { color: C.panel } });
    const notes = [f.cobbDouglas?.text, f.hausman?.text, ...f.notes.filter((n) => n.startsWith('Resurslariga') || n.startsWith('Umumiy samaradorlik') || n.startsWith('Eslatma'))].filter((x): x is string => Boolean(x));
    this.bullets(slide, notes, 9.3, 1.7, W - 10.1, 5.0, 11);
  }

  // 6. Samaradorlik
  efficiency() {
    const e = this.b.efficiency;
    const slide = this.frame('Samaradorlik chegarasi (DEA)', `${e.months} oy · resurslar: ${e.inputs.join(', ').toLowerCase()}; natija: daromad · 100% — eng yaxshilar`);
    if (!e.units.length) {
      this.bullets(slide, [...e.notes, ...e.warnings], 0.6, 1.6, W - 1.2, 4.8);
      return;
    }
    slide.addChart(
      this.pptx.ChartType.bar,
      [{ name: 'Samaradorlik, %', labels: e.units.map((u) => `${u.rank}. ${u.name}`), values: e.units.map((u) => Math.round(u.crs * 1000) / 10) }] as never,
      this.chartOpts({ x: 0.5, y: 1.5, w: 7.2, h: 5.3, barDir: 'bar', chartColors: [C.navy], showLegend: false, showValue: true, dataLabelFontSize: 9, dataLabelFormatCode: '0', valAxisMaxVal: 100, valAxisMinVal: 0, catAxisOrientation: 'maxMin', catAxisLabelFontSize: 9.5 }),
    );
    slide.addShape(this.pptx.ShapeType.rect, { x: 7.95, y: 1.5, w: W - 8.55, h: 5.3, fill: { color: C.panel }, line: { color: C.panel } });
    this.bullets(slide, e.notes.slice(0, 5), 8.15, 1.7, W - 8.95, 5.0, 12);
  }

  // 7. Zararsizlik
  breakeven() {
    const be = this.b.breakeven;
    const slide = this.frame('Zararsizlik nuqtasi', `${be.months} oy · oyiga qancha daromad kerak va hozir qancha zaxira bor`);
    const rows = be.units
      .filter((u) => u.kind !== 'center')
      .slice(0, 15)
      .map((u) => [
        { text: u.name, options: { align: 'left', bold: u.kind === 'total' } },
        { text: fmtSom(Number(u.avgIncomeTiyin) / 100), options: { align: 'right' } },
        { text: u.breakevenTiyin ? fmtSom(Number(u.breakevenTiyin) / 100) : '—', options: { align: 'right', bold: true } },
        {
          text: u.safetyMargin === null ? '—' : `${u.safetyMargin >= 0 ? '+' : '−'}${fmtPct(Math.abs(u.safetyMargin) * 100, 0)}`,
          options: { align: 'right', bold: true, color: u.safetyMargin === null ? C.muted : u.safetyMargin < 0 ? C.red : u.safetyMargin < 0.1 ? C.amber : C.green },
        },
        { text: BE_STATUS[u.status], options: { align: 'center', color: u.status === 'loss' ? C.red : u.status === 'thin' ? C.amber : C.text } },
      ]);
    this.table(slide, ['Hudud', "O'rtacha daromad", 'Zararsizlik', 'Zaxira', 'Holat'], rows, 0.6, 1.5, 7.8, [2.4, 1.6, 1.6, 1.0, 1.2], 10);
    slide.addShape(this.pptx.ShapeType.rect, { x: 8.7, y: 1.5, w: W - 9.3, h: 5.3, fill: { color: C.panel }, line: { color: C.panel } });
    this.bullets(slide, be.notes.slice(0, 5), 8.9, 1.7, W - 9.7, 5.0, 12);
  }

  // 8. Risk
  risk() {
    const k = this.b.risk;
    const slide = this.frame('Risk: zararga tushish ehtimoli', `${periodLabel(k.periodFrom)} – ${periodLabel(k.periodTo)} · 2000 ta simulyatsiya (Monte-Karlo)`);
    const regions = k.units.filter((u) => u.kind === 'region').slice(0, 14);
    slide.addChart(
      this.pptx.ChartType.bar,
      [
        { name: 'Davr jamida zarar, %', labels: regions.map((u) => u.name), values: regions.map((u) => Math.round(u.lossProbability * 100)) },
        { name: 'Kamida 1 oy zarar, %', labels: regions.map((u) => u.name), values: regions.map((u) => Math.round(u.anyMonthLossProbability * 100)) },
      ] as never,
      this.chartOpts({ x: 0.5, y: 1.5, w: 7.6, h: 5.3, barDir: 'bar', chartColors: [C.red, 'E7B4AF'], showLegend: true, legendPos: 'b', valAxisMaxVal: 100, valAxisMinVal: 0, catAxisOrientation: 'maxMin', catAxisLabelFontSize: 9.5, barGrouping: 'clustered' }),
    );
    slide.addShape(this.pptx.ShapeType.rect, { x: 8.35, y: 1.5, w: W - 8.95, h: 5.3, fill: { color: C.panel }, line: { color: C.panel } });
    this.bullets(slide, k.notes, 8.55, 1.7, W - 9.35, 5.0, 12);
  }

  // 9. Usullar va ma'lumot sifati
  method() {
    const b = this.b;
    const slide = this.frame("Usullar va ma'lumot sifati", 'Natijalarni qanday tushunish kerak');
    const methods = [
      "Prognoz — Holt-Winters oilasi (tekislash, trendli, mavsumiy): qaysi usul oxirgi oylarni yaxshiroq aytgan bo'lsa, o'sha tanlanadi; oraliqlar simulyatsiya bilan.",
      "Omillar — panel regressiya (OLS, FE, RE), Xausman testi; standart xatolar hududlar bo'yicha klasterlangan; elastiklik — log-log FE; Kobb-Duglas.",
      "Samaradorlik — DEA (ma'lumotlarni qamrab olish tahlili): hududlar bir-biri bilan solishtiriladi, tashqi me'yor kerak emas.",
      "Zararsizlik — oylik xarajatning doimiy va daromadga bog'liq qismi regressiya bilan ajratiladi.",
      'Risk — daromad va xarajat birga simulyatsiya qilinadi (2000 yo\'l), ularning o\'zaro bog\'liqligi hisobga olinadi.',
      "Barcha raqamlar faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan olinadi; hech narsa o'zgartirilmaydi.",
    ];
    slide.addText('Usullar', { x: 0.6, y: 1.5, w: 6, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.navy, margin: 0 });
    this.bullets(slide, methods, 0.6, 1.95, 6.1, 4.9, 12);
    slide.addShape(this.pptx.ShapeType.rect, { x: 7.0, y: 1.5, w: W - 7.6, h: 5.3, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText("Ma'lumot sifati", { x: 7.2, y: 1.65, w: 5, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.navy, margin: 0 });
    const warnings = b.overview.warnings.map((w) => w.text);
    this.bullets(slide, warnings.length ? warnings : ["Jiddiy muammo topilmadi."], 7.2, 2.1, W - 8.0, 4.6, 11);
  }
}